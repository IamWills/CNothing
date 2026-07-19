import SwiftUI
import UIKit

struct PairingView: View {
    @ObservedObject var api = APIClient.shared
    @State private var pairingCode = ""
    @State private var serverURL = APIClient.shared.baseURL.absoluteString
    @State private var isWorking = false
    @State private var errorMessage = ""
    @State private var isShowingScanner = false

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
                        Text("在 CNothing Console（网页端登录后）打开 Devices 页生成二维码，扫码即可绑定，之后就能像 Microsoft Authenticator 一样在手机上接收并批准 agent 的授权请求。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }

                Section {
                    Button {
                        isShowingScanner = true
                    } label: {
                        Label("扫描二维码绑定", systemImage: "qrcode.viewfinder")
                            .frame(maxWidth: .infinity)
                            .fontWeight(.semibold)
                    }
                    .disabled(isWorking || !QRScannerView.isSupported)
                    if !QRScannerView.isSupported {
                        Text("此设备不支持相机扫码，请手动输入配对码。")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("或手动输入配对码") {
                    TextField("例如 K7PQ2MXR", text: $pairingCode)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .font(.system(.title3, design: .monospaced))
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
            .sheet(isPresented: $isShowingScanner) {
                NavigationStack {
                    QRScannerView { payload in
                        isShowingScanner = false
                        handleScannedPayload(payload)
                    }
                    .ignoresSafeArea()
                    .navigationTitle("扫描配对二维码")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("取消") { isShowingScanner = false }
                        }
                    }
                }
            }
        }
    }

    private func handleScannedPayload(_ payload: String) {
        switch PairingPayload.parse(payload) {
        case let .pairing(code, server):
            pairingCode = code
            if let server {
                serverURL = server.absoluteString
            }
            Task { await pair() }
        case .unrecognized:
            errorMessage = "无法识别的二维码，请扫描 CNothing Console Devices 页生成的配对二维码。"
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
