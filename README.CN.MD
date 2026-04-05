# CNothing

中文版说明在这里。英文版请见 [README.md](./README.md)。

`CNothing` 是一套面向 AI 自动化系统的生产级 `AuthAI + Encrypted KV` 服务，核心目标是在让 AI 参与流程编排的同时，不让模型接触敏感值明文。

它解决的是一个非常具体的问题：AI 代理需要参与工具选择、流程决策和请求转发，但实际使用到的 secrets 又必须留在可信后端边界内。CNothing 提供了一种协议化方式，让 AI 能参与工作流，而私钥和解密后的秘密值始终不进入模型上下文。

## 为什么是 CNothing

当你希望同时满足下面这些目标时，CNothing 才真正有价值：

- AI 可以参与依赖 secrets 的流程编排
- AI 永远不看到 secrets 的明文
- 持有私钥的客户端后端仍然是可信边界
- HTTP、MCP、Skill 三种入口共用一套 secret access 协议
- 落库数据继续按记录级别做 envelope encryption 静态加密

从系统角色上看，CNothing 位于 AI 编排层和可信后端之间。模型负责发现能力、选择工具、转发密文 envelope 和处理非敏感元数据；真正的解密与密钥操作仍然只发生在客户端后端。

GitHub 仓库：

- [https://github.com/IamWills/CNothing](https://github.com/IamWills/CNothing)

## 适合什么场景

CNothing 适合：

- 你在做 AI agent、copilot、自动化工作流，而且这些流程会触发需要认证的第三方集成
- 你希望 AI 负责流程控制，但不直接持有 API token、access token 或用户 secrets
- 你不想为每个上游系统都手写一套后端专用 secret adapter，而是希望复用统一协议
- 你希望人类运维界面和 AI 系统都能通过同一套浏览接口查看能力目录

CNothing 通常不适合：

- AI 根本不参与这个业务流程
- 你的后端完全可以直接调用上游系统，不需要 AI-facing 的一层
- 单纯的 secrets manager 已经足够解决问题，因为你并不需要 challenge-based client authentication 或密文 envelope 转发

## 核心角色模型

CNothing 的角色拆分非常简单：

- `CNothing`
  - 持有 AuthAI 私钥，校验 challenge 使用状态，存储加密的 KV 记录
- `客户端后端`
  - 持有客户端私钥，是唯一可信的密码学边界
- `AI`
  - 负责编排流程、调用 HTTP / MCP 接口、转发密文 envelope，但不负责解密

这个拆分本身就是 CNothing 最重要的价值：AI 在业务流程上有用，但在密码学上是“看不见”的。

## 端到端流程

理解 CNothing 最短的方式就是下面这 7 步：

1. 客户端先向 `CNothing` 注册公钥。
2. `CNothing` 返回一个加密给该客户端公钥的一次性 challenge。
3. 客户端后端在本地解密这个 challenge。
4. 客户端后端基于 challenge 生成 `auth_envelope`，再根据需要生成 `data_envelope` 或 `query_envelope`，并加密给 `CNothing`。
5. AI 通过 HTTP 或 MCP 将这些密文 envelope 转发给 CNothing。
6. CNothing 校验 challenge，执行读写，并返回下一次 challenge。
7. 对于读取操作，结果会再次加密给客户端公钥，因此只有客户端后端能解密。

这意味着：

- AI 不会拿到 secret 明文
- AI 不需要私钥
- challenge replay 的风险受到单次使用和短 TTL 的限制

更底层的协议细节见：

- [docs/protocol.md](./docs/protocol.md)
- [docs/mcp.md](./docs/mcp.md)

## 主要接口

- `GET /v1/authai/public-key`
  - 返回 CNothing 的 AuthAI 公钥元数据
- `POST /v1/authai/register`
  - 注册或复用客户端公钥，并返回一次性 challenge
- `POST /v1/authai/refresh`
  - 使用合法的 auth envelope 续签下一次 challenge
- `POST /v1/kv/save`
  - 使用 `auth_envelope + data_envelope` 写入 KV
- `POST /v1/kv/read`
  - 使用 `auth_envelope + query_envelope` 读取 KV，并将结果重新加密给客户端公钥

## Console 与浏览接口

仓库里还包含一个独立的 `CNothing Console`：

- `console/`
  - 一个 Next.js 控制台，用于浏览 MCP tools / resources、skills、客户端、namespace、键名，以及通过后端接口查看解密后的值

可浏览接口：

- `GET /v1/catalog/mcp`
  - 列出 MCP tools 与 resources
- `GET /v1/catalog/skills`
  - 列出仓库内置 skills

管理接口：

- `GET /v1/admin/clients`
  - 列出已注册客户端
- `POST /v1/admin/clients/register`
  - 通过粘贴公钥手工注册客户端
- `GET /v1/admin/clients/:client_uuid/namespaces`
  - 列出客户端下的 namespaces
- `GET /v1/admin/clients/:client_uuid/kv?namespace=...`
  - 列出指定 namespace 下的键名
- `GET /v1/admin/clients/:client_uuid/kv/value?namespace=...&key=...`
  - 查看某个键的解密值
- `POST /v1/admin/clients/:client_uuid/kv/save`
  - 通过管理 API 手工写入 JSON 值

说明：

- `catalog` 接口默认可公开访问，适合浏览与 AI discovery
- `admin` 接口复用 `KEYSERVICE_BEARER_TOKEN` 做 Bearer 鉴权
- 如果未配置 `KEYSERVICE_BEARER_TOKEN`，console 和 admin API 不会增加额外阻拦

## 安全属性

- 注册阶段客户端只提交公钥
- `challenge_for_client` 永远加密给客户端公钥
- `auth_envelope` 和 `data/query_envelope` 永远加密给 `CNothing`
- challenge 单次使用且短时有效
- 服务端记录使用按条目随机生成的 DEK，并由主密钥包裹

重要约束：

- AI 不应请求私钥
- AI 不应自行解密 envelope
- AI 只能转发密文 envelope 和非敏感元数据
- 如果键名本身敏感，调用方后端应自行增加映射或哈希层

## Quick Start

### 1. 准备基础设施

你需要：

- Bun
- PostgreSQL
- 一份包含必要配置的 `.env`

必需环境变量：

- `DATABASE_URL`
- `KEYSERVICE_MASTER_KEY`
- `KEYSERVICE_AUTHAI_PRIVATE_KEY_PATH`
- `KEYSERVICE_AUTHAI_PUBLIC_KEY_PATH`（如果希望显式提供公钥）

常用可选变量：

- `PORT`
- `KEYSERVICE_CHALLENGE_TTL_SECONDS`
- `KEYSERVICE_BEARER_TOKEN`
- `KEYSERVICE_CONSOLE_URL`

### 2. 为本地开发生成密钥

```bash
cd CNothing
bun install
bun run generate-secrets
```

它会生成：

- `.local-keys/authai-private-key.pem`
- `.local-keys/authai-public-key.pem`
- `.local-keys/generated.env`

这种显式初始化方式是刻意设计的：服务身份不会在重启后悄悄变化，密钥轮换也会保持可控且可审计。

### 3. 配置环境变量

创建 `.env`，至少填入：

```env
DATABASE_URL=postgresql://user:password@127.0.0.1:5432/cnothing
KEYSERVICE_MASTER_KEY=...
KEYSERVICE_AUTHAI_PRIVATE_KEY_PATH=./.local-keys/authai-private-key.pem
KEYSERVICE_AUTHAI_PUBLIC_KEY_PATH=./.local-keys/authai-public-key.pem
PORT=3021
```

### 4. 跑迁移并启动 API

```bash
cd CNothing
bun run migrate
bun run dev
```

### 5. 启动 Console

```bash
cd CNothing/console
bun install
bun run dev
```

或者在仓库根目录：

```bash
cd CNothing
bun run console:dev
```

### 6. 验证服务是否正常

启动后至少验证：

- `GET /health`
- `GET /v1/authai/public-key`
- `GET /mcp`
- `GET /skill.md`

本地默认情况下可以这样检查：

```bash
curl http://127.0.0.1:3021/health
curl http://127.0.0.1:3021/v1/authai/public-key
curl http://127.0.0.1:3021/mcp
```

## 部署说明

`CNothing` 很适合作为独立仓库单独发布和部署。对于公开仓库：

- 保留 `.env.example`
- 不提交 `.env`
- 不提交 `.local-keys/`
- 在部署环境中通过环境变量或单独的 secrets 目录提供生产密钥
- 生产私钥不要放在会被代码同步覆盖的位置里

仓库已经包含部署辅助脚本，见 [deploy/](./deploy)。

## 文件导览

- [src/core/key-service.ts](./src/core/key-service.ts)
  - 核心协议编排
- [src/core/key-service.repository.ts](./src/core/key-service.repository.ts)
  - PostgreSQL 仓储层
- [src/crypto/hybrid-envelope.ts](./src/crypto/hybrid-envelope.ts)
  - `RSA-OAEP-256 + AES-256-GCM` 混合加密
- [migrations/002_authai_kv.sql](./migrations/002_authai_kv.sql)
  - `clients/challenges/kv/audit` 表结构
- [skills/keyservice-authai/SKILL.md](./skills/keyservice-authai/SKILL.md)
  - AI 使用约定
