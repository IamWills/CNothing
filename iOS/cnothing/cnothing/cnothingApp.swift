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
                    // Deep link: cnothing://approve/{access_request_id}
                    guard url.scheme == "cnothing" else { return }
                    let id: String?
                    if url.host == "approve" {
                        id = url.pathComponents.count > 1 ? url.pathComponents[1] : nil
                    } else {
                        id = nil
                    }
                    if let id, !id.isEmpty {
                        ApprovalRouter.shared.openApproval(requestId: id)
                    }
                }
        }
    }
}
