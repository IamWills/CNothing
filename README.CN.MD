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

正式公开标准：

- 标准目录：[https://cnothing.com/standards](https://cnothing.com/standards)
- Authentication Standard 1.0：[https://cnothing.com/standards/authentication/1.0](https://cnothing.com/standards/authentication/1.0)
- Markdown 导出：[https://cnothing.com/standards/authentication/1.0/markdown](https://cnothing.com/standards/authentication/1.0/markdown)
- HTML 导出：[https://cnothing.com/standards/authentication/1.0/html](https://cnothing.com/standards/authentication/1.0/html)

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
7. 对于读取操作，结果默认会再次加密给客户端公钥；如果请求里提供 `recipient_public_key`，则改为加密给该第三方公钥。

这意味着：

- AI 不会拿到 secret 明文
- AI 不需要私钥
- challenge replay 的风险受到单次使用和短 TTL 的限制

更底层的协议细节见：

- [docs/protocol.md](./docs/protocol.md)
- [docs/mcp.md](./docs/mcp.md)

如果你需要一份可被第三方系统、审计或合规评审稳定引用的固定版本规范，请直接参考：

- [CNothing Authentication Standard 1.0](https://cnothing.com/standards/authentication/1.0)

## 主要接口

- `GET /v1/authai/public-key`
  - 返回 CNothing 的 AuthAI 公钥元数据
- `POST /v1/authai/register`
  - 注册或复用客户端公钥，并返回一次性 challenge
- `POST /v1/authai/refresh`
  - 使用合法的 auth envelope 续签下一次 challenge
- `POST /v1/authai/rotate-key`
  - 在保持同一个 `client_uuid` 的前提下轮换客户端公钥
- `POST /v1/kv/save`
  - 使用 `auth_envelope + data_envelope` 写入 KV
- `POST /v1/kv/read`
  - 使用 `auth_envelope + query_envelope` 读取 KV；可选传 `recipient_public_key`，将结果改为加密给第三方公钥（未传则默认加密给客户端公钥）

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

## 第三方服务端 SDK

仓库现在也包含了一套可复用的 Node.js / Bun SDK，方便第三方后端直接接入 `https://cnothing.com`，而不用自己手写整套协议实现。

第三方生产接入前，建议先阅读固定版本的公开标准：

- [CNothing Authentication Standard 1.0](https://cnothing.com/standards/authentication/1.0)
- [Markdown 导出](https://cnothing.com/standards/authentication/1.0/markdown)

现在已经可以直接从 npm 安装：

```bash
npm install cnothing
```

或者：

```bash
bun add cnothing
```

这套 SDK 是给服务端使用的。第三方系统可以：

- 生成或加载自己的客户端密钥对
- 把自己的公钥注册到 `CNothing`
- 始终把私钥保留在自己的后端本地
- 通过 `https://cnothing.com` 读写加密 KV
- 让 AI 使用 CNothing 协议参与流程，但仍然看不到明文 secrets

对于第三方以生产方式接入 `https://cnothing.com`，最推荐的是使用下面这组“结构保护”方法：

- `saveBlindJson()`
- `readBlindJson()`

这两个方法会在第三方后端本地同时保护 `namespace`、`key`、`metadata` 和 `value`，然后才发给 CNothing。

如果你只想隐藏 value 明文，而不介意暴露 namespace 和 key 名，那么也可以使用：

- `savePrivateJson()`
- `readPrivateJson()`

这两个方法只会给 value 增加第二层加密。

最小示例：

```ts
import { CNothingClient, generateClientKeyPair } from "cnothing";

const { privateKeyPem, publicKeyPem } = generateClientKeyPair();

const client = new CNothingClient({
  baseUrl: "https://cnothing.com",
  clientPrivateKeyPem: privateKeyPem,
  clientPublicKeyPem: publicKeyPem,
  clientLabel: "third-party-service",
  privacyKey: process.env.CNOTHING_PRIVACY_KEY!,
});

await client.register();

await client.saveBlindJson({
  namespace: "thirdparty.example.production",
  items: [
    {
      key: "provider/openai/api-key",
      value: { apiKey: "sk-..." },
      metadata: { provider: "openai" },
    },
  ],
});

const readResult = await client.readBlindJson({
  namespace: "thirdparty.example.production",
  keys: ["provider/openai/api-key"],
});

console.log(readResult.items["provider/openai/api-key"]);
```

SDK 当前主要导出：

- `CNothingClient`
  - 高层 register / refresh / save / read 工作流客户端
- `generateClientKeyPair()`
  - 生成本地 RSA 密钥对，适合开发或初始配置
- `rotateKey()`
  - 在保留同一个 CNothing 客户端身份的前提下轮换新 key pair
- 一组 envelope helpers
  - 给想要自己控制底层请求构造方式的团队使用

参考示例：

- [examples/node-server](./examples/node-server)
- [examples/bun-server](./examples/bun-server)

## 为什么第三方用户不用担心 AI 泄露敏感数据

只要第三方后端按照 `https://cnothing.com` 的协议正确接入，AI 仍然拿不到第三方的敏感明文。

原因是：

- 第三方后端会把客户端私钥保留在本地
- `CNothing` 返回的 challenge 永远加密给第三方的公钥
- 第三方后端在本地解密 challenge，并在本地生成加密给 CNothing 的 envelope
- 在推荐的 SDK 用法里，第三方后端还会先把 namespace 和 key 做稳定映射保护
- 第三方后端还会先把 metadata 和 value 本身加密，再交给 CNothing
- AI 只会转发密文 envelope 和非敏感元数据
- 读取结果会重新加密给第三方公钥，而其中的 value 仍然保持第三方自加密状态，因此只有第三方后端能解密

换句话说，AI 可以参与流程编排，但它并不会成为第三方明文 secrets 的持有者。在推荐的 blind 模式下，CNothing 服务运营方也拿不到第三方 value、metadata，以及原始 namespace / key 名的明文，因为 CNothing 实际看到的是第三方先做过保护后的结果。

当然，运营方仍然可以观察到请求时间、客户端身份以及“存在某些稳定受保护标识”这一事实。所以这是一种对 payload 和结构内容的 operator-blind 设计，不是对流量分析完全隐身的设计。

## Key Rotation

CNothing 现在支持在不改变 `client_uuid` 的前提下轮换客户端公钥。

完整流程是：

1. 客户端先用当前 key 通过合法的 `auth_envelope` 完成认证。
2. 客户端调用 `POST /v1/authai/rotate-key`，提交新的公钥。
3. CNothing 就地更新原有客户端记录。
4. 该客户端当前仍处于 active 的旧 challenge 会被作废。
5. CNothing 返回一个加密给新公钥的下一次 challenge。
6. 客户端继续沿用原来的 `client_uuid`、namespace 和存量数据。

在 SDK 中，高层调用方式是：

```ts
const nextKeys = generateClientKeyPair();

await client.rotateKey({
  newClientPrivateKeyPem: nextKeys.privateKeyPem,
  newClientPublicKeyPem: nextKeys.publicKeyPem,
  newClientKeyId: "rotation-2026-04",
});
```

这条流程对应的正式公开规范在：

- [https://cnothing.com/standards/authentication/1.0](https://cnothing.com/standards/authentication/1.0)

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

如果你不是部署 CNothing 本身，而是从第三方后端接入 `https://cnothing.com`，那就在第三方项目里安装 SDK 并这样配置：

```ts
import { CNothingClient } from "cnothing";

const client = new CNothingClient({
  baseUrl: "https://cnothing.com",
  clientPrivateKeyPem: process.env.CNOTHING_CLIENT_PRIVATE_KEY_PEM!,
  clientPublicKeyPem: process.env.CNOTHING_CLIENT_PUBLIC_KEY_PEM!,
  clientLabel: "my-service",
  privacyKey: process.env.CNOTHING_PRIVACY_KEY!,
});

await client.register();
await client.saveBlindJson({
  namespace: "my.service.production",
  items: [{ key: "secret/example", value: { token: "..." }, metadata: { kind: "token" } }],
});
```

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
