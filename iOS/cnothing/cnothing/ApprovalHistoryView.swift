import SwiftUI

struct ApprovalHistoryView: View {
    @ObservedObject private var api = APIClient.shared
    @State private var selectedDevice = ""
    @State private var items: [AccessRequest] = []
    @State private var hasMore = false
    @State private var isLoading = false
    @State private var loadID = UUID()
    @State private var errorMessage = ""

    private var account: PairedAccount? {
        api.accounts.first(where: { $0.deviceId == selectedDevice }) ?? api.accounts.first
    }

    var body: some View {
        NavigationStack {
            List {
                if api.accounts.count > 1 {
                    Picker("Account", selection: $selectedDevice) {
                        ForEach(api.accounts) { account in
                            Text(account.identityLine).tag(account.deviceId)
                        }
                    }
                }
                if !errorMessage.isEmpty {
                    NetworkErrorBanner(message: errorMessage, isWorking: isLoading) {
                        Task { await load(reset: true) }
                    }
                }
                if items.isEmpty && !isLoading && errorMessage.isEmpty {
                    Text("No authorization history yet.").font(.footnote).foregroundStyle(.secondary)
                }
                ForEach(items) { item in
                    NavigationLink {
                        Form {
                            Section("Authorization Request") {
                                LabeledContent("Account", value: account?.identityLine ?? "")
                                LabeledContent("Provider", value: item.provider)
                                LabeledContent("Status") { status(item.status) }
                                if let agent = item.agent_id { LabeledContent("Agent", value: agent) }
                                if let reason = item.reason { LabeledContent("Reason", value: reason) }
                                if let action = item.action { LabeledContent("Action", value: action) }
                                LabeledContent("Requested", value: date(item.created_at))
                                LabeledContent("Decided", value: date(item.decided_at))
                                LabeledContent("Request ID", value: item.id)
                                if let grant = item.grant_id { LabeledContent("Grant ID", value: grant) }
                            }
                            Section("Allowed hosts") {
                                ForEach(item.requested_hosts, id: \.self) { Text($0).font(.footnote.monospaced()) }
                            }
                        }
                        .textSelection(.enabled)
                        .navigationTitle("Authorization Record")
                        .navigationBarTitleDisplayMode(.inline)
                    } label: {
                        VStack(alignment: .leading, spacing: 6) {
                            HStack { Text(item.provider).font(.headline); Spacer(); status(item.status) }
                            if let reason = item.reason { Text(reason).font(.footnote).foregroundStyle(.secondary) }
                            Text(date(item.decided_at ?? item.created_at)).font(.caption).foregroundStyle(.secondary)
                        }
                        .padding(.vertical, 4)
                    }
                    .alignmentGuide(.listRowSeparatorLeading) { _ in 0 }
                }
                if hasMore {
                    Button("Load More") { Task { await load(reset: false) } }.disabled(isLoading)
                }
            }
            .overlay { if isLoading && items.isEmpty { LoadingStateView() } }
            .navigationTitle("History")
            .onAppear { if selectedDevice.isEmpty { selectedDevice = account?.deviceId ?? "" } }
            .refreshable { await load(reset: true) }
            .task(id: account?.deviceId) { await load(reset: true) }
        }
    }

    private func status(_ value: String) -> some View {
        Label {
            Text(LocalizedStringKey(value == "approved" ? "Approved" : value == "denied" ? "Denied" : "Expired"))
        } icon: {
            Image(systemName: value == "approved" ? "checkmark.circle.fill" : value == "denied" ? "xmark.circle.fill" : "clock")
        }
        .font(.caption.weight(.semibold))
        .foregroundStyle(value == "approved" ? Color.green : value == "denied" ? Color.red : Color.secondary)
    }

    private func date(_ raw: String?) -> String {
        guard let raw else { return "—" }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let parsed = formatter.date(from: raw) ?? ISO8601DateFormatter().date(from: raw)
        return parsed?.formatted(date: .abbreviated, time: .shortened) ?? raw
    }

    private func load(reset: Bool) async {
        guard let target = account, reset || !isLoading else { return }
        let currentLoad = UUID()
        loadID = currentLoad
        isLoading = true
        errorMessage = ""
        if reset { items = []; hasMore = false }
        defer { if loadID == currentLoad { isLoading = false } }
        do {
            let response = try await api.approvalHistory(for: target, offset: reset ? 0 : items.count)
            guard loadID == currentLoad, !Task.isCancelled, account?.deviceId == target.deviceId else { return }
            items = reset ? response.items : items + response.items
            hasMore = response.has_more
        } catch {
            guard loadID == currentLoad, !Task.isCancelled else { return }
            errorMessage = error.localizedDescription
        }
    }
}
