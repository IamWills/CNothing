import SwiftUI

/// Per-account management: identity, OAuth connections, unbind.
struct AccountDetailView: View {
    let account: PairedAccount

    @ObservedObject private var api = APIClient.shared
    @Environment(\.dismiss) private var dismiss

    @State private var connections: [OAuthConnection] = []
    @State private var isLoadingConnections = false
    @State private var connectionsError = ""
    @State private var showUnbindConfirmation = false

    /// Live copy in case the store mutates while this screen is open.
    private var currentAccount: PairedAccount {
        api.accounts.first(where: { $0.deviceId == account.deviceId }) ?? account
    }

    var body: some View {
        List {
            Section("Account") {
                LabeledContent("Platform", value: currentAccount.platformDisplayName)
                if let email = currentAccount.accountEmail {
                    LabeledContent("Email", value: email)
                }
                if let name = currentAccount.personName, !name.isEmpty {
                    LabeledContent("Name", value: name)
                }
                if currentAccount.accountEmail == nil {
                    LabeledContent("Account", value: currentAccount.accountLogin)
                }
                LabeledContent("CNothing ID", value: currentAccount.userId)
                LabeledContent("Device", value: currentAccount.deviceName)
            }

            Section("OAuth Connections") {
                if isLoadingConnections && connections.isEmpty {
                    ProgressView("Loading…")
                } else if !connectionsError.isEmpty && connections.isEmpty {
                    Text(connectionsError)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else if connections.isEmpty {
                    Text("No OAuth connections yet. Connect one on the CNothing Console.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                } else {
                    ForEach(connections) { connection in
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(connection.display_name ?? connection.provider_slug)
                                    .font(.body.weight(.semibold))
                                Text(connection.provider_slug)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(connection.status)
                                .font(.caption)
                                .foregroundStyle(connection.status == "active" ? .green : .secondary)
                        }
                    }
                }
            }

            Section {
                Button(role: .destructive) {
                    showUnbindConfirmation = true
                } label: {
                    Text("Unbind Account")
                        .frame(maxWidth: .infinity)
                }
            } footer: {
                Text("Unbinding stops this phone from approving requests for this account. Other paired accounts are unaffected.")
            }
        }
        .navigationTitle(currentAccount.titleText)
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog(
            "Unbind this account?",
            isPresented: $showUnbindConfirmation,
            titleVisibility: .visible
        ) {
            Button("Unbind Account", role: .destructive) {
                api.unpair(deviceId: currentAccount.deviceId)
                dismiss()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Stop approving requests for \(currentAccount.identityLine) on this phone.")
        }
        .task(id: currentAccount.deviceId) {
            await loadConnections()
        }
        .refreshable {
            await loadConnections()
        }
    }

    private func loadConnections() async {
        isLoadingConnections = true
        defer { isLoadingConnections = false }
        do {
            connections = try await api.connections(for: currentAccount)
            connectionsError = ""
        } catch {
            connectionsError = error.localizedDescription
        }
    }
}
