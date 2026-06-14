# AuthAI KV Protocol

## Overview

`CNothing` 提供一套 `AuthAI + Encrypted KV` 协议，适用于：

- AI 负责流程编排
- 客户端后端持有私钥
- AI 不应接触敏感值明文

协议版本：

- envelope 版本：`ksp1`
- 公钥算法：`RSA-OAEP-256`
- 对称算法：`AES-256-GCM`

部署说明：

- `CNothing` 自身的 authai 私钥与公钥推荐以文件路径配置
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

客户端后端解密 challenge 后，发起 save/read/refresh 前要先生成 `auth_envelope`，并用 `CNothing` 的 authai 公钥加密。

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
  "query_envelope": { "...": "..." },
  "recipient_public_key": "-----BEGIN PUBLIC KEY----- ..."
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

`recipient_public_key` 为**必填**参数：

- 服务端 MUST 使用该 PEM 公钥加密 `result_envelope_for_client` 后再返回
- 未提供或为空时，服务端 MUST 返回 `400`，`error_code` 为 `missing_recipient_public_key`
- 典型用法：客户端后端传入自己的公钥，确保 AI 等中间方只能转发密文，无法读取敏感明文

响应中的 `result_envelope_for_client` 解密后明文结构：

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

## 第三方服务凭证：正确用法

`CNothing` 是**储存第三方服务敏感信息**的平台。Agent 在使用 CNothing 时，最容易搞混的是「哪一把公钥在什么时候用」。下面按完整业务链路说明。

### 平台定位

- `CNothing`：集中存放第三方 API key、token 等敏感凭证；持有 **AuthAI 私钥**，可在协议边界内解密/重加密凭证。
- **客户端后端**：持有**客户端私钥**，是 AuthAI 协议的唯一可信解密边界；负责构造 `auth_envelope`、`data_envelope`、`query_envelope`。
- **AI Agent**：只负责编排与转发密文；**不得**持有任何私钥，**不得**自行解密 challenge、envelope 或 API key 明文。
- **第三方服务**：外部 API 提供方；注册时按约定用 CNothing 公钥加密返回的 API key；使用时用**自己的私钥**解密 CNothing 返回的密文完成鉴权。

### 三把公钥，不可混用

| 公钥 | 获取方式 | 用途 |
| --- | --- | --- |
| **CNothing AuthAI 公钥** | `GET /v1/authai/public-key` 或 `get_authai_public_key` | ① 客户端后端加密 `auth_envelope` / `data_envelope` / `query_envelope` 给 CNothing；② **提供给第三方**，让第三方把 API key 加密给 CNothing |
| **客户端公钥** | 客户端后端本地生成 | ① `POST /v1/authai/register` 注册身份；② 解密 `challenge_for_client`；③ 若凭证由**客户端后端**消费，则 `kv.read` 的 `recipient_public_key` 填此公钥 |
| **第三方服务公钥** | 第三方服务发布/注册时提供 | ① 标识第三方；② 当凭证要交给**第三方服务**鉴权时，`kv.read` 的 `recipient_public_key` **必须**填此公钥 |

**常见错误（Agent 必须避免）：**

- 向第三方提供**客户端公钥**，而不是 CNothing AuthAI 公钥。
- 存凭证后读取时，把 `recipient_public_key` 填成 CNothing 公钥或客户端公钥，而实际消费方是第三方服务。
- 把 `auth_envelope` 的加密目标（CNothing AuthAI 公钥）与业务层「API key 加密给 CNothing」混为一谈——前者是协议 envelope，后者是第三方返回凭证时的应用层加密。
- 自行解密任何 envelope 或尝试从密文中提取 API key 明文。

### 阶段一：Agent 接入 CNothing

1. 调用 `get_authai_public_key`，取得 **CNothing AuthAI 公钥**（后续协议 envelope 与第三方凭证投递都依赖它）。
2. 客户端后端本地生成密钥对，Agent 调用 `authai_register` 提交**客户端公钥**。
3. 将 `challenge_for_client` 交给客户端后端解密；后续每次 `kv.save` / `kv.read` 均由后端基于 challenge 构造 envelope，Agent 只转发密文。

此阶段完成后：Agent 已注册 CNothing 身份，且持有 CNothing AuthAI 公钥。**尚未**涉及任何第三方 API key。

### 阶段二：向第三方注册并写入 CNothing

1. Agent（或编排层）携带 **CNothing AuthAI 公钥** 去第三方完成注册/开通。
2. 第三方签发 API key 时，用 **CNothing AuthAI 公钥** 加密后返回（Agent 只看到密文）。
3. 客户端后端构造 `kv.save` 所需 envelope，将加密后的 API key 与**第三方标识符**（建议映射为 `namespace` + `key`）一并写入 CNothing。
4. CNothing 校验 AuthAI 协议后解密 envelope，**用 AuthAI 私钥解密第三方送来的 API key 密文**，再以静态加密形式落库。

**要点：** 第三方加密目标是 **CNothing AuthAI 公钥**，不是客户端公钥。写入动作走 `kv.save`，不是明文 HTTP 上传。

### 阶段三：使用第三方服务时取出凭证

1. Agent 确定要调用的**第三方标识符**（对应 KV 中的 `namespace` / `key`）以及该第三方的**服务公钥**。
2. 客户端后端构造 `kv.read` 的 `query_envelope`；Agent 转发时 **`recipient_public_key` 必须填第三方服务公钥**（不是 CNothing 公钥，也不是客户端公钥，除非凭证仅由客户端后端自用）。
3. CNothing 取出已存 API key，**加密给 `recipient_public_key` 指定的第三方公钥**，返回 `result_envelope_for_client`（对 Agent 仍是密文）。
4. Agent 将密文交给第三方服务；第三方用**自己的私钥**解密 API key，完成鉴权并提供 API。

**要点：** 读取时的加密方向与注册时相反——注册时第三方 → CNothing；使用时 CNothing → 第三方。

### 流程总览

```text
[接入 CNothing]
  Agent → authai_register(客户端公钥) → challenge → 后端解密

[第三方注册 / 存凭证]
  Agent → 第三方(携带 CNothing AuthAI 公钥)
  第三方 → Agent( API key 密文，加密给 CNothing )
  后端 → kv.save → CNothing 解密并存储

[调用第三方 API]
  Agent → kv.read(recipient_public_key = 第三方公钥, 第三方标识符)
  CNothing → 返回加密给第三方的 API key 密文
  Agent → 第三方服务(密文) → 第三方私钥解密 → 鉴权成功
```

### 与 AuthAI 协议步骤的关系

上文阶段一～三描述**业务语义**（谁加密给谁、凭证如何流转）。底层仍遵守本文「Registration / Save / Read」各节的 envelope 格式与 challenge 规则：

- 所有 `kv.save` / `kv.read` 必须附带有效的 `auth_envelope`（由客户端后端用 **CNothing AuthAI 公钥** 加密）。
- `recipient_public_key` 的含义是「**谁应该能解密读取结果**」——存第三方凭证、供第三方鉴权时，填**第三方服务公钥**。

## Operational Notes

- challenge 设计成单次使用，避免重放
- `namespace` 应表示平台/环境/业务域；第三方标识符建议编码进 `namespace` 或 `key`
- 如果 `key` 本身敏感，调用方应自行做映射或哈希
- 服务端审计表会记录注册、刷新、读写行为
