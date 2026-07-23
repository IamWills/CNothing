import SwiftUI

/// Manage paired CNothing accounts on this phone.
struct AccountsView: View {
    @ObservedObject private var api = APIClient.shared
    @Environment(\.dismiss) private var dismiss

    @State private var showAddAccount = false
    @State private var pendingRemove: PairedAccount?
    @State private var showRemoveConfirmation = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("Each account is a CNothing user paired to this phone. Switch accounts to review and approve that user's agent requests.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Section("Accounts") {
                    ForEach(api.accounts) { account in
                        Button {
                            api.switchAccount(deviceId: account.deviceId)
                            dismiss()
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(account.userId)
                                        .font(.body.weight(.semibold))
                                        .foregroundStyle(.primary)
                                    Text(account.deviceName)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }
                                Spacer()
                                if api.activeAccount?.deviceId == account.deviceId {
                                    Image(systemName: "checkmark.circle.fill")
                                        .foregroundStyle(.tint)
                                }
                            }
                        }
                        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
                            Button(role: .destructive) {
                                pendingRemove = account
                                showRemoveConfirmation = true
                            } label: {
                                Text("Remove")
                            }
                        }
                    }
                }

                Section {
                    Button {
                        showAddAccount = true
                    } label: {
                        Label("Add Account", systemImage: "person.badge.plus")
                    }
                }
            }
            .navigationTitle("Accounts")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .sheet(isPresented: $showAddAccount) {
                PairingView(isAddingAccount: true) {
                    showAddAccount = false
                }
            }
            .confirmationDialog(
                "Remove this account?",
                isPresented: $showRemoveConfirmation,
                titleVisibility: .visible,
                presenting: pendingRemove
            ) { account in
                Button("Remove", role: .destructive) {
                    api.unpair(deviceId: account.deviceId)
                    if !api.isPaired {
                        dismiss()
                    }
                }
                Button("Cancel", role: .cancel) {}
            } message: { account in
                Text("Stop approving requests for \(account.userId) on this phone.")
            }
        }
    }
}
