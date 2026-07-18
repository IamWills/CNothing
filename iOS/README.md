# CNothing iOS Authenticator

像 Microsoft Authenticator 一样，在手机上批准 AI agent 的授权请求。

## 流程

1. Agent 调用 `POST /v4/access-requests` 时携带 `user_id`（你的 CNothing 用户 ID）。
2. CNothing 立即通过 APNs 把审批请求推送到你已配对的 iPhone。
3. 手机顶部弹出通知，点击后直接进入审批页，选择 OAuth 连接后批准/拒绝。
4. 若 agent 还提供了 `callback_url`，审批结果会自动 POST 回 agent，无需轮询。
5. 未配置推送时 App 每 15 秒轮询 `GET /v4/access-requests/pending`，流程同样可用。

## 配对（首次使用）

1. 在网页 Console（cnothing.com）登录后打开 **Devices** 页，点 "Generate pairing code"。
2. 在 iPhone 上打开本 App，输入配对码（10 分钟内有效）。
3. 配对成功后 App 自动申请通知权限并上报 APNs push token。

配对会为设备发放一个 90 天的设备会话令牌（存于 Keychain）。在 Console 的
Devices 页可随时吊销设备。

## 服务端 APNs 配置

推送需要 Apple Developer 的 APNs Auth Key（.p8）。在 keyservice 的环境变量中配置：

```bash
KEYSERVICE_APNS_KEY_PATH=/path/to/AuthKey_XXXXXXXXXX.p8
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
- 深链 `cnothing://approve/{access_request_id}` 可直达审批页。如需启用，
  在 Target → Info → URL Types 中添加 URL Scheme `cnothing`。
- 推送通知的 payload 携带 `access_request_id`，点按通知即可导航，无需 URL Scheme。

## 文件结构

| 文件 | 作用 |
| --- | --- |
| `APIClient.swift` | v4 API 客户端（配对、push token、待审批、批准/拒绝） |
| `KeychainStore.swift` | 设备会话令牌的 Keychain 存取 |
| `PushRegistrar.swift` | APNs 注册、通知代理、审批导航路由 |
| `PairingView.swift` | 输入配对码绑定设备 |
| `PendingRequestsView.swift` | 待审批列表（推送 + 15s 轮询兜底） |
| `ApprovalDetailView.swift` | 审批详情页：选择连接、批准/拒绝 |
