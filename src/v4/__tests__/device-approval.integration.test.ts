import { createSign, generateKeyPairSync, randomBytes, randomUUID } from "node:crypto";
import { beforeEach, expect, test } from "bun:test";

import { describeWithDb, resetDatabase } from "../../__tests__/helpers/db";
import { asPendingAccess, givenAgent, givenProvider } from "../../__tests__/helpers/fixtures";

import { buildApprovalSignaturePayload, deviceService } from "../device.service";
import { createApprovalChallenge } from "../device.repository";
import { proxyService } from "../proxy.service";

const USER_ID = "github:alice";
const API_BASE_URL = "http://127.0.0.1:3021";

function newDeviceKey() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" }) as { kty: string; crv: string; x: string; y: string };
  return {
    publicKeyJwk: { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y },
    sign(payload: string): string {
      const signer = createSign("SHA256");
      signer.update(payload);
      return signer.sign({ key: privateKey, dsaEncoding: "der" }).toString("base64url");
    },
  };
}

async function pairFreshDevice() {
  const key = newDeviceKey();
  const issued = await deviceService.issuePairingCode(USER_ID);
  const paired = await deviceService.pairDevice({
    pairingCode: issued.pairing_code,
    deviceName: "Test iPhone",
    publicKeyJwk: key.publicKeyJwk,
  });
  return { key, deviceId: paired.device.id, sessionToken: paired.session_token };
}

async function givenPendingAccessRequest(): Promise<string> {
  const { agent } = await givenAgent();
  const provider = await givenProvider();
  const request = asPendingAccess(await proxyService.requestAccess({
    agent,
    provider: provider.slug,
    userId: USER_ID,
    apiBaseUrl: API_BASE_URL,
  }));
  return request.access_request_id;
}

