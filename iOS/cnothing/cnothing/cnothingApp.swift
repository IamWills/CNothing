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
            Task { await PushRegistrar.shared.requestAuthorizationAndRegister() }
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
                    if let id = Self.accessRequestId(from: url) {
                        ApprovalRouter.shared.openApproval(requestId: id)
                    }
                }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    guard let url = activity.webpageURL,
                          let id = Self.accessRequestId(from: url)
                    else { return }
                    ApprovalRouter.shared.openApproval(requestId: id)
                }
        }
    }

    /// Supports:
    /// - cnothing://approve/{id}
    /// - cnothing://pair?... (handled elsewhere / ignored here)
    /// - https://cnothing.com/approve-proxy/{id} (Universal Link)
    static func accessRequestId(from url: URL) -> String? {
        if url.scheme == "cnothing" {
            if url.host == "approve" {
                return url.pathComponents.count > 1 ? url.pathComponents[1] : nil
            }
            return nil
        }

        guard let host = url.host?.lowercased(),
              host == "cnothing.com" || host == "www.cnothing.com" || host.hasSuffix(".cnothing.com")
        else {
            return nil
        }

        // /approve-proxy/{uuid}
        let parts = url.path.split(separator: "/").map(String.init)
        if parts.count >= 2, parts[0] == "approve-proxy" {
            let id = parts[1]
            return id.isEmpty ? nil : id
        }
        return nil
    }
}
