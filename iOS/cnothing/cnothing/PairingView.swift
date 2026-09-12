import SwiftUI
import UIKit
import AuthenticationServices

struct PairingView: View {
    /// When true, shown as a sheet to add another account while already paired.
    var isAddingAccount: Bool = false
    var onFinished: (() -> Void)?

    @ObservedObject var api = APIClient.shared
    @Environment(\.dismiss) private var dismiss

    @StateObject private var providerLogin = ProviderLogin()
    @State private var providers: [LoginProvider] = []
    @State private var isLoadingProviders = false

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
                        Image(systemName: isAddingAccount ? "person.badge.plus" : "iphone.and.arrow.forward")
                            .font(.largeTitle)
                            .foregroundStyle(.tint)
                        Text(isAddingAccount ? "Add Another Account" : "Pair as Approval Device")
                            .font(.headline)
                        Text(
                            "Sign in with your provider on this phone to receive approval requests. You can also scan a pairing QR code."
                        )
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 4)
                }

                Section("Sign in to add an account") {
                    if isLoadingProviders { ProgressView().controlSize(.small) }
                    ForEach(providers) { provider in
                        Button {
                            Task { await signIn(provider) }
                        } label: {
                            Label("Sign in with \(provider.display_name)", systemImage: "person.crop.circle.badge.plus")
                                .padding(.vertical, 6)
                        }
                        .disabled(isWorking)
                    }
                    if providers.isEmpty && !isLoadingProviders {
                        Text("No login providers available. Check the server address or use a pairing code.")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                    Button("Refresh Providers") { Task { await loadProviders() } }
                        .disabled(isWorking || isLoadingProviders)
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
                            Task { await loadProviders() }
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
                            Text(isAddingAccount ? "Add Account" : "Pair")
                                .frame(maxWidth: .infinity)
                                .fontWeight(.semibold)
                        }
                    }
                    .disabled(pairingCode.trimmingCharacters(in: .whitespaces).isEmpty || isWorking)
                }
            }
            .task { await loadProviders() }
            .navigationTitle(isAddingAccount ? "Add Account" : "CNothing")
            .navigationBarTitleDisplayMode(isAddingAccount ? .inline : .large)
            .toolbar {
                if isAddingAccount {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Cancel") { dismiss() }
                    }
                }
            }
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

    private func loginBase() throws -> URL {
        guard let url = URL(string: serverURL.trimmingCharacters(in: .whitespacesAndNewlines)),
              url.scheme == "https", url.host != nil, url.user == nil, url.password == nil else {
            throw APIError.network(String(localized: "Enter a valid HTTPS server address."))
        }
        return url
    }

    private func loadProviders() async {
        isLoadingProviders = true
        errorMessage = ""
        defer { isLoadingProviders = false }
        do { providers = try await api.loginProviders(base: loginBase()) }
        catch { providers = []; errorMessage = error.localizedDescription }
    }

    private func signIn(_ provider: LoginProvider) async {
        isWorking = true
        errorMessage = ""
        defer { isWorking = false }
        do {
            try await providerLogin.signIn(provider: provider, base: loginBase())
            await finishPairing()
        } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
            // Closing the system login sheet leaves the existing accounts unchanged.
        } catch { errorMessage = error.localizedDescription }
    }

    private func finishPairing() async {
        await PushRegistrar.shared.requestAuthorizationAndRegister()
        if let token = UserDefaults.standard.string(forKey: "cnothing.lastPushToken") {
            await api.registerPushToken(token)
        }
        onFinished?()
        if isAddingAccount { dismiss() }
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
        let override =
            URL(string: serverURL.trimmingCharacters(in: .whitespaces)).flatMap { url in
                url.scheme != nil ? url : nil
            }
        do {
            try await api.pair(
                code: pairingCode.trimmingCharacters(in: .whitespaces),
                deviceName: UIDevice.current.name,
                baseURLOverride: override
            )
            await finishPairing()
        } catch {
            api.resetNetworkSession()
            errorMessage = error.localizedDescription
        }
    }
}

#Preview {
    PairingView()
}
