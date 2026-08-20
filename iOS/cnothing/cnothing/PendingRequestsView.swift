import SwiftUI

/// One pending request tagged with the paired account that owns it.
private struct PendingInboxItem: Identifiable, Hashable {
    let account: PairedAccount
    let request: AccessRequest

    var id: String { "\(account.deviceId).\(request.access_request_id)" }
}

/// Tab: inbox of authorization requests across all paired accounts.
struct PendingRequestsView: View {
    @ObservedObject private var api = APIClient.shared
    @ObservedObject private var router = ApprovalRouter.shared

    @State private var items: [PendingInboxItem] = []
    @State private var errorMessage = ""
    @State private var isLoading = false

    var body: some View {
        NavigationStack(path: $router.path) {
            List {
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

                Section {
                    if isLoading && items.isEmpty && errorMessage.isEmpty {
                        ProgressView("Loading…")
                    } else if items.isEmpty && !isLoading {
                        Text("No pending authorization requests. Ask an agent to request access, or open an approval link.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }

                    ForEach(items) { item in
                        Button {
                            api.switchAccount(deviceId: item.account.deviceId)
                            router.path.append(item.request.access_request_id)
                        } label: {
                            HStack {
                                VStack(alignment: .leading, spacing: 6) {
                                    HStack {
                                        Text(item.request.provider).fontWeight(.semibold)
                                        if item.request.isTransaction {
                                            Text(item.request.action ?? "action")
                                                .font(.caption2)
                                                .padding(.horizontal, 6)
                                                .padding(.vertical, 2)
                                                .background(.orange.opacity(0.15), in: Capsule())
                                        }
                                        Spacer()
                                        Text(item.request.status)
                                            .font(.caption)
                                            .foregroundStyle(.orange)
                                    }
                                    if let reason = item.request.reason, !reason.isEmpty {
                                        Text(reason)
                                            .font(.footnote)
                                            .foregroundStyle(.secondary)
                                    }
                                    Text(item.request.requested_hosts.joined(separator: ", "))
                                        .font(.system(.caption2, design: .monospaced))
                                        .foregroundStyle(.secondary)
                                    Text(item.account.userId)
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                }
                                Image(systemName: "chevron.right")
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.tertiary)
                            }
                        }
                        .foregroundStyle(.primary)
                    }
                } header: {
                    Text("Pending Requests")
                } footer: {
                    if api.accounts.count > 1 {
                        Text("Requests from every paired account are listed here.")
                    }
                }
            }
            .navigationTitle("Approvals")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        Task { await refresh(resetSession: true) }
                    } label: {
                        if isLoading {
                            ProgressView()
                                .controlSize(.small)
                        } else {
                            Image(systemName: "arrow.clockwise")
                        }
                    }
                    .accessibilityLabel(Text("Refresh"))
                    .disabled(isLoading)
                }
            }
            .navigationDestination(for: String.self) { requestId in
                ApprovalDetailView(requestId: requestId) {
                    Task { await refresh() }
                }
            }
            .refreshable { await refresh(resetSession: true) }
            .task {
                await refresh()
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(15))
                    await refresh(silent: true)
                }
            }
            .onChange(of: api.accounts.map(\.deviceId)) { _, _ in
                Task { await refresh() }
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

        let results = await api.pendingRequestsAllAccounts()
        var next: [PendingInboxItem] = []
        for (account, requests) in results {
            for request in requests {
                next.append(PendingInboxItem(account: account, request: request))
            }
        }
        next.sort { lhs, rhs in
            (lhs.request.created_at ?? lhs.request.expires_at)
                > (rhs.request.created_at ?? rhs.request.expires_at)
        }

        // If every account failed and we got nothing, surface a soft error when not silent.
        if next.isEmpty, !api.accounts.isEmpty, !silent {
            // Distinguish "empty inbox" vs "all fetches failed" by probing one account.
            do {
                _ = try await api.pendingRequests()
                errorMessage = ""
            } catch {
                errorMessage = error.localizedDescription
            }
        } else {
            errorMessage = ""
        }

        items = next
    }
}

#Preview {
    PendingRequestsView()
}
