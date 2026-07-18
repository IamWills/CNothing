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
                Section("授权请求") {
                    LabeledContent("Provider", value: detail.provider)
                    LabeledContent("状态", value: detail.status)
                    if let reason = detail.reason, !reason.isEmpty {
                        LabeledContent("理由", value: reason)
                    }
                    VStack(alignment: .leading, spacing: 4) {
                        Text("允许访问的主机").font(.subheadline)
                        ForEach(detail.requested_hosts, id: \.self) { host in
                            Text(host)
                                .font(.system(.footnote, design: .monospaced))
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                if detail.status == "pending" {
                    Section("使用的 OAuth 连接") {
                        if matchingConnections.isEmpty {
                            Text("没有可用的 \(detail.provider) 连接。请先在网页 Console 的 Connect 页完成一次 OAuth 连接。")
                                .font(.footnote)
                                .foregroundStyle(.secondary)
                        } else {
                            Picker("连接", selection: $selectedConnectionId) {
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
                            Label("批准", systemImage: "checkmark.circle.fill")
                                .frame(maxWidth: .infinity)
                                .fontWeight(.semibold)
                        }
                        .disabled(selectedConnectionId.isEmpty || isWorking)

                        Button(role: .destructive) {
                            Task { await decide(approve: false) }
                        } label: {
                            Label("拒绝", systemImage: "xmark.circle")
                                .frame(maxWidth: .infinity)
                        }
                        .disabled(isWorking)
                    }
                }
            } else if errorMessage.isEmpty {
                ProgressView("加载中…")
            }

            if !resultMessage.isEmpty {
                Section { Text(resultMessage).foregroundStyle(.green).font(.footnote) }
            }
            if !errorMessage.isEmpty {
                Section { Text(errorMessage).foregroundStyle(.red).font(.footnote) }
            }
        }
        .navigationTitle("审批")
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
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
                resultMessage = "已批准，grant \(result.grant.id.prefix(8))… 已生效。"
            } else {
                try await api.deny(requestId: requestId)
                resultMessage = "已拒绝。"
            }
            onDecided?()
            try? await Task.sleep(for: .seconds(1))
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}
