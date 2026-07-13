# CNothing Execution Trust Layer — 升级交付说明

## 1. 变更摘要

在现有 v2.5/v3 Capability Gateway 之上，增量升级为 **Execution Trust Layer for AI Agents**：

- 独立 **Policy Engine**（`cap_trust_policies`）：allow / deny / require_approval / require_reauth / rate_limit / time_window / scope_limit / destructive_action_block / allowlist
- **Execution Lifecycle** 一等对象：created → policy_checking → pending_approval → approved → running → completed | denied | reconnect_required | …
- **Audit Chain**：每次 invoke 生成 `audit_chain_id`，事件哈希链接（prev_hash / chain_hash）
- **Sanitizer** 统一层：Worker 输出与 Agent 响应递归脱敏
- **OAuthApiWorker** 生产实现；Browser/SSH/ApiKey/Webhook/Manual 生产级接口预留
- Invoke 响应四态：`completed` | `pending_approval` | `denied` | `reconnect_required`
- Console 定位升级 + Executions / Secret Vault / Audit Chain 视图
- 保留 v2 / v2.5 / v3 兼容；旧 invoke 内部转发新 Lifecycle

核心原则：

> Agent thinks. cnothing executes. Secrets never leave cnothing. Every risky action is approved, executed, and audited.

最高优先级闭环：

```
Agent → github.create_repo
  → Policy Engine (require_approval)
  → Execution + Approval
  → 用户批准
  → OAuthApiWorker 从 Vault 取 token
  → GitHub API
  → Sanitizer
  → Audit Chain
  → Agent 收到 sanitized result
```

## 2. 新增目录结构

```
migrations/018_execution_trust_layer.sql
src/v3/policy-engine/policy-engine-v3.ts      # 升级
src/v3/policy-engine/policy.repository.ts     # 新增
src/v3/audit/audit-chain.ts                   # 新增
src/v3/sanitizer/sanitizer.ts                 # 新增
src/v3/invocation/capability-invocation.gateway.ts  # 升级
src/v3/workers/types.ts                       # ExecutionContext
src/v3/workers/oauth-api.worker.ts            # 升级
src/v3/workers/browser.worker.ts              # MFA/redact 接口
src/v3/workers/stubs.ts                       # 生产接口注释
src/v3/__tests__/trust-layer.test.ts          # 新增
console/app/dashboard/executions/
console/app/dashboard/secrets/
console/components/console/dashboard-executions-page.tsx
console/components/console/dashboard-secrets-page.tsx
docs/execution-trust-layer.md                 # 本文档
```

## 3. 新增 / 升级 API 列表

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/v3/openapi.json` | Execution Trust Layer OpenAPI 3.2 |
| POST | `/api/v3/capabilities/:id/invoke` | 核心无密钥调用（四态响应） |
| GET | `/api/v3/executions` | 执行列表（lifecycle；Agent 可查自己的） |
| GET | `/api/v3/executions/:id` | 执行详情 + policy_decision + audit_chain_id |
| POST | `/api/v3/executions/:id/cancel` | 取消非终态执行（同步取消 pending approval） |
| POST | `/api/v3/executions/:id/retry` | 对 failed/timeout/cancelled/reconnect_required 用 safe_input 重试 |
| GET/POST | `/v3/executions*` | 上述路径的公开别名（rewrite → `/api/v3/executions*`） |
| GET | `/api/v3/audit` | 审计查询（可按 audit_chain_id） |
| GET | `/api/v3/audit/chains/:id` | Audit Chain 视图 + 完整性校验 |
| GET/POST | `/api/v3/policies` | Trust policies + permissions |
| GET | `/api/v3/secrets` | Vault **metadata only** |
| GET | `/api/v3/secrets/:ref` | metadata；`include_value=1` → 403 |
| GET | `/api/v3/approvals` | 统一 Approval 列表（`?type=capability_grant|execution_confirmation|reauthentication`） |
| GET | `/api/v3/approvals/:id` | Approval 详情 |
| POST | `/api/v3/approvals/:id/approve` | 批准（preferred） |
| POST | `/api/v3/approvals/:id/reject` | 拒绝（preferred） |
| POST | `/api/v3/approvals/:id/decide` | 兼容 decide（deprecated） |
| GET/POST | `/v3/approvals*` | 上述路径公开别名 |
| GET | `/api/v3/providers` | Provider 列表 |
| POST | `/api/v3/oauth/connect` | OAuth 连接 |

Invoke 响应：

- `completed` + sanitized `result`
- `pending_approval` + `approval_url` + `safe_summary`
- `denied` + `policy_denied`（HTTP 403）
- `reconnect_required` + `connection_url`（HTTP 409）

## 4. 数据库 Migration

文件：`migrations/018_execution_trust_layer.sql`

- 新建 `cap_trust_policies`（独立 Policy Engine）+ GitHub demo 种子策略
- 扩展 `cap_executions`：lifecycle 状态、audit_chain_id、policy_decision、worker_type、safe_input、sanitized_output
- 扩展 `cap_approvals`：execution_id、policy_id、cancelled、safe_input_summary
- 扩展 `cap_trust_audit`：audit_chain_id、prev_hash、chain_hash、sequence_no
- 新建 `cap_worker_runs`

执行：`bun run migrate`

## 5. 安全设计说明

| 要求 | 实现 |
|------|------|
| secret encryption at rest | AES-256-GCM + `KEYSERVICE_MASTER_KEY` → `cap_secret_vault` |
| no secret in logs | `sanitizeLog` / `redactLogMessage` |
| no secret in API | `sanitizeAgentFacing` 全出口 |
| no secret in frontend | Secret Vault 页仅 metadata |
| Agent 不可读 secret | `/api/v3/secrets/:ref?include_value=1` → 403 |
| decrypt only in worker | Gateway 只传 `secret_refs` / `connection_id`；`OAuthApiWorker` 内部解密并写 `secret_accessed` |
| Policy deny > Grant allow | Policy Engine 在 Grant 之后、执行之前强制评估 |
| short-lived approval URL | `KEYSERVICE_APPROVAL_URL_TTL_SECONDS`（默认 900s） |
| approval consumed | 执行成功后 approval → `consumed`，防重复 resume |
| token refresh server-side | `oauthConnectionService.refreshConnectionTokens`（Gateway 触发，Worker 取新 token） |
| worker timeout | `timeout_ms` + `Promise.race` → execution status `timeout` |
| idempotency | `idempotency_key` → `cap_executions` unique |
| dry_run | 不调用第三方，直接返回 would_execute |
| Audit Chain | 哈希链接，无 secret 字段 |
| v2/v2.5 invoke 转发 | `/v2/agent/invoke` 与 `/v3/agent/invoke`（无 confirmation_id）走新 Lifecycle |

## 6. GitHub Demo 使用步骤

1. 配置 `KEYSERVICE_GITHUB_OAUTH_CLIENT_ID/SECRET`，`bun run migrate`，启动服务
2. Console 登录 → `/connect` 连接 GitHub（token 入 Vault）
3. 注册 Agent，对 `github.get_user` / `github.create_repo` 完成 grant
4. Agent 调用：

```bash
# 直接执行（allow）
curl -X POST "$BASE/api/v3/capabilities/github.get_user/invoke" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"USER_ID","input":{}}'

