# CNothing

English: [README.md](./README.md)

**CNothing v4** 是面向 AI agent 的通用凭证注入代理。
用户按 OAuth 提供方批准一次后，agent 即可调用该提供方的 **任意 HTTPS API**。
Agent 永远接触不到 access token、refresh token 或 client secret。

线上： [https://cnothing.com](https://cnothing.com)

## Agent 文档（从这里开始）

| 资源 | 地址 |
| --- | --- |
| **主 Skill（必读）** | [`skills/cnothing-v4/SKILL.md`](./skills/cnothing-v4/SKILL.md) → `https://cnothing.com/skill.md` |
| MCP 说明 | [`docs/mcp.md`](./docs/mcp.md) |
| OpenAPI | [`openapi-v4.json`](./openapi-v4.json) → `https://cnothing.com/openapi-v4.json` |
| 托管 MCP | `https://cnothing.com/mcp` |
| 本地 MCP | [`packages/cnothing-mcp`](./packages/cnothing-mcp) |

**Agent 只支持 v4。** 不要使用 AuthAI envelope、KV 读写、
`request_authorization`、`invoke_capability`、`/authorize/{id}`、`/v2/*`、`/v3/*`。

## Agent 与人类各自做什么

| 角色 | 做什么 | 不要做什么 |
| --- | --- | --- |
| **Agent** | 注册 → `request_access` → 出示精确 `approval_url` → 轮询拿 `grant_id` → `POST /v4/proxy` | 自己登录 GitHub；持有 token；拼造 approval URL |
| **人类** | `/login` 登录、`/connect` 连接提供方、打开 `approval_url` 点批准 | 把密码 / PAT / session token 发给 agent |

```text
0. Agent 自助注册              →  POST /v4/agents/register { name }
1. 人类连接一次 Provider       →  https://cnothing.com/connect
2. Agent 申请访问              →  POST /v4/access-requests { provider, reason? }
3. 人类批准一次                →  精确的 approval_url（/approve-proxy/{uuid}）
4. Agent 经代理调用任意 API    →  POST /v4/proxy { grant_id, method, url, body? }
```

无人自测：`POST /v4/sandbox/start`，再用返回的 `echo_url` 调 proxy。

### 示例（已有 grant 后）

```bash
curl -X POST https://cnothing.com/v4/proxy \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "content-type: application/json" \
  -d '{
    "grant_id": "…",
    "method": "GET",
    "url": "https://api.github.com/user"
  }'
```

## Agent 用 MCP

- **托管：** `https://cnothing.com/mcp`
- **本地 stdio：** 配置 `CNOTHING_BASE_URL` + `CNOTHING_AGENT_TOKEN`，见
  [`packages/cnothing-mcp`](./packages/cnothing-mcp)

## 人类控制台

- 登录：`https://cnothing.com/login`
- 连接提供方：`https://cnothing.com/connect`
- 批准：`https://cnothing.com/approve-proxy/{uuid}`（只用 API 返回的 URL）
- 手机审批（可选）：`https://cnothing.com/devices` + iOS — 见 [`iOS/README.md`](./iOS/README.md)

## 旧版 API

| 版本 | 状态 |
| --- | --- |
| **v4** | 现行 |
| **v2 / v3** | 已移除 — `410 Gone` |
| **v1 AuthAI + KV** | 仅兼容期废弃接口 — **不用于** GitHub / agent OAuth |

## 本地开发

```bash
cp .env.example .env
bun install
bun run migrate
bun run dev
bun run console:dev
```

验证：`/health`、`/openapi-v4.json`、`/skill.md`、`/mcp`。  
E2E：`bun run e2e:v4`。部署：[`deploy/README.md`](./deploy/README.md)。

## 仓库

- [https://github.com/IamWills/CNothing](https://github.com/IamWills/CNothing)
