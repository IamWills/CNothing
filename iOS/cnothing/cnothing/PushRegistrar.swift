import Combine
import Foundation
import SwiftUI
import UIKit
import UserNotifications

/// Navigation hub: push taps and deep links land on an approval screen.
final class ApprovalRouter: ObservableObject {
    static let shared = ApprovalRouter()
    @Published var path = NavigationPath()
    /// When a push/deep link targets a specific CNothing user, switch before opening.
    @Published var pendingUserId: String?

    func openApproval(requestId: String, userId: String? = nil) {
        Task { @MainActor in
            if let userId, !userId.isEmpty {
                pendingUserId = userId
                _ = AccountStore.shared.switchToUserId(userId)
                APIClient.shared.switchAccount(
                    deviceId: AccountStore.shared.activeAccount?.deviceId ?? ""
                )
            } else {
                _ = await APIClient.shared.activateAccountForAccessRequest(requestId: requestId)
            }
            path = NavigationPath()
            path.append(requestId)
        }
    }
}

final class PushRegistrar: NSObject, ObservableObject, UNUserNotificationCenterDelegate {
    static let shared = PushRegistrar()

    @Published var isRegistered = UserDefaults.standard.bool(forKey: "cnothing.pushRegistered")

    func requestAuthorizationAndRegister() async {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        let granted = (try? await center.requestAuthorization(options: [.alert, .badge, .sound])) ?? false
        guard granted else { return }
        await MainActor.run {
            UIApplication.shared.registerForRemoteNotifications()
        }
    }

    func handleDeviceToken(_ deviceToken: Data) {
        let token = deviceToken.map { String(format: "%02x", $0) }.joined()
        UserDefaults.standard.set(true, forKey: "cnothing.pushRegistered")
        UserDefaults.standard.set(token, forKey: "cnothing.lastPushToken")
        Task { @MainActor in
            self.isRegistered = true
        }
        Task {
            // Register the same APNs token for every paired account/device.
            await APIClient.shared.registerPushToken(token)
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .badge]
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let userInfo = response.notification.request.content.userInfo
        let requestId = userInfo["access_request_id"] as? String
        let userId = userInfo["user_id"] as? String
        if let requestId {
            await MainActor.run {
                ApprovalRouter.shared.openApproval(requestId: requestId, userId: userId)
            }
        }
    }
}
