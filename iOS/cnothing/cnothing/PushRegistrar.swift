import Combine
import Foundation
import SwiftUI
import UIKit
import UserNotifications

/// Navigation hub: push taps and deep links land on an approval screen.
final class ApprovalRouter: ObservableObject {
    static let shared = ApprovalRouter()
    @Published var path = NavigationPath()

    func openApproval(requestId: String) {
        path = NavigationPath()
        path.append(requestId)
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
        Task { @MainActor in
            self.isRegistered = true
        }
        Task {
            await APIClient.shared.registerPushToken(token)
        }
    }

    // Foreground: still show the banner.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .sound, .badge]
    }

    // Tap on the notification → open the approval screen.
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let userInfo = response.notification.request.content.userInfo
        if let requestId = userInfo["access_request_id"] as? String {
            await MainActor.run {
                ApprovalRouter.shared.openApproval(requestId: requestId)
            }
        }
    }
}
