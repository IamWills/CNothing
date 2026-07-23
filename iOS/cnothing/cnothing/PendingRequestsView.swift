import SwiftUI

struct PendingRequestsView: View {
    @ObservedObject private var api = APIClient.shared
    @ObservedObject private var router = ApprovalRouter.shared

    @State private var requests: [AccessRequest] = []
    @State private var errorMessage = ""
    @State private var isLoading = false
    @State private var showUnpairConfirmation = false

    var body: some View {
        NavigationStack(path: $router.path) {
            List {
                if let userId = api.userId {
                    Section {
                        LabeledContent("Account", value: userId)
                        LabeledContent(
                            "Push",
                            value: PushRegistrar.shared.isRegistered
                                ? String(localized: "Enabled")
                                : String(localized: "Polling")
                        )
                    }
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
                        Text("No pending authorization requests. When an agent calls request_access with your user_id, requests appear here and are pushed to this phone.")
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
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Unpair", role: .destructive) {
                        showUnpairConfirmation = true
                    }
                    .font(.system(size: 15, weight: .medium))
                }
            }
            .confirmationDialog(
                "Unpair this device?",
                isPresented: $showUnpairConfirmation,
                titleVisibility: .visible
            ) {
                Button("Unpair", role: .destructive) {
                    api.unpair()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("You will stop receiving approval requests on this phone until you pair again.")
            }
            .navigationDestination(for: String.self) { requestId in
                ApprovalDetailView(requestId: requestId) {
                    Task { await refresh() }
                }
            }
            .refreshable { await refresh(resetSession: true) }
            .task {
                await refresh()
                // Poll as a fallback for missed / unconfigured push.
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(15))
                    // Silent poll: don't reset the session every 15s, and don't
                    // clear a visible error until a manual refresh succeeds.
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
