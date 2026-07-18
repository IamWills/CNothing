import SwiftUI
import UIKit

struct PairingView: View {
    @ObservedObject var api = APIClient.shared
    @State private var pairingCode = ""
    @State private var serverURL = APIClient.shared.baseURL.absoluteString
    @State private var isWorking = false
    @State private var errorMessage = ""

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 8) {
                        Image(systemName: "iphone.and.arrow.forward")
                            .font(.largeTitle)
                            .foregroundStyle(.tint)
                        Text("绑定为审批设备")
                            .font(.headline)
                        Text("在 CNothing Console 的 Devices 页生成配对码，10 分钟内在此输入，即可像 Microsoft Authenticator 一样在手机上接收并批准 agent 的授权请求。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }

                Section("配对码") {
                    TextField("例如 K7PQ2MXR", text: $pairingCode)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .font(.system(.title3, design: .monospaced))
                }

                Section("服务器") {
                    TextField("https://cnothing.com", text: $serverURL)
                        .keyboardType(.URL)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                }

                if !errorMessage.isEmpty {
                    Section {
                        Text(errorMessage).foregroundStyle(.red).font(.footnote)
                    }
                }

                Section {
                    Button {
                        Task { await pair() }
                    } label: {
                        if isWorking {
                            ProgressView()
                        } else {
                            Text("配对")
                                .frame(maxWidth: .infinity)
                                .fontWeight(.semibold)
                        }
                    }
                    .disabled(pairingCode.trimmingCharacters(in: .whitespaces).isEmpty || isWorking)
                }
            }
            .navigationTitle("CNothing")
        }
    }

    private func pair() async {
        errorMessage = ""
        isWorking = true
        defer { isWorking = false }

        if let url = URL(string: serverURL.trimmingCharacters(in: .whitespaces)), url.scheme != nil {
            api.baseURL = url
        }
        do {
            try await api.pair(
                code: pairingCode.trimmingCharacters(in: .whitespaces),
                deviceName: UIDevice.current.name
            )
            await PushRegistrar.shared.requestAuthorizationAndRegister()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    PairingView()
}
