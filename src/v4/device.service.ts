import { createHmac, randomBytes, randomUUID } from "node:crypto";

import config from "../config";
import { NotFoundError, UnauthorizedError, ValidationError } from "../utils/errors";
import { createUserSession } from "../v2/v2.repository";
import { generateUserSessionToken, hashSessionToken } from "../v2/user-session";
import type { JsonObject } from "../v2/v2.entity";
import {
  consumePairingCode,
  createPairingCode,
  createUserDevice,
  listUserDevices,
  revokeUserDevice,
  updateDevicePushToken,
} from "./device.repository";

const PAIRING_CODE_TTL_SECONDS = 10 * 60;
// Device sessions outlive browser sessions: the phone is a trusted authenticator.
const DEVICE_SESSION_TTL_SECONDS = 90 * 24 * 60 * 60;

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
    return {
      ok: true as const,
      pairing_code: code,
      expires_at: record.expires_at,
      instructions:
        "在 CNothing iOS App 中输入此配对码（10 分钟内有效），即可将手机绑定为审批设备。",
    };
  }

  /** iOS app redeems the code: binds the device and mints a device session. */
  async pairDevice(input: {
    pairingCode: string;
    deviceName: string;
    platform?: string;
    metadata?: JsonObject;
  }) {
    const code = input.pairingCode.trim().toUpperCase();
    if (!code) {
      throw new ValidationError("pairing_code is required", { error_code: "missing_field" });
    }
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
      },
      session_token: sessionToken,
    };
  }

  async registerPushToken(input: {
    userId: string;
    deviceId: string;
    pushToken: string;
    pushEnvironment?: string;
  }) {
    const environment = input.pushEnvironment === "sandbox" ? "sandbox" : "production";
    const device = await updateDevicePushToken({
      device_id: input.deviceId,
      user_id: input.userId,
      push_token: input.pushToken.trim(),
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
