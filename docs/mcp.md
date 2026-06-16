# MCP Integration

`CNothing` 提供公开 MCP 入口：

- `GET /mcp`
- `POST /mcp`
- `GET /.well-known/mcp`
- `GET /mcp/sse`
- `POST /mcp/message`

## Exposed Tools

- `get_authai_public_key`
- `authai_register`
- `authai_refresh`
- `authai_key_holder_sign_challenge`（推荐）
- `authai_key_holder_verify_signature`（推荐）
- `authai_key_holder_challenge`
- `authai_key_holder_verify`
- `kv_save`
- `kv_read`

## 第三方凭证流程（Agent 必读）

`CNothing` 用于储存第三方服务的 API key 等敏感信息。Agent 最常搞混三把公钥：

| 公钥 | MCP / HTTP | 用途 |
| --- | --- | --- |
| CNothing AuthAI 公钥 | `get_authai_public_key` | 协议 envelope 加密目标；**提供给第三方**让其把 API key 加密给 CNothing |
| 客户端公钥 | `authai_register` 提交 | AuthAI 身份注册；解密 challenge；仅当凭证由**客户端后端**使用时作为 `recipient_public_key` |
| 第三方服务公钥 | `kv_read` 的 `recipient_public_key` | 读取凭证供**第三方服务**鉴权时必须使用 |

**存凭证：** Agent 带 CNothing AuthAI 公钥向第三方注册 → 第三方返回 ksp1 加密 API key → 后端构造 envelope → `kv_save`（`value` 可为完整 `api_key_envelope`）。  
**用凭证：** 指定第三方标识符 + 第三方公钥 → 后端构造 envelope → `kv_read`（`recipient_public_key` = 第三方公钥）→ CNothing 返回重加密后的 ksp1 信封 → 交给第三方解密鉴权。

完整说明见 [protocol.md](./protocol.md) 中「第三方服务凭证：正确用法」。

## 常见错误用法（Agent 自主对接时必读）

以下错误在 Searchengine 等第三方鉴权时**高频出现**，对应错误信息供对照：

| 错误做法 | 典型后果 |
| --- | --- |
| `kv_read` 的 `recipient_public_key` 填 **CNothing AuthAI 公钥**（`get_authai_public_key`）或**客户端公钥**，但实际消费方是 Searchengine | Searchengine 返回 **`Failed to decrypt encrypted_key`** |
| 将 Searchengine `authenticate_agent` 返回的 **`api_key_envelope` 原样 `kv_save`**（该信封仅加密给 `reader_public_key`，未解密） | 后续 `kv_read` 重包装后 Searchengine 仍报 **`Failed to decrypt encrypted_key`**（内层仍是 reader 密钥） |
| 把 `authenticate_agent` 的 **`api_key_envelope` 直接当作 Searchengine 检索凭证** | **`Failed to decrypt encrypted_key`**（RSA 层加密对象是 reader 公钥，不是 search-api 公钥） |
| 把 `kv_read` 整段 **`result_envelope_for_client` 当作 Searchengine 的 `api_key_envelope`** | Searchengine 报 **`Decrypted envelope missing api_key`**（外层是 kv.read.result 结构，不是 api_key 载荷） |
| Agent 自行解密 envelope 或自行用公钥加密 api_key | 违反信任边界；密钥/明文泄露风险 |

**正确要点：**

1. **`recipient_public_key` 的含义是「谁应该能解密读取结果」** —— 凭证要给 Searchengine 鉴权时，必须填 Searchengine 的公钥（`GET /v1/auth/public-key` → `search_api_public_key.public_key_pem`），**不是** CNothing 公钥。
2. **Searchengine `authenticate_agent` 下发的 `api_key_envelope` 只加密给 `reader_public_key`** —— 必须先由**可信后端**用 reader 私钥解密，再以明文 JSON（或标准 ksp1→CNothing 路径）经 `kv_save` 入库；**禁止**原样存入。
3. **`result_envelope_for_client` 只有 recipient 私钥持有者能解密** —— Agent 无法从中取出 `items`；若走加密 api_key 检索路径，须由后端解密后取 `items[<key>]` 内的 ksp1 信封再交给 Searchengine（或注入 HTTP 头）。
4. **无后端解密的自主 Agent 推荐路径**：每次 Searchengine 检索使用 **`client_uuid` + 新的 `auth_envelope`**（CNothing `authai_refresh`），**不需要** api_key envelope。

## MCP Usage Pattern

AI 通过 MCP 使用 `CNothing` 时，应遵守以下流程：

1. 调 `get_authai_public_key`，获取 CNothing 公钥信息
2. 调 `authai_register`，提交客户端公钥，拿到 `challenge_for_client`
3. 将 `challenge_for_client` 交给客户端后端解密
4. 由客户端后端构造：
   - `auth_envelope`
   - `data_envelope` 或 `query_envelope`
   - 读取时还需 `recipient_public_key`（读取者 RSA 公钥，必填）
5. AI 再通过 `kv_save` 或 `kv_read` 转发这些 envelope
6. `kv_read` 的结果由客户端后端解密（服务端 MUST 先加密给 `recipient_public_key`）

公钥持有者挑战验证（A/B + S1/S2）流程：

1. 调 `authai_key_holder_challenge`，提交对方公钥，拿到：
   - `challenge_for_target`（A）
   - `challenge_for_authai`（B）
   - `verification_id`
2. 将 A 发给对方，对方用私钥解密得到 `S2`
3. 对方回传 `S2`，同时保留 B 原样不变
4. 调 `authai_key_holder_verify`，提交 `verification_id + responder_secret(S2) + challenge_for_authai(B)`
5. CNothing 用自己的私钥解密 B 得到 `S1`，比对 `S1 === S2`
6. 一致则 `verified=true`，该 challenge 标记为已使用

推荐的公钥持有者签名验证流程：

1. 调 `authai_key_holder_sign_challenge`，提交对方公钥，获得 `challenge_text` 与 `verification_id`
2. 将 `challenge_text` 发给对方，由对方私钥对该文本做签名（`RSA-SHA256`）
3. 对方返回签名（`base64` 或 `base64url`）
4. 调 `authai_key_holder_verify_signature`，提交：
   - `verification_id`
   - `challenge_text`
   - `signature`
   - `target_public_key`
5. CNothing 校验 challenge 哈希、目标公钥指纹与签名合法性
6. 合法则 `verified=true`，challenge 标记为已使用

## Important Safety Rules

- AI 不应要求客户端提供私钥
- AI 不应尝试解释 envelope 密文字段
- AI 不应自行构造 challenge 明文
- AI 不应把读取结果的密文当作普通 JSON 业务对象使用

## Recommended Tooling Split

- AI：
  - 发现流程
  - 调 MCP
  - 转发密文
- 客户端后端：
  - 解密 challenge
  - 构造 auth/data/query envelope
  - 解密 `kv.read.result`
