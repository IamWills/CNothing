# CNothing Secretless Capability Execution Gateway — 变更说明

## 1. 变更摘要

在现有 v2.5/v3 之上增量升级为 **Secretless Capability Execution Gateway**：

- 新增 `/api/v3/*` 契约面（invoke / approvals / executions / audit / policies / secrets metadata）
- 新增按次 **Approval Engine**（`approval_policy`：none / once / once_per_resource / every_time …）
- 扩展 **Secret Vault** 类型与 `secret_ref`；解密必写 `secret_decrypted` 审计
- 新增 **Execution Workers** 抽象；完整实现 `OAuthApiWorker`；`BrowserWorker` 仅接口
- 补齐 GitHub demo：`github.oauth.connect` / `get_user` / `list_repos` / `create_repo`
- Console 新增 `/dashboard/*` 页面（capabilities / providers / connections / approvals / audit / policies）
- 旧 `/v2`、`/v3` API 保持兼容；`/v3/agent/invoke` 委托新网关（confirmation_id 仍走旧路径）

原则：**Agent thinks. cnothing executes. Secrets never leave cnothing.**

## 2. 新增 API 列表

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/v3/openapi.json` | Gateway OpenAPI |
| GET/POST | `/api/v3/providers` | Provider 列表 / 注册（admin） |
| POST | `/api/v3/oauth/connect` | 用户 OAuth 连接启动 |
| GET | `/api/v3/capabilities` | Capability 列表（含 execution_type / approval_policy） |
| GET | `/api/v3/capabilities/:id` | Capability 详情 |
| POST | `/api/v3/capabilities/:id/invoke` | **核心无密钥调用** |
| GET | `/api/v3/approvals` | 用户审批列表 |
| GET | `/api/v3/approvals/:id` | 审批状态 |
| POST | `/api/v3/approvals/:id/decide` | 批准/拒绝（可自动 resume 执行） |
| GET | `/api/v3/executions/:id` | 执行状态 |
| GET | `/api/v3/audit` | Trust 审计（无 secret） |
| GET/POST | `/api/v3/policies` | 策略与 capability permissions |
| GET | `/api/v3/secrets/:ref` | **仅 metadata**；`?include_value=1` → 403 |

Invoke 响应三态：`pending_approval` | `completed` | `failed`（含 `policy_denied` / `reconnect_required`）。

## 3. 数据库 Migration

文件：[`migrations/017_v3_capability_gateway.sql`](../migrations/017_v3_capability_gateway.sql)

- 扩展 `cap_capabilities`：`execution_type`、`approval_policy`、`provider`、`owner_user_id`、`deleted_at`
- 扩展 `cap_secret_vault`：更多 secret 类型、`secret_ref`、`provider_id`、`user_id`
- 新建 `cap_approvals`、`cap_executions`、`cap_capability_permissions`、`cap_rate_limit_buckets`
- 扩展 `cap_trust_audit` / `cap_invoke_audit`：ip、user_agent、approval_id、input_summary

执行：`bun run migrate`

## 4. 安全设计说明

- Agent 只持有 `agent_*` 平台令牌；第三方 OAuth token 仅存 Vault（AES-256-GCM + `KEYSERVICE_MASTER_KEY`）
- 解密只发生在 worker 执行阶段，并写 `secret_decrypted` 审计
- 所有 Agent 响应经 `sanitizeAgentResponse`；禁止返回 token / cookie / Authorization
- `approval_url` 含短期 token（默认 15m，`KEYSERVICE_APPROVAL_URL_TTL_SECONDS`）
- 前端与 `/api/v3/secrets/:ref` 永不返回 plaintext
- Policy 默认 deny `github.delete_repo`；`github.create_repo` 需审批

## 5. GitHub Demo 测试步骤

1. 配置 `KEYSERVICE_GITHUB_OAUTH_CLIENT_ID/SECRET`，启动服务并 migrate
2. Console 登录 → `/connect` 连接 GitHub
3. 注册 Agent，对 `github.get_user` / `github.create_repo` 完成 grant（`/approve`）
4. Agent 调用：

```bash
curl -X POST "$BASE/api/v3/capabilities/github.get_user/invoke" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"USER_ID","input":{}}'
# 期望 status=completed，响应无 token

curl -X POST "$BASE/api/v3/capabilities/github.create_repo/invoke" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"USER_ID","input":{"name":"demo-repo","private":true},"idempotency_key":"k1"}'
# 期望 status=pending_approval + approval_url
```

5. 用户打开 `approval_url` 批准 → 自动执行创建 repo
6. 检查 `/dashboard/audit`：有调用链，无 secret
7. Revoke connection 后再 invoke → `reconnect_required`
8. Invoke `github.delete_repo` → `policy_denied`

自动化：`bun test src/v3/__tests__`；E2E：`bun run e2e:v3`

## 6. 已知限制

- BrowserWorker / SshWorker / ApiKeyWorker / ManualWorker 仅为接口或 stub
- 无云 KMS/HSM；仍使用本地 master key
- spending limit 字段已预留，未接支付
- Idempotency 存 Postgres，无独立 TTL 清理 job
- 旧 v2 connector JWT 路径仍存在（legacy）

## 7. 后续建议

- BrowserWorker 实装（会话隔离 + CAPTCHA/MFA human path）
- 接入 KMS、per-tenant DEK
- WebAuthn step-up
- 异步 execution queue（长任务）
- Agent token 轮换与短期 attestation
- SDK 默认 `apiVersion` 切到 api-v3
