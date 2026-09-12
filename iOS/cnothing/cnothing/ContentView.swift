//
//  ContentView.swift
//  cnothing
//

import SwiftUI

enum MainTab: Hashable {
    case accounts
    case approvals
    case history
}

struct ContentView: View {
    @ObservedObject private var api = APIClient.shared
    @ObservedObject private var router = ApprovalRouter.shared

    var body: some View {
        if api.isPaired {
            TabView(selection: $router.selectedTab) {
                AccountsView()
                    .tabItem {
                        Label("Accounts", systemImage: "person.2.fill")
                    }
                    .tag(MainTab.accounts)

                PendingRequestsView()
                    .tabItem {
                        Label("Approvals", systemImage: "checkmark.shield.fill")
                    }
                    .tag(MainTab.approvals)

                ApprovalHistoryView()
                    .tabItem { Label("History", systemImage: "clock.arrow.circlepath") }
                    .tag(MainTab.history)
            }
        } else {
            PairingView()
        }
    }
}

#Preview {
    ContentView()
}
