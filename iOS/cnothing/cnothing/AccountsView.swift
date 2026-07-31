import SwiftUI

/// Tab: list of paired CNothing accounts on this phone.
struct AccountsView: View {
    @ObservedObject private var api = APIClient.shared

    @State private var showAddAccount = false

    var body: some View {
        NavigationStack {
            List {
                if api.accounts.isEmpty {
                    ContentUnavailableView(
                        "No Accounts",
                        systemImage: "person.crop.circle.badge.plus",
                        description: Text("Tap + to pair a CNothing account from the Console Devices page.")
                    )
                } else {
                    Section {
                        ForEach(api.accounts) { account in
                            NavigationLink {
                                AccountDetailView(account: account)
                            } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: "person.crop.circle.fill")
                                        .font(.title2)
                                        .foregroundStyle(.tint)
                                    VStack(alignment: .leading, spacing: 4) {
                                        Text(account.accountLogin)
                                            .font(.body.weight(.semibold))
                                        Text(account.platformDisplayName)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                }
                                .padding(.vertical, 2)
                            }
                        }
                    } footer: {
                        Text("Tap an account to manage it. Approvals for every account appear in the Approvals tab.")
                    }
                }
            }
            .navigationTitle("Accounts")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showAddAccount = true
                    } label: {
                        Image(systemName: "plus")
                    }
                    .accessibilityLabel(Text("Add Account"))
                }
            }
            .sheet(isPresented: $showAddAccount) {
                PairingView(isAddingAccount: true) {
                    showAddAccount = false
                }
            }
        }
    }
}

#Preview {
    AccountsView()
}
