# MCP Integration

`CNothing` 提供公开 MCP 入口：

- `GET /mcp`
- `POST /mcp`
- `GET /.well-known/mcp`
- `GET /mcp/sse`
- `POST /mcp/message`

## v2 工具（推荐）

| 工具 | 用途 |
| --- | --- |
| `invoke_capability` | **主 API**：按业务名调用能力（如 `github.create_issue`） |
| `list_capabilities` | 发现已注册能力 |
| `request_authorization` | Agent 向用户申请能力授权（OAuth 风格） |

Agent 只需 `agent_access_token`，传入 `capability` + `input`，**永不接触 API key**。

```json
{
  "name": "invoke_capability",
  "arguments": {
    "agent_access_token": "agent_...",
    "capability": "github.create_issue",
    "input": { "repo": "org/repo", "title": "Bug report" }
  }
}
```

REST 等价：`POST /v2/capabilities/invoke`，Header `Authorization: Bearer agent_...`。

完整规范见 [`/openapi-v2.json`](../openapi-v2.json)。

### v2 典型流程

1. `list_capabilities` — 发现可用能力
2. `request_authorization` — 用户未授权时发起申请，用户在 Console `/authorize/:id` 批准
3. `invoke_capability` — 携带 grant 调用业务 API
4. 高风险能力可能返回 `pending: true`，用户确认后带 `confirmation_id` 重试

## v1 工具（已废弃）

以下工具仍可用，但响应含 `_deprecation` 字段，**请勿用于新集成**：

- `get_authai_public_key`
- `authai_register` / `authai_refresh`
- `authai_key_holder_*`
- `kv_save` / `kv_read`

迁移指南：`GET /v2/platform/migration`  
Console 迁移页：`/migration`

---

## 第三方凭证流程（v1 遗留，Agent 必读）

> 仅在你维护 v1 KV 集成时需要。新集成请使用 v2 Connector + `invoke_capability`。

`CNothing` 用于储存第三方服务的 API key 等敏感信息。Agent 最常搞混三把公钥：

| 公钥 | MCP / HTTP | 用途 |
| --- | --- | --- |
| CNothing AuthAI 公钥 | `get_authai_public_key` | 协议 envelope 加密目标；**提供给第三方**让其把 API key 加密给 CNothing |
| 客户端公钥 | `authai_register` 提交 | AuthAI 身份注册；解密 challenge；仅当凭证由**客户端后端**使用时作为 `recipient_public_key` |
| 第三方服务公钥 | `kv_read` 的 `recipient_public_key` | 读取凭证供**第三方服务**鉴权时必须使用 |

完整说明见 [protocol.md](./protocol.md) 中「第三方服务凭证：正确用法」。

## 常见错误用法（v1 遗留）

以下错误在 Searchengine 等第三方鉴权时**高频出现**：

| 错误做法 | 典型后果 |
| --- | --- |
| `kv_read` 的 `recipient_public_key` 填 **CNothing AuthAI 公钥** 或**客户端公钥**，但消费方是第三方 | 第三方 **`Failed to decrypt encrypted_key`** |
| 将 `authenticate_agent` 的 **`api_key_envelope` 原样 `kv_save`** | 后续 **`Failed to decrypt encrypted_key`** |
| 把整段 **`result_envelope_for_client` 当作第三方 `api_key_envelope`** | **`Decrypted envelope missing api_key`** |

**v2 正确路径：** Connector 本地保管 `GITHUB_TOKEN` / `SLACK_BOT_TOKEN` 等；Agent 只调用 `invoke_capability`。

## MCP Usage Pattern (v1 legacy)

1. 调 `get_authai_public_key`
2. 调 `authai_register`，提交客户端公钥
3. 客户端后端解密 `challenge_for_client` 并构造 envelope
4. AI 通过 `kv_save` / `kv_read` 转发密文

公钥持有者挑战验证流程见 [protocol.md](./protocol.md)。

## Discovery

- MCP manifest: `/mcp/manifest`
- OpenAPI v2: `/openapi-v2.json`
- Platform status: `/v2/platform/status`
- Skills: `/skills/index.json`
