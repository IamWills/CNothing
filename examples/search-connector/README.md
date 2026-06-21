# Search v2 Connector (built-in)

CNothing 内置 **Searchengine Connector**（`provider=search`），Agent 通过 v2 `invoke` 调用检索能力，**无需 KV**。

## 能力

| Capability | 说明 |
|------------|------|
| `search.query` | 关键词检索 |
| `search.fetch_document` | 按 URL 获取已索引 Markdown |
| `search.get_index_stats` | 索引规模与新鲜度 |

## 鉴权模型（无 KV）

1. 用户在 Console 登录（GitHub/OIDC）→ `user_id` 如 `github:login`
2. **Link Search**：`POST /v2/auth/search/link`（需 `cnothing_user_session` cookie）
   - 平台生成 CNothing AuthAI 客户端密钥
   - 向 `search.morethinkings.com` 完成 enroll
   - 加密存入 `cap_credentials`（Agent 不接触私钥）
3. Agent `invoke` 时传 `user_id`；Connector 刷新 `auth_envelope` 并调用 Search REST API

## 服务端配置

```env
KEYSERVICE_SEARCH_API_URL=https://search.morethinkings.com
KEYSERVICE_SEARCH_AUTO_BOOTSTRAP=1   # 默认启用（当 URL 已配置）
```

启动后自动注册 connector 与 capabilities；也可手动：

```bash
bun run search:bootstrap
# 或 POST /v2/admin/search/bootstrap
```

## 用户 Link

登录后：

```bash
curl -sS -X POST https://cnothing.com/v2/auth/search/link \
  -H "Cookie: cnothing_user_session=..." \
  -H "Content-Type: application/json" \
  -d '{}'
```

Admin 代链：

```bash
USER_ID=github:login bun run examples/search-connector/link.ts
```

## Agent 调用示例

```bash
curl -sS -X POST https://cnothing.com/v2/capabilities/invoke \
  -H "Authorization: Bearer <agent_access_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "capability": "search.query",
    "input": { "query": "CNothing capability", "limit": 5 },
    "user_id": "github:login"
  }'
```

## 与 v1 KV 路径对比

| v1 | v2 |
|----|-----|
| Agent 经 MCP `authai_register` + 可选 `kv_save` | 用户 `/v2/auth/search/link` 一次 |
| Agent 持有/转发 envelope | Connector 代管 AuthAI 客户端 + refresh |
| MCP `search` 工具 | `search.query` capability |
