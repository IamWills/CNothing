import SwiftUI

struct ApprovalDetailView: View {
    let requestId: String
    var onDecided: (() -> Void)?

    @ObservedObject private var api = APIClient.shared
    @Environment(\.dismiss) private var dismiss

    @State private var detail: AccessRequestDetail?
    @State private var connections: [OAuthConnection] = []
    @State private var selectedConnectionId = ""
    @State private var isWorking = false
    @State private var isLoading = false
    @State private var errorMessage = ""
    @State private var resultIsApproval = true
    @State private var resultMessage = ""

    private var matchingConnections: [OAuthConnection] {
        guard let detail else { return connections }
        let matches = connections.filter { $0.provider_slug == detail.provider }
        return matches
    }

    var body: some View {
        Form {
            if let detail {
                Section("Authorization Request") {
                    if let account = api.activeAccount {
                        LabeledContent("Account", value: account.identityLine)
                    }
                    LabeledContent("Provider", value: detail.provider)
                    LabeledContent("Status", value: detail.status)
                    if detail.isTransaction {
                        LabeledContent("Action", value: detail.action ?? "transaction")
                        if let method = detail.resource?.method, let url = detail.resource?.url {
                            LabeledContent("Request", value: "\(method) \(url)")
                        }
                    }
                    if let reason = detail.reason, !reason.isEmpty {
                        LabeledContent("Reason", value: reason)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Allowed hosts").font(.subheadline)
                        ForEach(detail.requested_hosts, id: \.self) { host in
                            Text(host)
                                .font(.system(.footnote, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                if detail.status == "pending" {
                    if !detail.isTransaction {
                        Section("OAuth Connection") {
                            if matchingConnections.isEmpty {
                                Text("No available \(detail.provider) connection. Connect one first on the CNothing Console Connect page.")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            } else {
                                Picker("Connection", selection: $selectedConnectionId) {
                                    ForEach(matchingConnections) { connection in
                                        Text(connection.display_name ?? connection.provider_slug)
                                            .tag(connection.id)
                                    }
                                }
                            }
                        }
                    } else {
                        Section {
                            Text("This authorizes one action through an existing mandate. Tokens stay on CNothing.")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
            }

            if !resultMessage.isEmpty {
                Section { Text(resultMessage).foregroundStyle(resultIsApproval ? Color.green : Color.red).font(.footnote) }
            }
            if !errorMessage.isEmpty {
                Section {
                    NetworkErrorBanner(
                        message: errorMessage,
                        isWorking: isLoading || isWorking
                    ) {
                        Task { await load(resetSession: true) }
                    }
                }
            }
        }
        .overlay {
            if detail == nil && errorMessage.isEmpty {
                LoadingStateView()
            }
        }
        .safeAreaInset(edge: .bottom) {
            if let detail, detail.status == "pending", resultMessage.isEmpty {
                HStack(spacing: 24) {
                    Button(role: .destructive) {
                        Task { await decide(approve: false) }
                    } label: {
                        Label("Deny", systemImage: "xmark.circle.fill")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 54)
                    }
                    .tint(.red)
                    .disabled(isWorking || isLoading)
                    Button {
                        Task { await decide(approve: true) }
                    } label: {
                        Label("Approve", systemImage: "checkmark.circle.fill")
                            .font(.headline)
                            .frame(maxWidth: .infinity, minHeight: 54)
                    }
                    .tint(Color(red: 0.08, green: 0.48, blue: 0.23))
                    .disabled((!detail.isTransaction && selectedConnectionId.isEmpty) || isWorking || isLoading)
                }
                .buttonStyle(.borderedProminent)
                .padding(.horizontal, 20)
                .padding(.vertical, 12)
                .background(.bar)
            }
        }
        .navigationTitle("Approval")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    Task { await load(resetSession: true) }
                } label: {
                    if isLoading {
                        ProgressView()
                    } else {
                        Image(systemName: "arrow.clockwise")
                    }
                }
                .accessibilityLabel(Text("Refresh"))
                .disabled(isLoading || isWorking)
            }
        }
        .task { await load() }
    }

    private func load(resetSession: Bool = false) async {
        if resetSession {
            api.resetNetworkSession()
        }
        errorMessage = ""
        isLoading = true
        defer { isLoading = false }
        do {
            detail = try await api.accessRequest(id: requestId)
            if detail?.status == "pending" && detail?.isTransaction != true {
                connections = try await api.connections().filter { $0.status == "active" }
            }
            if !matchingConnections.contains(where: { $0.id == selectedConnectionId }) {
                selectedConnectionId = matchingConnections.first?.id ?? ""
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func decide(approve: Bool) async {
        errorMessage = ""
        isWorking = true
        defer { isWorking = false }
        do {
            if approve {
                let result = try await api.approve(
                    requestId: requestId,
                    connectionId: detail?.isTransaction == true ? nil : selectedConnectionId
                )
                if let grantId = result.grant?.id {
                    let grantPrefix = String(grantId.prefix(8))
                    resultMessage = String(localized: "Approved. Grant \(grantPrefix)… is now active.")
                } else if let transactionId = result.transaction_id {
                    let prefix = String(transactionId.prefix(8))
                    resultMessage = String(localized: "Action authorized (\(prefix)…). The agent can retry the same request.")
                } else {
                    resultMessage = String(localized: "Approved.")
                }
            } else {
                try await api.deny(requestId: requestId)
                resultMessage = String(localized: "Denied.")
            }
            resultIsApproval = approve
            onDecided?()
            try? await Task.sleep(for: .seconds(1))
            dismiss()
        } catch {
            // Approval may fail due to TLS; reset so the next tap gets a fresh session.
            api.resetNetworkSession()
            errorMessage = error.localizedDescription
        }
    }
}
