# KeyService

`keyservice` 现在实现的是一套面向 AI 自动化系统的生产级 `AuthAI + Encrypted KV` 协议。

目标：

- AI 模型不接触敏感值明文
- 客户端后端持有私钥，作为可信边界
- `keyservice` 用一次性 challenge 做身份认证
- KV 按 `client_uuid + namespace + key` 隔离
- 数据库存储继续使用 envelope encryption 做静态加密
- HTTP / MCP / Skill 三种入口遵循同一套协议

详细协议说明见：

- [docs/protocol.md](./docs/protocol.md)
- [docs/mcp.md](./docs/mcp.md)

## Main Endpoints

- `GET /v1/authai/public-key`
  - 获取 `keyservice` 的 authai 公钥
- `POST /v1/authai/register`
  - 注册或复用客户端公钥，并返回加密给客户端公钥的一次性 challenge
- `POST /v1/authai/refresh`
  - 使用有效 auth envelope 续签下一次 challenge
- `POST /v1/kv/save`
  - 使用 `auth_envelope + data_envelope` 保存 KV
- `POST /v1/kv/read`
  - 使用 `auth_envelope + query_envelope` 读取 KV，结果加密给客户端公钥

## Security Model

- 客户端注册时只提交公钥
- `challenge_for_client` 总是加密给客户端公钥
- `auth_envelope` 和 `data/query_envelope` 总是加密给 `keyservice`
- 每个 challenge 单次使用，默认 TTL 由环境变量控制，默认 300 秒
- 服务端数据按记录级别生成随机 DEK，并由主密钥包裹

注意：

- AI 不应请求私钥
- AI 不应解密任何 envelope
- AI 只能转发密文 envelope 和非敏感键名 / namespace
- 如果键名本身敏感，请由调用方后端再做映射或哈希

## Environment

- `PORT`
  - 默认 `3021`
- `DATABASE_URL`
  - PostgreSQL 连接串
- `KEYSERVICE_MASTER_KEY`
  - Base64 或 Base64URL 编码的 32 字节主密钥
- `KEYSERVICE_AUTHAI_PRIVATE_KEY_PATH`
  - `keyservice` 的 RSA 私钥文件路径，用于解密 auth/data/query envelope
- `KEYSERVICE_AUTHAI_PUBLIC_KEY_PATH`
  - 可选；authai 公钥文件路径。若未设置，服务会从私钥推导公钥
- `KEYSERVICE_CHALLENGE_TTL_SECONDS`
  - challenge 有效期，默认 `300`
- `KEYSERVICE_BEARER_TOKEN`
  - 当前新协议不依赖它；仅保留给未来管理接口或兼容场景

项目可以自己生成主密钥和 authai RSA 密钥对，但建议通过显式命令生成，而不是在服务启动时自动生成：

```bash
cd keyservice
bun run generate-secrets
```

该命令会在 `.local-keys/` 下生成：

- `authai-private-key.pem`
- `authai-public-key.pem`
- `generated.env`

这符合生产最佳实践里的“显式初始化”原则：服务身份不会在重启时悄悄变化，密钥轮换也能被运维明确控制。

## Run

```bash
cd keyservice
bun install
bun run generate-secrets
bun run migrate
bun run dev
```

## Publish As Standalone Repo

`keyservice` 适合以独立仓库发布和部署。公开仓库中建议：

- 保留 `.env.example`
- 不提交 `.env`
- 不提交 `.local-keys/`
- 在部署环境中通过环境变量或单独的 secrets 目录提供生产密钥

## Files

- [src/core/key-service.ts](./src/core/key-service.ts)
  - 核心协议编排
- [src/core/key-service.repository.ts](./src/core/key-service.repository.ts)
  - PostgreSQL 仓储
- [src/crypto/hybrid-envelope.ts](./src/crypto/hybrid-envelope.ts)
  - `RSA-OAEP-256 + AES-256-GCM` 混合加密
- [migrations/002_authai_kv.sql](./migrations/002_authai_kv.sql)
  - `clients/challenges/kv/audit` 表结构
- [skills/keyservice-authai/SKILL.md](./skills/keyservice-authai/SKILL.md)
  - AI 使用规范
