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
    @State private var resultMessage = ""

    private var matchingConnections: [OAuthConnection] {
        guard let detail else { return connections }
        let matches = connections.filter { $0.provider_slug == detail.provider }
        return matches.isEmpty ? connections : matches
    }

    var body: some View {
        Form {
            if let detail {
                Section("Authorization Request") {
                    if let userId = api.userId {
                        LabeledContent("Account", value: userId)
                    }
                    LabeledContent("Provider", value: detail.provider)
                    LabeledContent("Status", value: detail.status)
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

                    Section {
                        Button {
                            Task { await decide(approve: true) }
                        } label: {
                            Label("Approve", systemImage: "checkmark.circle.fill")
                                .frame(maxWidth: .infinity)
                                .fontWeight(.semibold)
                        }
                        .disabled(selectedConnectionId.isEmpty || isWorking)

                        Button(role: .destructive) {
                            Task { await decide(approve: false) }
                        } label: {
                            Label("Deny", systemImage: "xmark.circle")
                                .frame(maxWidth: .infinity)
                        }
                        .disabled(isWorking)
                    }
                }
            } else if errorMessage.isEmpty {
                ProgressView("Loading…")
            }

            if !resultMessage.isEmpty {
                Section { Text(resultMessage).foregroundStyle(.green).font(.footnote) }
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
            connections = try await api.connections().filter { $0.status == "active" }
            if selectedConnectionId.isEmpty, let first = matchingConnections.first {
                selectedConnectionId = first.id
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
                    connectionId: selectedConnectionId
                )
                let grantPrefix = String(result.grant.id.prefix(8))
                resultMessage = String(localized: "Approved. Grant \(grantPrefix)… is now active.")
            } else {
                try await api.deny(requestId: requestId)
                resultMessage = String(localized: "Denied.")
            }
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
