//
//  cnothingApp.swift
//  cnothing
//
//  CNothing Authenticator — approve AI agent access requests on your phone.
//

import SwiftUI
import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        UNUserNotificationCenter.current().delegate = PushRegistrar.shared
        if APIClient.shared.isPaired {
            Task {
                await APIClient.shared.refreshAllAccountProfiles()
                await PushRegistrar.shared.requestAuthorizationAndRegister()
            }
        }
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        PushRegistrar.shared.handleDeviceToken(deviceToken)
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("APNs registration failed: \(error)")
    }
}

@main
struct cnothingApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    var body: some Scene {
        WindowGroup {
            ContentView()
                .onOpenURL { url in
                    if let target = Self.approvalTarget(from: url) {
                        ApprovalRouter.shared.openApproval(
                            requestId: target.requestId,
                            userId: target.userId
                        )
                    }
                }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    guard let url = activity.webpageURL,
                          let target = Self.approvalTarget(from: url)
                    else { return }
                    ApprovalRouter.shared.openApproval(
                        requestId: target.requestId,
                        userId: target.userId
                    )
                }
        }
    }

    /// Supports:
    /// - cnothing://approve/{id}?user=github:alice
    /// - https://cnothing.com/approve-proxy/{id}?user=github:alice
    static func approvalTarget(from url: URL) -> (requestId: String, userId: String?)? {
        let userId = URLComponents(url: url, resolvingAgainstBaseURL: false)?
            .queryItems?
            .first(where: { $0.name == "user" })?
            .value

        if url.scheme == "cnothing" {
            if url.host == "approve" {
                let id = url.pathComponents.count > 1 ? url.pathComponents[1] : nil
                guard let id, !id.isEmpty else { return nil }
                return (id, userId)
            }
            return nil
        }

        guard let host = url.host?.lowercased(),
              host == "cnothing.com" || host == "www.cnothing.com" || host.hasSuffix(".cnothing.com")
        else {
            return nil
        }

        let parts = url.path.split(separator: "/").map(String.init)
        if parts.count >= 2, parts[0] == "approve-proxy" {
            let id = parts[1]
            return id.isEmpty ? nil : (id, userId)
        }
        return nil
    }
}