# 触发审批（require_approval）
curl -X POST "$BASE/api/v3/capabilities/github.create_repo/invoke" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"USER_ID","input":{"name":"demo-repo","private":true},"idempotency_key":"k1"}'

# 默认拒绝（deny）
curl -X POST "$BASE/api/v3/capabilities/github.delete_repo/invoke" \
  -H "Authorization: Bearer $AGENT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"user_id":"USER_ID","input":{"owner":"o","repo":"r"}}'
```

5. 打开 `approval_url` 批准 → 自动 resume → OAuthApiWorker 从 Vault 取 token → 创建 repo
6. `/dashboard/audit` 查看 chain；`/dashboard/executions` 查看 lifecycle
7. Revoke connection 后再 invoke → `reconnect_required`
8. `dry_run: true` 不打 GitHub

自动化：`bun test src/v3/__tests__`；E2E：`bun run e2e:v3`

## 7. 测试运行结果

```
bun test
# 64 pass, 0 fail

bun test src/v3/__tests__
# 40 pass（含 Policy Engine deny>allow、Sanitizer、Audit Chain、四态契约）
```

单元测试覆盖：

1. Agent 不能读取 secret — ✓
2. Vault 类型归一化（明文不经 API）— ✓
3. 日志无真实 token — ✓
4. get_user allow 决策 — ✓
5. create_repo require_approval — ✓
6. 审批后执行 — e2e / 手动（approve → auto-resume）
7. delete_repo 默认 deny — ✓
8. token refresh — oauth service（server-side）
9. reconnect_required 契约 — ✓
10. dry_run 契约 — ✓
11. idempotency — gateway 实现
12. Audit chain — ✓
13. Sanitizer — ✓
14. Policy deny > grant allow — ✓

## 8. 已知限制

- BrowserWorker / SshWorker / ApiKeyWorker / WebhookWorker / ManualWorker 仅为生产接口，未完整实现执行
- 无云 KMS/HSM；仍用本地 master key
- time_window 目前按 UTC HH:MM 简化实现
- spending_limit 字段预留，未接支付
- Audit chain 完整性校验为应用层哈希，非 append-only 存储引擎
- Idempotency 无独立 TTL 清理 job
- Secret rotate/revoke HTTP API 仅 metadata GET；生命周期操作为内部 service

## 9. 下一阶段建议

1. BrowserWorker 实装（会话隔离 + CAPTCHA/MFA human path）
2. 接入 KMS / per-tenant DEK
3. 异步 Execution Queue（长任务 + webhook 回调）
4. WebAuthn step-up for require_reauth
5. SDK 默认 `apiVersion` 切到 `/api/v3`
6. Policy 可视化编辑器 + 模拟 dry_run 决策预览
7. Admin Secret Vault rotate/revoke HTTP 面
