import { createHmac, createPublicKey, createVerify, randomBytes, randomUUID } from "node:crypto";

import config from "../config";
import { NotFoundError, UnauthorizedError, ValidationError } from "../utils/errors";
import { createUserSession } from "./platform.repository";
import { generateUserSessionToken, hashSessionToken } from "./user-session";
import type { JsonObject } from "./platform.entity";
import {
  consumeApprovalChallenge,
  consumePairingCode,
  createApprovalChallenge,
  createPairingCode,
  createUserDevice,
  findUserDeviceById,
  listUserDevices,
  revokeUserDevice,
  updateDevicePushToken,
} from "./device.repository";
import { approvalService } from "./approval.service";

const PAIRING_CODE_TTL_SECONDS = 10 * 60;
// Device sessions outlive browser sessions: the phone is a trusted authenticator.
const DEVICE_SESSION_TTL_SECONDS = 90 * 24 * 60 * 60;
const APPROVAL_CHALLENGE_TTL_SECONDS = 5 * 60;

/**
 * Canonical string a device signs to approve/deny (Okta Verify-style proof of
 * possession): the private key never leaves the phone's Secure Enclave, so a
 * leaked device session token alone cannot decide an access request.
 */
export function buildApprovalSignaturePayload(input: {
  challengeId: string;
  nonce: string;
  accessRequestId: string;
  verdict: "approved" | "denied";
}): string {
  return `cnothing-approval.v1.${input.challengeId}.${input.nonce}.${input.accessRequestId}.${input.verdict}`;
}

function validatePublicKeyJwk(value: unknown): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError("public_key_jwk is required for device-bound approvals", {
      error_code: "missing_public_key",
    });
  }
  const jwk = value as Record<string, unknown>;
  if (jwk.kty !== "EC" || jwk.crv !== "P-256") {
    throw new ValidationError("public_key_jwk must be an EC P-256 JWK", {
      error_code: "invalid_public_key",
    });
  }
  if (typeof jwk.x !== "string" || typeof jwk.y !== "string" || !jwk.x || !jwk.y) {
    throw new ValidationError("public_key_jwk is missing x/y coordinates", {
      error_code: "invalid_public_key",
    });
  }
  try {
    createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, format: "jwk" });
  } catch {
    throw new ValidationError("public_key_jwk is not a valid P-256 key", {
      error_code: "invalid_public_key",
    });
  }
  return { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y };
}

function hashPairingCode(code: string): string {
  return createHmac("sha256", config.masterKey).update(`device-pairing:${code}`).digest("hex");
}

/** Human-typable code: 8 chars from an unambiguous alphabet (no 0/O/1/I). */
function generatePairingCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  let code = "";
  for (const byte of bytes) {
    code += alphabet[byte % alphabet.length];
  }
  return code;
}

export class DeviceService {
  /** User (Console session) generates a code shown as text/QR to the phone. */
  async issuePairingCode(userId: string) {
    const code = generatePairingCode();
    const record = await createPairingCode({
      user_id: userId,
      code_hash: hashPairingCode(code),
      ttl_seconds: PAIRING_CODE_TTL_SECONDS,
    });
    // Scanned by the iOS app camera; carries the server origin so the app
    // works against any deployment without manual server entry.
    const qrPayload = `cnothing://pair?code=${encodeURIComponent(code)}&server=${encodeURIComponent(config.publicBaseUrl)}`;
    return {
      ok: true as const,
      pairing_code: code,
      qr_payload: qrPayload,
      expires_at: record.expires_at,
      instructions:
        "用 CNothing iOS App 扫描二维码，或手动输入此配对码（10 分钟内有效），即可将手机绑定为审批设备。",
    };
  }

  /** iOS app redeems the code: binds the device and mints a device session. */
  async pairDevice(input: {
    pairingCode: string;
    deviceName: string;
    platform?: string;
    publicKeyJwk?: unknown;
    metadata?: JsonObject;
  }) {
    const code = input.pairingCode.trim().toUpperCase();
    if (!code) {
      throw new ValidationError("pairing_code is required", { error_code: "missing_field" });
    }
    const publicKeyJwk = validatePublicKeyJwk(input.publicKeyJwk);
    const deviceId = randomUUID();
    const consumed = await consumePairingCode({
      code_hash: hashPairingCode(code),
      device_id: deviceId,
    });
    if (!consumed) {
      throw new UnauthorizedError("Invalid or expired pairing code", {
        error_code: "invalid_pairing_code",
      });
    }

    const device = await createUserDevice({
      id: deviceId,
      user_id: consumed.user_id,
      platform: input.platform?.trim() || "ios",
      device_name: input.deviceName.trim() || "iOS Device",
      public_key_jwk: publicKeyJwk,
      metadata: input.metadata,
    });

    const sessionToken = generateUserSessionToken();
    await createUserSession({
      user_id: consumed.user_id,
      session_token_hash: hashSessionToken(sessionToken),
      ttl_seconds: DEVICE_SESSION_TTL_SECONDS,
      metadata: { device_id: device.id, kind: "device" },
    });

    return {
      ok: true as const,
      device: {
        id: device.id,
        user_id: device.user_id,
        platform: device.platform,
        device_name: device.device_name,
        key_registered: true,
      },
      session_token: sessionToken,
    };
  }

