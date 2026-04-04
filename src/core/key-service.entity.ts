export type JsonObject = Record<string, unknown>;

export type ClientRecord = {
  client_uuid: string;
  public_key_pem: string;
  public_key_fingerprint: string;
  key_alg: string;
  key_id: string | null;
  client_label: string | null;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
};

export type ClientSummary = ClientRecord & {
  namespace_count: number;
  kv_count: number;
  last_activity_at: string | null;
};

export type ChallengeRecord = {
  challenge_id: string;
  client_uuid: string;
  purpose: string;
  nonce_hash: string;
  issued_at: string;
  expires_at: string;
  used_at: string | null;
  status: "active" | "used" | "expired" | "revoked";
  request_id: string | null;
  metadata: JsonObject;
};

export type KvRecord = {
  id: string;
  client_uuid: string;
  namespace: string;
  record_key: string;
  cipher_alg: string;
  ciphertext: Buffer;
  cipher_iv: Buffer;
  cipher_tag: Buffer;
  wrapped_dek_alg: string;
  wrapped_dek: Buffer;
  wrapped_dek_iv: Buffer;
  wrapped_dek_tag: Buffer;
  value_fingerprint: string;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
  last_read_at: string | null;
};

export type NamespaceSummary = {
  namespace: string;
  key_count: number;
  last_updated_at: string | null;
};

export type KvRecordSummary = {
  id: string;
  client_uuid: string;
  namespace: string;
  record_key: string;
  value_fingerprint: string;
  metadata: JsonObject;
  created_at: string;
  updated_at: string;
  last_read_at: string | null;
};

export type AuditEventRecord = {
  id: string;
  client_uuid: string | null;
  action: string;
  status: string;
  request_id: string | null;
  error_code: string | null;
  metadata: JsonObject;
  created_at: string;
};

export type AuthaiPublicKeyView = {
  algorithm: string;
  key_id: string;
  public_key_pem: string;
  public_key_fingerprint: string;
};
