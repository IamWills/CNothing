# CNothing v4

CNothing 是面向 AI Agent 的认证基础设施。用户连接 OAuth Provider 并批准 Agent 的访问授权；CNothing 只在 HTTP 代理边界注入 Provider 凭证。Agent 永远不会获得密码、access token、refresh token、cookie 或 provider client secret。

Grant 是 Mandate 的当前表示：由 principal（现阶段为 User）授予 Agent 的委托权限，约束为 hosts、methods 和过期时间。Agent 继续调用 `list_grants` 和 `proxy_request`，不必理解 Mandate 这个名字。

AccessRequest 是 ApprovalRequest 的当前表示。Delegation 会铸造 Mandate。当 Mandate 显式设置 `constraints.require_approval`（控制台审批勾选、Grants 页开关，或批准 API）时，有副作用的 `proxy_request`（例如创建 GitHub Issue）会变成 Transaction Intent：Agent 仍然调用 `proxy_request`，收到带 `approval_url` 的 `approval_required`，用户批准后再重试同一请求。GET 不会被闸门拦住。Token 始终不离开 CNothing。

## 身份

CNothing 有三类主体，凭证不可混用。

| 主体 | 凭证 | 授权 |
| --- | --- | --- |
| Human | `/login` 之后的浏览器/iOS Session（GitHub / OIDC / 已配置 IdP） | 服务端用户行上的 `role=user` 或 `role=admin` |
| Agent | 一次性 Agent token（`agent_…`） | Mandate / Grant / Policy / Approval / Transaction Intent |
| Service | `KEYSERVICE_BEARER_TOKEN`（别名 `CN_SERVICE_TOKEN`） | Bootstrap、恢复、受信自动化 |

管理员和普通用户使用同一个 `/login`。没有 `/admin/login`，也没有第二套密码。控制台会按角色隐藏管理页；所有管理写操作仍由服务端 `requireAdmin()` 执行。

Service bearer token **不是**日常人类管理员登录凭证。全新部署后，先正常登录，再提升首位管理员：

```bash
curl -X POST "$CN_URL/v4/admin/bootstrap" \
  -H "Authorization: Bearer $KEYSERVICE_BEARER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"github:your-login"}'
```

系统中一旦已有 admin，bootstrap 即被禁用。之后的提升/降级需要 Human admin session（`POST /v4/admin/users/promote` 与 `/demote`）。不允许移除最后一个 admin。

### 从 Admin Bearer Token 升级

1. 部署本版本并执行 `bun run migrate`（`007_user_roles.sql` 增加 `cap_users.role`，默认 `user`）。
2. 在 `/login` 用现有身份提供方登录。既有 session 继续有效。
3. 用 service token 调用 `POST /v4/admin/bootstrap`，`user_id` 来自 `/v4/auth/me`。
4. 刷新控制台；Agents 和 Providers 仅对 `role=admin` 可见。
5. 停止使用旧的 Console Admin Token 输入框。控制台不再保存或发送该 token。

## 唯一支持的流程

1. 宿主插件若还没有 Agent token，就由插件自己调用 `POST /v4/agent-enrollments`；用户在 `/approve-agent/{id}` 批准该运行时。token 只写入宿主密钥舱，不进入模型上下文。规格：`https://cnothing.com/plugin.md`。
2. 用户在 `/login` 登录，在 `/connect` 连接第三方 Provider。
3. Agent 首先调用 `list_grants`，优先复用符合 Provider 和 Host 范围的有效 Grant。
4. 没有可用 Grant 时，调用 `list_providers`，再调用 `request_access`。
5. 已知用户身份且设备已配对时，CNothing 向 iOS App 推送审批通知；返回的 `approval_url` 始终作为可靠兜底。
6. Agent 通过 `get_access_status` 获得批准结果，然后用 `proxy_request` 调用第三方 API。若 Mandate 设置了 `require_approval`，写操作会返回 `approval_required`；用户批准后，Agent 重试同一条 `proxy_request`。

## Provider Registry

`cap_oauth_providers` 是唯一的 Provider 实体。一条注册表记录同时承载 Provider 的两种角色：Agent 经凭证代理访问的第三方 API，以及在 `login_enabled` 为真时用户登录控制台所用的身份提供方。行上记录 `source`（`manual` | `discovered` | `imported`）以及存储状态 `active` | `unconfigured` | `disabled`。控制台把它们映射为 DISCOVERED / UNVERIFIED / REVIEWED / ACTIVE / DISABLED。发现得到的元数据一律视为不可信，走与代理相同的 SSRF 校验。Provider client secret 只存放在 Vault，不写入 Provider 记录本身。

托管 MCP：`https://cnothing.com/mcp`

Agent Skill：`https://cnothing.com/skill.md`

插件最低标准：`https://cnothing.com/plugin.md`

OpenAPI：`https://cnothing.com/openapi.json`

## 核心组件

- `src/v4`：Agent 身份与用户批准的 enrollment、Human 用户与角色、用户会话、Provider Registry/Connection、加密 Vault、访问申请、Grant、Transaction Intent、凭证注入代理、APNs、设备配对、设备签名审批和 share code。
- `src/mcp`：托管 MCP transport 与工具执行。
- `agenttools`：宿主侧 Agent SDK（`cnothing-agent`）、stdio MCP、DeepSeek Harness 插件。Enrollment 与 agent token 留在宿主进程。
- `packages/cnothing-mcp`：兼容入口，启动 `agenttools/mcp`。
- `console`：用户登录、Provider 连接、按角色显示的 Agent/Provider 管理、审批、Grant 和设备管理。
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

集成测试需要 Postgres。测试会自行创建并迁移独立数据库（默认 `cnothing_test`，可用 `TEST_DATABASE_URL` 覆盖）；连不上 Postgres 时这些用例会被跳过，因此 CI 应设置 `CNOTHING_REQUIRE_DB_TESTS=1`，让数据库不可用直接判定失败。

生产 OAuth App 必须配置 `openapi-v4.json` 中列出的精确 v4 callback URL。GitHub 控制台登录另支持已登记的旧地址 `https://cnothing.com/v2/auth/github/callback`（用 `KEYSERVICE_GITHUB_OAUTH_REDIRECT_URI` 对齐 GitHub OAuth App 上的 Authorization callback URL）。