describeWithDb("device-bound approvals", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  test("pairing binds the Secure Enclave public key and mints a device session", async () => {
    const { deviceId, sessionToken } = await pairFreshDevice();

    expect(sessionToken).toBeTruthy();
    const devices = await deviceService.listDevices(USER_ID);
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ id: deviceId, key_registered: true, status: "active" });
  });

  test("a pairing code is single use", async () => {
    const key = newDeviceKey();
    const issued = await deviceService.issuePairingCode(USER_ID);
    await deviceService.pairDevice({
      pairingCode: issued.pairing_code,
      deviceName: "First",
      publicKeyJwk: key.publicKeyJwk,
    });

    await expect(
      deviceService.pairDevice({
        pairingCode: issued.pairing_code,
        deviceName: "Replay",
        publicKeyJwk: key.publicKeyJwk,
      }),
    ).rejects.toThrow(/invalid or expired pairing code/i);
  });

  test("pairing rejects a missing or non-P-256 key", async () => {
    const issued = await deviceService.issuePairingCode(USER_ID);

    await expect(
      deviceService.pairDevice({ pairingCode: issued.pairing_code, deviceName: "No key" }),
    ).rejects.toThrow(/public_key_jwk is required/i);

    await expect(
      deviceService.pairDevice({
        pairingCode: issued.pairing_code,
        deviceName: "Wrong curve",
        publicKeyJwk: { kty: "EC", crv: "P-384", x: "a", y: "b" },
      }),
    ).rejects.toThrow(/EC P-256/i);
  });

  test("a correctly signed verdict is accepted", async () => {
    const { key, deviceId } = await pairFreshDevice();
    const accessRequestId = await givenPendingAccessRequest();
    const challenge = await deviceService.issueApprovalChallenge({
      userId: USER_ID,
      deviceId,
      accessRequestId,
    });

    await deviceService.verifyDeviceApproval({
      userId: USER_ID,
      deviceId,
      accessRequestId,
      verdict: "approved",
      challengeId: challenge.challenge_id,
      signature: key.sign(
        buildApprovalSignaturePayload({
          challengeId: challenge.challenge_id,
          nonce: challenge.nonce,
          accessRequestId,
          verdict: "approved",
        }),
      ),
    });
  });

  test("a challenge cannot be replayed", async () => {
    const { key, deviceId } = await pairFreshDevice();
    const accessRequestId = await givenPendingAccessRequest();
    const challenge = await deviceService.issueApprovalChallenge({
      userId: USER_ID,
      deviceId,
      accessRequestId,
    });
    const signature = key.sign(
      buildApprovalSignaturePayload({
        challengeId: challenge.challenge_id,
        nonce: challenge.nonce,
        accessRequestId,
        verdict: "approved",
      }),
    );
    const verdict = {
      userId: USER_ID,
      deviceId,
      accessRequestId,
      verdict: "approved" as const,
      challengeId: challenge.challenge_id,
      signature,
    };

    await deviceService.verifyDeviceApproval(verdict);
    await expect(deviceService.verifyDeviceApproval(verdict)).rejects.toThrow(
      /invalid, expired, or already used/i,
    );
  });

  test("an expired challenge is refused", async () => {
    const { key, deviceId } = await pairFreshDevice();
    const accessRequestId = await givenPendingAccessRequest();
    const challenge = await createApprovalChallenge({
      id: randomUUID(),
      access_request_id: accessRequestId,
      device_id: deviceId,
      user_id: USER_ID,
      nonce: randomBytes(24).toString("base64url"),
      ttl_seconds: -60,
    });

    await expect(
      deviceService.verifyDeviceApproval({
        userId: USER_ID,
        deviceId,
        accessRequestId,
        verdict: "approved",
        challengeId: challenge.id,
        signature: key.sign(
          buildApprovalSignaturePayload({
            challengeId: challenge.id,
            nonce: challenge.nonce,
            accessRequestId,
            verdict: "approved",
          }),
        ),
      }),
    ).rejects.toThrow(/invalid, expired, or already used/i);
  });

  test("a verdict signed by a different key is refused", async () => {
    const { deviceId } = await pairFreshDevice();
    const attacker = newDeviceKey();
    const accessRequestId = await givenPendingAccessRequest();
    const challenge = await deviceService.issueApprovalChallenge({
      userId: USER_ID,
      deviceId,
      accessRequestId,
    });

    await expect(
      deviceService.verifyDeviceApproval({
        userId: USER_ID,
        deviceId,
        accessRequestId,
        verdict: "approved",
        challengeId: challenge.challenge_id,
        signature: attacker.sign(
          buildApprovalSignaturePayload({
            challengeId: challenge.challenge_id,
            nonce: challenge.nonce,
            accessRequestId,
            verdict: "approved",
          }),
        ),
      }),
    ).rejects.toThrow(/signature verification failed/i);
  });

  test("a signature for one verdict cannot approve the opposite verdict", async () => {
    const { key, deviceId } = await pairFreshDevice();
    const accessRequestId = await givenPendingAccessRequest();
    const challenge = await deviceService.issueApprovalChallenge({
      userId: USER_ID,
      deviceId,
      accessRequestId,
    });

    await expect(
      deviceService.verifyDeviceApproval({
        userId: USER_ID,
        deviceId,
        accessRequestId,
        verdict: "approved",
        challengeId: challenge.challenge_id,
        signature: key.sign(
          buildApprovalSignaturePayload({
            challengeId: challenge.challenge_id,
            nonce: challenge.nonce,
            accessRequestId,
            verdict: "denied",
          }),
        ),
      }),
    ).rejects.toThrow(/signature verification failed/i);
  });

  test("a challenge is bound to its access request", async () => {
    const { key, deviceId } = await pairFreshDevice();
    const accessRequestId = await givenPendingAccessRequest();
    const challenge = await deviceService.issueApprovalChallenge({
      userId: USER_ID,
      deviceId,
      accessRequestId,
    });
    const otherRequestId = await givenPendingAccessRequest();

    await expect(
      deviceService.verifyDeviceApproval({
        userId: USER_ID,
        deviceId,
        accessRequestId: otherRequestId,
        verdict: "approved",
        challengeId: challenge.challenge_id,
        signature: key.sign(
          buildApprovalSignaturePayload({
            challengeId: challenge.challenge_id,
            nonce: challenge.nonce,
            accessRequestId: otherRequestId,
            verdict: "approved",
          }),
        ),
      }),
    ).rejects.toThrow(/invalid, expired, or already used/i);
  });

  test("a revoked device can no longer approve", async () => {
    const { key, deviceId } = await pairFreshDevice();
    const accessRequestId = await givenPendingAccessRequest();
    const challenge = await deviceService.issueApprovalChallenge({
      userId: USER_ID,
      deviceId,
      accessRequestId,
    });
    await deviceService.revokeDevice({ userId: USER_ID, deviceId });

    await expect(
      deviceService.verifyDeviceApproval({
        userId: USER_ID,
        deviceId,
        accessRequestId,
        verdict: "approved",
        challengeId: challenge.challenge_id,
        signature: key.sign(
          buildApprovalSignaturePayload({
            challengeId: challenge.challenge_id,
            nonce: challenge.nonce,
            accessRequestId,
            verdict: "approved",
          }),
        ),
      }),
    ).rejects.toThrow(/device not found or revoked/i);
  });

  test("another user cannot drive this device", async () => {
    const { deviceId } = await pairFreshDevice();
    const accessRequestId = await givenPendingAccessRequest();

    await expect(
      deviceService.issueApprovalChallenge({
        userId: "github:mallory",
        deviceId,
        accessRequestId,
      }),
    ).rejects.toThrow(/device not found or revoked/i);
  });

  test("a challenge is not issued for a missing or already decided approval", async () => {
    const { deviceId } = await pairFreshDevice();
    const accessRequestId = await givenPendingAccessRequest();
    await proxyService.denyAccess({ accessRequestId, userId: USER_ID });

    await expect(
      deviceService.issueApprovalChallenge({
        userId: USER_ID,
        deviceId,
        accessRequestId,
      }),
    ).rejects.toThrow(/already denied/i);

    await expect(
      deviceService.issueApprovalChallenge({
        userId: USER_ID,
        deviceId,
        accessRequestId: randomUUID(),
      }),
    ).rejects.toThrow(/not found/i);
  });
});
