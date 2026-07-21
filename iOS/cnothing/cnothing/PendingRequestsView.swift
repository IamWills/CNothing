import SwiftUI

struct PendingRequestsView: View {
    @ObservedObject private var api = APIClient.shared
    @ObservedObject private var router = ApprovalRouter.shared

    @State private var requests: [AccessRequest] = []
    @State private var errorMessage = ""
    @State private var isLoading = false

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

                Section("Pending Requests") {
                    if requests.isEmpty && !isLoading {
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

                if !errorMessage.isEmpty {
                    Section { Text(errorMessage).foregroundStyle(.red).font(.footnote) }
                }

                Section {
                    Button("Unpair", role: .destructive) {
                        api.unpair()
                    }
                }
            }
            .navigationTitle("CNothing Approvals")
            .navigationDestination(for: String.self) { requestId in
                ApprovalDetailView(requestId: requestId) {
                    Task { await refresh() }
                }
            }
            .refreshable { await refresh() }
            .task {
                await refresh()
                // Poll as a fallback for missed / unconfigured push.
                while !Task.isCancelled {
                    try? await Task.sleep(for: .seconds(15))
                    await refresh()
                }
            }
        }
    }

    private func refresh() async {
        isLoading = true
        defer { isLoading = false }
        do {
            requests = try await api.pendingRequests()
            errorMessage = ""
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    PendingRequestsView()
}
