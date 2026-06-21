# MCP Integration

`CNothing` 提供公开 MCP 入口：

- `GET /mcp`
- `POST /mcp`
- `GET /.well-known/mcp`
- `GET /mcp/sse`
- `POST /mcp/message`

连接 MCP 后，`initialize` 响应中的 **instructions** 以及 MCP 资源 **`resource://cnothing/v2-user-authorization`** 说明完整授权流程。**Agent 必读。**

---

## 最重要：MCP 不能用来给用户登录 GitHub

| 角色 | 做什么 | 在哪里 |
| --- | --- | --- |
| **Agent** | `request_authorization` → 把 `approval_url` 发给用户 → 轮询状态 → `invoke_capability` | `POST /mcp`（使用 **agent access token**） |
| **用户（人类）** | 在浏览器打开 `approval_url` → 点 **Sign in with GitHub** → 点 **Allow** | **https://cnothing.com/authorize/{id}** |

**MCP 没有任何工具可以让 Agent 替用户登录 GitHub。**  
GitHub OAuth 只发生在用户的浏览器里，不在 Agent 对话里。

**Agent 绝不应向用户索要：** `session_token`、`login_token`、`user_id`、GitHub token。

---

## v2 工具（推荐）

| 工具 | 用途 |
| --- | --- |
| `request_authorization` | 申请能力授权，返回 `approval_url` 给用户在浏览器打开 |
| `invoke_capability` | 用户批准后调用能力（如 `github.list_repositories`） |
| `list_capabilities` | 发现已注册能力 |

### 完整流程（GitHub 为例）

**1. Agent 申请授权（不要传 `user_id`）**

```json
{
  "name": "request_authorization",
  "arguments": {
    "agent_access_token": "agent_...",
    "capabilities": ["github.list_repositories", "search.query"],
    "reason": "代表您访问 GitHub 仓库并搜索文档"
  }
}
```

**2. Agent 只发一个链接给用户**

> 请在浏览器中打开此链接，按提示用 GitHub 登录并点击 Allow：  
> `https://cnothing.com/authorize/{id}`

**3. 用户在浏览器中**

1. 打开上面的链接  
2. 若未登录 → 在同一页点击 **Sign in with GitHub**（不要单独去 `/login` 复制 token）  
3. 在 GitHub 授权 CNothing  
4. 回到授权页，点击 **Allow selected capabilities**

**4. Agent 轮询**

`GET https://cnothing.com/v2/authorize/{id}`，直到 `status` 为 `approved`。

**5. Agent 调用能力（通常无需 `user_id`）**

```json
{
  "name": "invoke_capability",
  "arguments": {
    "agent_access_token": "agent_...",
    "capability": "github.list_repositories",
    "input": { "per_page": 10 }
  }
}
```

REST 等价：`POST /v2/capabilities/invoke`，Header `Authorization: Bearer agent_...`。

完整规范见 [`/openapi-v2.json`](../openapi-v2.json)。

### 常见误解

| 误解 | 正确做法 |
| --- | --- |
| 「连上了 cnothing.com MCP 就能登录 GitHub」 | MCP 是 Agent API；用户登录在 **approval_url** 浏览器页 |
| 让用户去 `/login` 复制 `session_token` | 已废弃；token 不得交给 Agent |
| Agent 调用 `GET /v2/auth/github/start` | 仅供浏览器重定向，Agent 不要调用 |
| 用 `authai_register` 做 GitHub 登录 | v1 客户端注册，与用户 GitHub OAuth 无关 |
| 向用户要 `github:用户名` | 批准时自动绑定，无需用户提供 |

---

## v1 工具（已废弃）

以下工具仍可用，但响应含 `_deprecation` 字段，**请勿用于新集成**：

- `get_authai_public_key`
- `authai_register` / `authai_refresh`
- `authai_key_holder_*`
- `kv_save` / `kv_read`

迁移指南：`GET /v2/platform/migration`  
Console 迁移页：`/migration`

---

## MCP 资源

| URI | 说明 |
| --- | --- |
| `resource://cnothing/v2-user-authorization` | **v2 用户授权 + GitHub 登录**（Markdown，Agent 必读） |
| `resource://keyservice/getting-started` | 快速开始 JSON |
| `resource://keyservice/protocol` | 协议与 v2 端点摘要 |
