# OAuth 登录流程排查

本报告基于本地代码。未获得失败请求和目标网站 URL，无法将某次线上失败归因到具体 HTTP 返回。公开站点读取未成功，不据此判断线上服务状态。

## 流程与断点

| 步骤 | 实现 | 发现 |
| --- | --- | --- |
| 宿主身份配对 | agenttools/core/src/agent.ts | 宿主保管 token，首次须用户批准；与 Provider 授权是两个阶段 |
| 选择 Provider | src/v4/proxy.service.ts | 必须是已配置 API Provider；未知 issuer 仅进入运营审核，不会自动变为可用 |
| 识别审批用户 | src/v4/share-code.service.ts | OIDC 登录可生成邮箱形式用户 ID，但旧解析器拒绝邮箱；现接受数据库已存在的邮箱 ID，也支持按 Provider 登录身份解析 provider:account |
| 创建申请 | src/v4/proxy.service.ts | 旧文案诱导为了推送重新申请；现要求复用同一申请，不强求 user_id |
| 用户登录 CNothing | console/components/console/login-page.tsx | 通用登录页忽略 redirect_after；现保留同源返回地址 |
| 连接 Provider | console/components/console/connect-page.tsx | 原审批页传入返回地址，连接页却固定跳到 /connections；现保留返回地址，审批页也可直接发起对应 Provider 连接 |
| 审批与轮询 | src/v4/proxy.service.ts、src/mcp/mcp-handler.ts | REST 原先缺少 MCP 提供的 user_action / next_action / retry_after_seconds；现统一。过期但仍存为 pending 的记录现返回 expired |
| 调用 API | src/v4/proxy.service.ts | 审批后服务端注入 token，按 grant 调用 API |
| 登录第三方网站 | 无对应实现 | 没有目标网站浏览器上下文、登录回调接管、网站 session 建立及登录后验证机制 |

## 最短可用流程

1. 宿主自动处理首次配对，复用已存身份。
2. Agent 复用匹配 grant；没有时，从 list_providers 选真实 API Provider。
3. request_access 传 provider 和 reason；已知手机登录账号时，加上 user_id（例如 google:createn@gmail.com），服务端解析并推送。未知时省略 user_id。
4. 向用户展示 approval_url，持续查询同一 access_request_id。
5. approved 后调用 proxy_request；denied / expired 停止；provider_review_required 等待运营处理。

Google 邮箱不自动等于 CNothing 用户，也不代表目标网站认识这个账号。已有 OIDC 邮箱身份可以作为 CNothing user_id；无此身份则保留无目标用户的审批链接，由登录用户认领。现已支持 `google:邮箱` 等 `provider:account` 别名：按 Provider 的登录身份记录解析到内部用户 ID，再查找绑定设备。同一邮箱在不同 Provider 下分别查找；有多个不同所有者时不猜测，回退审批链接。API Provider 与审批用户的身份 Provider 可不同。

## 如果产品目标是通用网站登录

需要增加独立的浏览器登录流程。建议未来入口接收 target_url 和 purpose，明确区分 API 授权与网站会话，并由服务端返回 ready / user_action_required / unsupported 等状态；agent 无须猜账号或内部 Provider。该入口本次未实现。

网站登录分支必须从目标网站自身入口开始，保留其浏览器上下文和 OAuth state/回调关系，在同一上下文内由用户完成必要交互，然后验证目标站已登录。只有网站自身支持的集成才能建立其会话；CNothing 自己取得的 Google API token 不能被当作任意站点的登录凭据。OAuth 授权本身是对资源的有限访问授权，见 [RFC 6749](https://www.rfc-editor.org/rfc/rfc6749)。

## 验证

- 后端、agenttools 和回跳安全测试：隔离 PostgreSQL 数据库中 200 项通过，0 失败。
- 后端与 Console TypeScript 检查通过。
- provider:account 集成测试覆盖身份解析、绑定设备选择、模拟 APNs 调用、审批归属和批准后 grant 状态。
- 未验证真实 APNs 到手机的送达，未完成真实 Google/目标网站端到端登录；变更尚未部署。
