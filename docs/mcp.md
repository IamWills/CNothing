# MCP Integration

`keyservice` 提供公开 MCP 入口：

- `GET /mcp`
- `POST /mcp`
- `GET /.well-known/mcp`
- `GET /mcp/sse`
- `POST /mcp/message`

## Exposed Tools

- `get_authai_public_key`
- `authai_register`
- `authai_refresh`
- `kv_save`
- `kv_read`

## MCP Usage Pattern

AI 通过 MCP 使用 `keyservice` 时，应遵守以下流程：

1. 调 `get_authai_public_key`，获取 keyservice 公钥信息
2. 调 `authai_register`，提交客户端公钥，拿到 `challenge_for_client`
3. 将 `challenge_for_client` 交给客户端后端解密
4. 由客户端后端构造：
   - `auth_envelope`
   - `data_envelope` 或 `query_envelope`
5. AI 再通过 `kv_save` 或 `kv_read` 转发这些 envelope
6. `kv_read` 的结果由客户端后端解密

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
