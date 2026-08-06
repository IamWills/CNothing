# CNothing iOS Authenticator

像 Microsoft Authenticator 一样，在手机上批准 AI agent 的授权请求。

## 流程（两条路）

**推送（推荐）**

1. Agent **只要知道你的 GitHub 用户名**（或 Devices 页的 agent ID / 短码），就应在
   `POST /v4/access-requests` 里传 `user_id`（如 `alice`、`github:alice`、`u_7K2M9P`）。
2. 你也可在 [Devices](https://cnothing.com/devices) 复制 **agent ID** 或生成 **短码** 发给 agent。
3. CNothing 通过 APNs 推送到已配对的 iPhone；点通知进入审批页。

**深链兜底（agent 完全不知道你的身份时）**

1. Agent 只发 `approval_url`（`https://cnothing.com/approve-proxy/{id}`）。
2. 你在**手机**上打开该链接：Universal Link 会打开本 App（已配对时直达审批）；未装 App 则走 Safari 网页审批。
3. 网页打开并登录后会自动认领请求，之后 App 轮询也能看到。

若 agent 还提供了 `callback_url`，审批结果会 POST 回 agent，无需轮询。

## 配对（首次使用）

1. 在网页 Console（cnothing.com）登录后打开 **Devices** 页。
2. 先复制你的 agent ID（可随时发给 agent）；再点 "Generate pairing code"。
3. 在 iPhone 上打开本 App，扫描二维码（或手动输入配对码，10 分钟内有效）。
4. 配对成功后 App 自动申请通知权限并上报 APNs push token。

## 多账号

同一台 iPhone 可配对多个 CNothing 账号并分别审批：

1. **账号** Tab：列出已绑定账号；右上角 **+** 扫描另一用户 Devices 页的配对码添加账号。
2. 点某个账号进入管理页，查看平台 / 账号与 OAuth 连接，底部可 **解绑账号**。
3. **授权** Tab：聚合所有已绑定账号的待审批请求，逐条批准或拒绝。
4. 推送若带 `user_id`，会切到 **授权** Tab 并打开对应审批。

旧版单账号安装会在首次启动时自动迁移到多账号存储。

配对会为设备发放一个 90 天的设备会话令牌（存于 Keychain）。在 Console 的
Devices 页可随时吊销设备。

## 设备绑定审批（Okta Verify 模型）

配对时 App 在 Secure Enclave 生成 P-256 密钥对并把公钥注册到服务端
（私钥永不离开手机）。之后每次批准/拒绝都要：

1. `POST /v4/access-requests/{id}/challenge` 获取一次性 challenge（5 分钟有效，单次使用）；
2. 对 `cnothing-approval.v1.{challenge_id}.{nonce}.{access_request_id}.{verdict}`
   做 ECDSA P-256 / SHA-256 签名（DER，base64url）；
3. 在 approve/deny 请求体中携带 `challenge_id` + `signature`，服务端用注册的公钥验签。

因此即使设备会话令牌泄露，没有手机上的私钥也无法完成任何审批。网页 Console
的审批（浏览器会话）不受影响，仍按原有方式进行。

## 服务端 APNs 配置

推送需要 Apple Developer 的 APNs Auth Key（.p8）。在 keyservice 的环境变量中配置：

```bash
KEYSERVICE_APNS_KEY_PATH=/apns/AuthKey_LLGD9J5428.p8
KEYSERVICE_APNS_KEY_ID=XXXXXXXXXX        # Key ID
KEYSERVICE_APNS_TEAM_ID=Q84M2C43RT      # Apple Team ID
KEYSERVICE_APNS_BUNDLE_ID=com.molobaya.app.cnothing
```

不配置这些变量时推送自动跳过（`pushed_to_devices: 0`），App 依靠轮询工作。

Debug 构建把 push token 注册为 `sandbox` 环境（走 api.sandbox.push.apple.com），
Release/TestFlight 构建注册为 `production`。

## Xcode 工程注意事项

- Push 需要在 Signing & Capabilities 中确认 **Push Notifications** 能力
  （工程已引用 `cnothing/cnothing.entitlements`，`aps-environment=development`；
  发布归档时 Xcode 会自动切换为 production）。
- **Associated Domains**：entitlements 已含 `applinks:cnothing.com`；服务端提供
  `/.well-known/apple-app-site-association`，使
  `https://cnothing.com/approve-proxy/{id}` 可 Universal Link 打开 App。
- 深链 `cnothing://approve/{access_request_id}` 可直达审批页。如需启用，
  在 Target → Info → URL Types 中添加 URL Scheme `cnothing`。
- 推送通知的 payload 携带 `access_request_id`，点按通知即可导航，无需 URL Scheme。

## 国际化

App 支持英文（默认）与简体中文，采用 Xcode String Catalog：

- `Localizable.xcstrings` — 全部界面文案（代码中以英文为键，目录内提供 zh-Hans 翻译）；
- `InfoPlist.xcstrings` — 相机权限描述等系统权限文案；
- 推送通知使用 APNs `loc-key`/`loc-args`（`PUSH_APPROVAL_TITLE` / `PUSH_APPROVAL_BODY` /
  `PUSH_APPROVAL_BODY_REASON`），由收到通知的设备按自身语言渲染，服务端不需要关心用户语言。

新增语言时只需在 Xcode 的 String Catalog 中添加语言列并翻译即可。

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `AccountStore.swift` | 多账号仓库（Keychain token + 活跃账号） |
| `APIClient.swift` | v4 API 客户端（按活跃账号鉴权、配对、审批） |
| `KeychainStore.swift` | 设备会话令牌的 Keychain 存取 |
| `DeviceKey.swift` | 每账号独立的 Secure Enclave 签名密钥 |
| `PushRegistrar.swift` | APNs 注册、通知代理、审批导航路由 |
| `PairingView.swift` | 首次配对 / 添加账号 |
| `AccountsView.swift` | 账号 Tab：列表与添加 |
| `AccountDetailView.swift` | 单账号管理与解绑 |
| `PendingRequestsView.swift` | 授权 Tab：全账号待审批列表 |
| `ApprovalDetailView.swift` | 审批详情页 |
