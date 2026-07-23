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
                        Text("Pair as Approval Device")
                            .font(.headline)
                        Text("Sign in to the CNothing Console on the web, open the Devices page to generate a pairing QR code, then scan it here. You'll receive and approve agent authorization requests on this phone, just like Microsoft Authenticator.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }

                Section {
                    Button {
                        isShowingScanner = true
                    } label: {
                        Label("Scan QR Code to Pair", systemImage: "qrcode.viewfinder")
                            .frame(maxWidth: .infinity)
                            .fontWeight(.semibold)
                    }
                    .disabled(isWorking || !QRScannerView.isSupported)
                    if !QRScannerView.isSupported {
                        Text("This device cannot scan QR codes. Enter the pairing code manually.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("Or enter the pairing code manually") {
                    TextField("e.g. K7PQ2MXR", text: $pairingCode)
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
                        NetworkErrorBanner(
                            message: errorMessage,
                            isWorking: isWorking
                        ) {
                            Task { await pair(resetSession: true) }
                        }
                    }
                }

                Section {
                    Button {
                        Task { await pair() }
                    } label: {
                        if isWorking {
                            ProgressView()
                        } else {
                            Text("Pair")
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
                    .navigationTitle("Scan Pairing QR Code")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("Cancel") { isShowingScanner = false }
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
            errorMessage = String(
                localized: "Unrecognized QR code. Scan the pairing QR generated on the CNothing Console Devices page."
            )
        }
    }

    private func pair(resetSession: Bool = false) async {
        errorMessage = ""
        isWorking = true
        defer { isWorking = false }

        if resetSession {
            api.resetNetworkSession()
        }
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
            api.resetNetworkSession()
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    PairingView()
}
