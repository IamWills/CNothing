# MCP 集成（CNothing v4）

**仅支持 v4。** 不要使用 AuthAI、KV envelope、`request_authorization`、
`invoke_capability`、`/authorize/{id}`、`/v2/*`、`/v3/*`。那些路径已下线或废弃。

面向 agent 的权威说明：[`skills/cnothing-v4/SKILL.md`](../skills/cnothing-v4/SKILL.md)
（在线：`https://cnothing.com/skill.md`）。

## 入口

| 入口 | 地址 |
| --- | --- |
| Hosted MCP | `https://cnothing.com/mcp` |
| Discovery | `https://cnothing.com/.well-known/mcp` |
| Manifest | `https://cnothing.com/mcp/manifest` |
| OpenAPI | `https://cnothing.com/openapi-v4.json` |
| Skill | `https://cnothing.com/skill.md` |
| Local stdio | [`packages/cnothing-mcp`](../packages/cnothing-mcp) |

连接后请阅读 `initialize.instructions` 与资源 `resource://cnothing/v4-workflow`。

---

## 角色分工（最重要）

| 角色 | 做什么 | 在哪里 |
| --- | --- | --- |
| **Agent** | `register_agent` → `request_access` → 把 **精确的** `approval_url` 发给用户 → 轮询拿 `grant_id` → `proxy_request` | MCP 或 `POST /v4/*` |
| **用户（人类）** | 登录 CNothing、连接 GitHub、打开 `approval_url` 点 Approve | 浏览器 |

**Agent 不能替用户登录 GitHub。** OAuth 只发生在用户浏览器里。

**Agent 绝不应向用户索要：** 密码、GitHub PAT、`session_token`、cookie、login token。

---

## 前提条件

真实调用 GitHub 前，下列全部满足：

1. Agent 已有 `agent_access_token`（`register_agent` / `POST /v4/agents/register`）
2. 用户已在 `https://cnothing.com/login` 登录（登录即注册）
3. 用户已在 `https://cnothing.com/connect` 连接过 GitHub
4. 用户已打开返回的 `approval_url`（形如 `https://cnothing.com/approve-proxy/{uuid}`）并批准
5. Agent 已拿到 `grant_id`

---

## v4 工具

| 工具 | 用途 |
| --- | --- |
| `register_agent` | 自助注册，拿 agent token |
| `start_sandbox` | 无人自测（sandbox grant + echo） |
| `list_providers` | 发现 provider slug（如 `github`） |
| `request_access` | 申请连接级权限，返回 `approval_url` |
| `get_access_status` | 轮询至 `approved`，得到 `grant_id` |
| `proxy_request` | 经代理调用任意 https API（服务端注入 token） |
| `list_grants` | 列出 grant |
| `submit_provider_proposal` | 提议新 OAuth/OIDC provider |
| `get_provider_proposal` | 查询 proposal |

---

## 完整流程（GitHub）

### 1. Agent 注册（如尚无 token）

`register_agent { "name": "my-agent" }`  
或 `POST /v4/agents/register`。

可选：`start_sandbox` → 用返回的 `echo_url` 调 `proxy_request` 自测。

### 2. 申请访问

```json
{
  "name": "request_access",
  "arguments": {
    "agent_access_token": "agent_...",
    "provider": "github",
    "reason": "代表您访问 GitHub 仓库",
    "user_id": "alice"
  }
}
```

**只要你知道用户身份，就必须传 `user_id`：** GitHub 用户名（如 `alice`）、
完整 id（`github:alice`）、短码（`u_XXXXXX`）、或此前记住的 `resolved_user_id`。
这样用户会收到手机推送，点批准即可，**不要**在已知用户名时还让用户手动复制链接。

仅在完全不知道身份时省略 `user_id`，并立刻把返回的 `approval_url` 发给用户。

返回 `access_request_id` 与 `approval_url`。

`approval_url` **永远是** `https://cnothing.com/approve-proxy/{uuid}`（解析到用户时
可能带 `?user=`）。**禁止**改写成 `/authorize/...`、`/v4/approve/...`、
`/v4/access-requests/.../approve`。

### 3. 通知用户批准

若 `pushed_to_devices > 0`：告知用户查看手机通知并批准；同时附上 `approval_url` 作兜底。

若未推送：把链接发给用户（优先在手机上打开）：

> 请打开此链接批准（手机 Universal Link 可直达 App）：  
> `https://cnothing.com/approve-proxy/{uuid}`

若用户是新人，可补充：

1. `https://cnothing.com/login` 登录  
2. `https://cnothing.com/connect` 连接 GitHub  
3. 打开上面的 `approval_url` 批准（或点推送）  
4. 可选：`https://cnothing.com/devices` 配对手机；把 agent ID / 短码告诉 agent，下次可推送 

### 4. 轮询

`get_access_status` 直到 `status: "approved"`，读取 `grant_id`。

### 5. 代理调用

```json
{
  "name": "proxy_request",
  "arguments": {
    "agent_access_token": "agent_...",
    "grant_id": "...",
    "method": "GET",
    "url": "https://api.github.com/user"
  }
}
```

REST 等价：`POST /v4/proxy`，Header `Authorization: Bearer agent_...`。

---

## 常见误解

| 误解 | 正确做法 |
| --- | --- |
| 「连上 MCP 就能登录 GitHub」 | MCP 是 Agent API；用户登录在 `approval_url` 浏览器/手机页 |
| 让用户去 `/login` 复制 token 给你 | 禁止；token 不得交给 Agent |
| Agent 调用 GitHub OAuth start | 仅供浏览器；Agent 不要调用 |
| 用 AuthAI / KV 做 GitHub 登录 | 已废弃，与 v4 proxy 无关 |
| 使用 `/authorize/{id}` 或 v2 工具 | 已下线；只用 `/approve-proxy/{uuid}` |
| 自己拼 approval URL | 只用 `request_access` 返回的原文 |
| 没有 user_id 就卡住不发请求 | 立刻创建请求并发送 `approval_url`；短码/ID 仅用于下次推送 |
| 已知 GitHub 用户名却不传 user_id | **必须**传 `user_id`（登录名或 `github:…`），让用户收推送批准 |
| 「OpenAPI 要 CNothing user id，不能传用户名」 | **可以**直接传 GitHub 用户名；没有单独的解析接口 |

---

## MCP 资源

| URI | 说明 |
| --- | --- |
| `resource://cnothing/v4-workflow` | v4 流程（Markdown） |
| `resource://cnothing/instructions` | 与 initialize.instructions 相同 |
