# AuthAI KV Protocol

## Overview

`keyservice` 提供一套 `AuthAI + Encrypted KV` 协议，适用于：

- AI 负责流程编排
- 客户端后端持有私钥
- AI 不应接触敏感值明文

协议版本：

- envelope 版本：`ksp1`
- 公钥算法：`RSA-OAEP-256`
- 对称算法：`AES-256-GCM`

部署说明：

- `keyservice` 自身的 authai 私钥与公钥推荐以文件路径配置
- 运行时读取：
  - `KEYSERVICE_AUTHAI_PRIVATE_KEY_PATH`
  - `KEYSERVICE_AUTHAI_PUBLIC_KEY_PATH` 可选
- 如果未提供公钥路径，服务会从私钥推导公钥

## Entities

- `Client`
  - 由一个稳定公钥标识
- `Challenge`
  - 单次使用、短时有效的认证票据
- `KV Record`
  - 由 `client_uuid + namespace + key` 唯一定位

## Registration

接口：`POST /v1/authai/register`

请求：

```json
{
  "client_public_key": "-----BEGIN PUBLIC KEY----- ...",
  "client_key_alg": "RSA-OAEP-256/A256GCM",
  "client_key_id": "optional-key-id",
  "client_label": "optional label",
  "metadata": {}
}
```

响应：

```json
{
  "ok": true,
  "client_uuid": "uuid",
  "client_key_fingerprint": "sha256-hex",
  "authai_public_key": {
    "algorithm": "RSA-OAEP-256/A256GCM",
    "key_id": "keyservice-key-id",
    "public_key_pem": "-----BEGIN PUBLIC KEY----- ...",
    "public_key_fingerprint": "sha256-hex"
  },
  "challenge_for_client": {
    "v": "ksp1",
    "alg": "RSA-OAEP-256",
    "enc": "A256GCM",
    "key_id": "optional-client-key-id",
    "encrypted_key": "...",
    "iv": "...",
    "ciphertext": "...",
    "tag": "..."
  },
  "challenge_id": "uuid",
  "challenge_expires_at": "2026-04-04T12:00:00.000Z"
}
```

`challenge_for_client` 由客户端后端使用自己的私钥解密。解密后明文结构：

```json
{
  "v": "ksp1",
  "type": "challenge",
  "purpose": "authai.operation",
  "client_uuid": "uuid",
  "challenge_id": "uuid",
  "nonce": "base64url-32-bytes",
  "issued_at": "2026-04-04T12:00:00.000Z",
  "expires_at": "2026-04-04T12:05:00.000Z"
}
```

## Auth Envelope

客户端后端解密 challenge 后，发起 save/read/refresh 前要先生成 `auth_envelope`，并用 `keyservice` 的 authai 公钥加密。

明文结构：

```json
{
  "v": "ksp1",
  "type": "auth",
  "action": "kv.save",
  "client_uuid": "uuid",
  "challenge_id": "uuid",
  "nonce": "base64url-32-bytes",
  "issued_at": "2026-04-04T12:00:00.000Z",
  "expires_at": "2026-04-04T12:05:00.000Z",
  "request_id": "uuid"
}
```

规则：

- challenge 必须未过期
- challenge 必须未使用
- challenge 必须与客户端匹配
- challenge 使用后立即失效
- 每次成功调用都会返回新的下一次 challenge

## Save

接口：`POST /v1/kv/save`

请求体：

```json
{
  "auth_envelope": { "...": "..." },
  "data_envelope": { "...": "..." }
}
```

`data_envelope` 明文：

```json
{
  "v": "ksp1",
  "type": "kv.save",
  "namespace": "thirdparty.example.prod",
  "items": [
    {
      "key": "user/123/profile-token",
      "value": {
        "access_token": "..."
      },
      "metadata": {}
    }
  ]
}
```

响应：

```json
{
  "ok": true,
  "client_uuid": "uuid",
  "request_id": "uuid",
  "namespace": "thirdparty.example.prod",
  "saved_keys": ["user/123/profile-token"],
  "authai_public_key": { "...": "..." },
  "next_challenge_for_client": { "...": "..." },
  "next_challenge_id": "uuid",
  "next_challenge_expires_at": "2026-04-04T12:05:00.000Z"
}
```

## Read

接口：`POST /v1/kv/read`

请求体：

```json
{
  "auth_envelope": { "...": "..." },
  "query_envelope": { "...": "..." }
}
```

`query_envelope` 明文：

```json
{
  "v": "ksp1",
  "type": "kv.read",
  "namespace": "thirdparty.example.prod",
  "keys": ["user/123/profile-token"]
}
```

响应中的 `result_envelope_for_client` 会再次使用客户端公钥加密。解密后明文结构：

```json
{
  "v": "ksp1",
  "type": "kv.read.result",
  "namespace": "thirdparty.example.prod",
  "items": {
    "user/123/profile-token": {
      "access_token": "..."
    }
  }
}
```

## Refresh

接口：`POST /v1/authai/refresh`

请求：

```json
{
  "auth_envelope": { "...": "..." }
}
```

其中 `auth_envelope.action` 必须是 `authai.refresh`。

## Envelope Format

所有外层 envelope 统一结构：

```json
{
  "v": "ksp1",
  "alg": "RSA-OAEP-256",
  "enc": "A256GCM",
  "key_id": "optional-key-id",
  "encrypted_key": "base64url",
  "iv": "base64url",
  "ciphertext": "base64url",
  "tag": "base64url",
  "aad": "optional-base64url"
}
```

## Error Codes

关键错误码包括：

- `missing_field`
- `invalid_field`
- `invalid_public_key`
- `invalid_auth_envelope`
- `challenge_not_found`
- `challenge_expired`
- `challenge_already_used`
- `challenge_nonce_mismatch`
- `challenge_purpose_mismatch`
- `payload_invalid`

## Operational Notes

- challenge 设计成单次使用，避免重放
- `namespace` 应表示平台/环境/业务域
- 如果 `key` 本身敏感，调用方应自行做映射或哈希
- 服务端审计表会记录注册、刷新、读写行为