  /**
   * Step 1 of a device approval: issue a one-time challenge the phone must
   * sign with its enrolled key.
   */
  async issueApprovalChallenge(input: {
    userId: string;
    deviceId: string;
    accessRequestId: string;
  }) {
    const device = await findUserDeviceById(input.deviceId);
    if (!device || device.status !== "active" || device.user_id !== input.userId) {
      throw new UnauthorizedError("Device not found or revoked", {
        error_code: "invalid_device",
      });
    }
    await approvalService.requirePending(input.accessRequestId, input.userId);
    const challenge = await createApprovalChallenge({
      id: randomUUID(),
      access_request_id: input.accessRequestId,
      device_id: device.id,
      user_id: input.userId,
      nonce: randomBytes(24).toString("base64url"),
      ttl_seconds: APPROVAL_CHALLENGE_TTL_SECONDS,
    });
    return {
      ok: true as const,
      challenge_id: challenge.id,
      nonce: challenge.nonce,
      expires_at: challenge.expires_at,
      signature_payload_format:
        "cnothing-approval.v1.{challenge_id}.{nonce}.{access_request_id}.{verdict}",
      signature_algorithm: "ECDSA P-256 / SHA-256, DER-encoded, base64url",
    };
  }

  /**
   * Step 2: verify the signed verdict. Consumes the challenge (single use).
   * Devices enrolled without a key (legacy pairings) are rejected — they must
   * re-pair to enable approvals.
   */
  async verifyDeviceApproval(input: {
    userId: string;
    deviceId: string;
    accessRequestId: string;
    verdict: "approved" | "denied";
    challengeId: string;
    signature: string;
  }) {
    const device = await findUserDeviceById(input.deviceId);
    if (!device || device.status !== "active" || device.user_id !== input.userId) {
      throw new UnauthorizedError("Device not found or revoked", {
        error_code: "invalid_device",
      });
    }
    if (!device.public_key_jwk) {
      throw new UnauthorizedError(
        "This device has no enrolled signing key. Re-pair the device to enable approvals.",
        { error_code: "device_key_missing" },
      );
    }
    if (!input.challengeId || !input.signature) {
      throw new ValidationError("challenge_id and signature are required for device approvals", {
        error_code: "missing_device_signature",
      });
    }

    const challenge = await consumeApprovalChallenge({
      id: input.challengeId,
      device_id: device.id,
      access_request_id: input.accessRequestId,
    });
    if (!challenge) {
      throw new UnauthorizedError("Challenge is invalid, expired, or already used", {
        error_code: "invalid_challenge",
      });
    }

    const payload = buildApprovalSignaturePayload({
      challengeId: input.challengeId,
      nonce: challenge.nonce,
      accessRequestId: input.accessRequestId,
      verdict: input.verdict,
    });
    const publicKey = createPublicKey({
      key: device.public_key_jwk as unknown as import("node:crypto").JsonWebKey,
      format: "jwk",
    });
    const verifier = createVerify("SHA256");
    verifier.update(payload);
    const valid = verifier.verify(
      { key: publicKey, dsaEncoding: "der" },
      Buffer.from(input.signature, "base64url"),
    );
    if (!valid) {
      throw new UnauthorizedError("Device signature verification failed", {
        error_code: "invalid_device_signature",
      });
    }
  }

  async registerPushToken(input: {
    userId: string;
    deviceId: string;
    pushToken: string;
    pushEnvironment?: string;
  }) {
    const pushToken = input.pushToken.trim();
    if (!/^[0-9a-fA-F]{32,400}$/.test(pushToken) || pushToken.length % 2 !== 0) {
      throw new ValidationError("push_token must be an APNs hexadecimal device token", {
        error_code: "invalid_push_token",
      });
    }
    const environment = input.pushEnvironment === "sandbox" ? "sandbox" : "production";
    const device = await updateDevicePushToken({
      device_id: input.deviceId,
      user_id: input.userId,
      push_token: pushToken.toLowerCase(),
      push_environment: environment,
    });
    if (!device) {
      throw new NotFoundError("Device not found or revoked");
    }
    return { ok: true as const, device_id: device.id, push_environment: environment };
  }

  async listDevices(userId: string) {
    const devices = await listUserDevices(userId);
    return devices.map((device) => ({
      id: device.id,
      platform: device.platform,
      device_name: device.device_name,
      status: device.status,
      has_push_token: Boolean(device.push_token),
      key_registered: Boolean(device.public_key_jwk),
      last_seen_at: device.last_seen_at,
      created_at: device.created_at,
    }));
  }

  async revokeDevice(input: { userId: string; deviceId: string }) {
    const revoked = await revokeUserDevice({
      device_id: input.deviceId,
      user_id: input.userId,
    });
    if (!revoked) {
      throw new NotFoundError("Device not found or already revoked");
    }
    return { ok: true as const, status: "revoked" as const };
  }
}

export const deviceService = new DeviceService();
