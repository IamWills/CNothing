import SwiftUI

struct PendingRequestsView: View {
    @ObservedObject private var api = APIClient.shared
    @ObservedObject private var router = ApprovalRouter.shared

    @State private var requests: [AccessRequest] = []
    @State private var errorMessage = ""
    @State private var isLoading = false
    @State private var showAccounts = false
    @State private var showAddAccount = false
    @State private var showRemoveConfirmation = false

    var body: some View {
        NavigationStack(path: $router.path) {
            List {
                Section {
                    Button {
                        showAccounts = true
                    } label: {
                        HStack {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Account")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                                Text(api.userId ?? "—")
                                    .font(.body.weight(.semibold))
                                    .foregroundStyle(.primary)
                            }
                            Spacer()
                            if api.accounts.count > 1 {
                                Text("\(api.accounts.count)")
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Image(systemName: "chevron.right")
                                .font(.caption.weight(.semibold))
                                .foregroundStyle(.tertiary)
                        }
                    }
                    LabeledContent(
                        "Push",
                        value: PushRegistrar.shared.isRegistered
                            ? String(localized: "Enabled")
                            : String(localized: "Polling")
                    )
                }

                if !errorMessage.isEmpty {
                    Section {
                        NetworkErrorBanner(
                            message: errorMessage,
                            isWorking: isLoading
                        ) {
                            Task { await refresh(resetSession: true) }
                        }
                    }
                }

                Section("Pending Requests") {
                    if isLoading && requests.isEmpty && errorMessage.isEmpty {
                        ProgressView("Loading…")
                    } else if requests.isEmpty && !isLoading {
                        Text("No pending authorization requests for this account. Switch accounts above, or ask the agent to pass your user_id / open approval_url.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    ForEach(requests) { request in
                        NavigationLink(value: request.access_request_id) {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(request.provider).fontWeight(.semibold)
                                    Spacer()
                                    Text(request.status)
                                        .font(.caption)
                                        .foregroundStyle(.orange)
                                }
                                if let reason = request.reason, !reason.isEmpty {
                                    Text(reason).font(.footnote).foregroundStyle(.secondary)
                                }
                                Text(request.requested_hosts.joined(separator: ", "))
                                    .font(.system(.caption2, design: .monospaced))
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
            .navigationTitle("CNothing Approvals")
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button {
                        Task { await refresh(resetSession: true) }
                    } label: {
                        if isLoading {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Image(systemName: "arrow.clockwise")
                                .font(.system(size: 14, weight: .semibold))
                        }
                    }
                    .accessibilityLabel(Text("Refresh"))
                    .disabled(isLoading)
                }
                ToolbarItemGroup(placement: .topBarTrailing) {
                    Button {
                        showAddAccount = true
                    } label: {
                        Image(systemName: "person.badge.plus")
                    }
                    .accessibilityLabel(Text("Add Account"))

                    Menu {
                        Button {
                            showAccounts = true
                        } label: {
                            Label("Manage Accounts", systemImage: "person.2")
                        }
                        Button("Remove Account", role: .destructive) {
                            showRemoveConfirmation = true
                        }
                    } label: {
                        Image(systemName: "ellipsis.circle")
                    }
                }
            }
            .confirmationDialog(
                "Remove this account?",
                isPresented: $showRemoveConfirmation,
                titleVisibility: .visible
            ) {
                Button("Remove", role: .destructive) {
                    api.unpair()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("You will stop receiving approval requests for \(api.userId ?? "this account") on this phone.")
            }
            .navigationDestination(for: String.self) { requestId in
                ApprovalDetailView(requestId: requestId) {
                    Task { await refresh() }
                }
            }
            .sheet(isPresented: $showAccounts) {
                AccountsView()
            }
            .sheet(isPresented: $showAddAccount) {
                PairingView(isAddingAccount: true) {
                    showAddAccount = false
                    Task { await refresh() }
                }
            }
            .refreshable { await refresh(resetSession: true) }
            .task(id: api.activeAccount?.deviceId) {
                await refresh()
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(15))
                    await refresh(silent: true)
                }
            }
        }
    }

    private func refresh(resetSession: Bool = false, silent: Bool = false) async {
        if resetSession {
            api.resetNetworkSession()
        }
        if !silent {
            isLoading = true
        }
        defer {
            if !silent {
                isLoading = false
            }
        }
        do {
            requests = try await api.pendingRequests()
            errorMessage = ""
        } catch {
            if !silent {
                errorMessage = error.localizedDescription
            }
        }
    }
}

#Preview {
    PendingRequestsView()
}
