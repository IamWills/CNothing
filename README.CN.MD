# CNothing v4

CNothing 是面向 AI Agent 的认证基础设施。用户连接 OAuth Provider 并批准 Agent 的访问授权；CNothing 只在 HTTP 代理边界注入 Provider 凭证。Agent 永远不会获得密码、access token、refresh token、cookie 或 provider client secret。

## 唯一支持的流程

1. 管理员在控制台创建 Agent，并把一次性展示的 Agent token 配置到 MCP 客户端环境。
2. 用户在 `/login` 登录，在 `/connect` 连接第三方 Provider。
3. Agent 首先调用 `list_grants`，优先复用符合 Provider 和 Host 范围的有效 Grant。
4. 没有可用 Grant 时，调用 `list_providers`，再调用 `request_access`。
5. 已知用户身份且设备已配对时，CNothing 向 iOS App 推送审批通知；返回的 `approval_url` 始终作为可靠兜底。
6. Agent 通过 `get_access_status` 获得批准结果，然后用 `proxy_request` 调用第三方 API。

托管 MCP：`https://cnothing.com/mcp`

Agent Skill：`https://cnothing.com/skill.md`

OpenAPI：`https://cnothing.com/openapi.json`

## 核心组件

- `src/v4`：Agent 身份、用户会话、OAuth Provider/Connection、加密 Vault、访问申请、Grant、凭证注入代理、APNs、设备配对、设备签名审批和 share code。
- `src/mcp`：托管 MCP transport 与工具执行。
- `packages/cnothing-mcp`：stdio MCP 适配器，从 `CNOTHING_AGENT_TOKEN` 环境变量读取 Agent 凭证。
- `console`：用户登录、Provider 连接、Agent 创建、审批、Grant 和设备管理。
- `iOS`：多账户配对、APNs 和 Secure Enclave 审批签名。

## 本地开发

```bash
bun install
bun run generate-secrets
# 将 .local-keys/generated.env 加入环境，并配置 DATABASE_URL。
bun run migrate
bun run dev
```

从旧版本升级时，先让 V4 启动迁移 OAuth 凭证并验证备份；确认迁移状态完成后，再由运维人员显式执行 `migrations/manual/cleanup_pre_v4.sql`。该破坏性清理不会被普通迁移自动运行。

验证：

```bash
bun test
bun run typecheck
bun run console:typecheck
```

生产 OAuth App 必须配置 `openapi-v4.json` 中列出的精确 v4 callback URL。
