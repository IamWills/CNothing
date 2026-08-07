import type { JsonObject } from "./platform.entity";

export type SecretType =
  | "client_secret"
  | "api_key"
  | "oauth_code"
  | "access_token"
  | "refresh_token"
  | "oauth_access_token"
  | "oauth_refresh_token"
  | "private_key"
  | "ssh_private_key"
  | "session_cookie"
  | "cookie"
  | "password"
  | "recovery_code"
  | "mfa_secret"
  | "browser_session";

export type SecretOwnerType = "provider" | "connection" | "user" | "agent" | "system";
export type SecretStatus = "active" | "rotated" | "revoked" | "expired";

export type SecretVaultRecord = {
  id: string;
  secret_type: SecretType;
  owner_type: SecretOwnerType;
  owner_id: string;
  secret_alg: string;
  key_version: number;
  status: SecretStatus;
  fingerprint: string;
  secret_ref: string;
  provider_id: string | null;
  user_id: string | null;
  metadata: JsonObject;
  expires_at: string | null;
  rotated_from_id: string | null;
  rotated_at: string | null;
  created_at: string;
  updated_at: string;
  revoked_at: string | null;
};

export type VaultAuditEvent = "secret_stored" | "secret_decrypted" | "secret_rotated" | "secret_revoked";
