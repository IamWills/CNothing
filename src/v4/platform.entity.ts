export type JsonObject = Record<string, unknown>;

export type AgentStatus = "active" | "suspended" | "revoked";

export type AgentRecord = {
  id: string;
  name: string;
  public_key_pem: string | null;
  owner_user_id: string;
  tenant_id: string;
  status: AgentStatus;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type UserSessionRecord = {
  id: string;
  user_id: string;
  expires_at: string;
  revoked: boolean;
  revoked_at: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type OidcProviderRecord = {
  id: string;
  name: string;
  display_name: string;
  issuer: string;
  client_id: string;
  client_secret_encrypted: Buffer;
  scopes: string;
  enabled: boolean;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type OidcProviderPublic = {
  id: string;
  name: string;
  display_name: string;
  issuer: string;
  scopes: string;
};

export type UserIdentityRecord = {
  id: string;
  user_id: string;
  provider_id: string;
  subject: string;
  email: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};
