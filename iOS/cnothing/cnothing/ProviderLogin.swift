import AuthenticationServices
import Combine
import CryptoKit
import Foundation
import UIKit

/// Uses the system browser; only this session can redeem its verifier-bound return code.
@MainActor
final class ProviderLogin: NSObject, ObservableObject, ASWebAuthenticationPresentationContextProviding {
    private var anchor: ASPresentationAnchor?
    private var session: ASWebAuthenticationSession?

    func signIn(provider: LoginProvider, base: URL) async throws {
        guard base.scheme == "https", base.host != nil,
              let start = URL(string: provider.start_path, relativeTo: base)?.absoluteURL,
              start.scheme == base.scheme, start.host == base.host, start.port == base.port else {
            throw APIError.network(String(localized: "Invalid login server."))
        }
        guard let window = UIApplication.shared.connectedScenes
            .compactMap({ $0 as? UIWindowScene }).filter({ $0.activationState == .foregroundActive })
            .flatMap(\.windows).first(where: \.isKeyWindow) else {
            throw APIError.network(String(localized: "Unable to open login."))
        }
        anchor = window
        var bytes = [UInt8](repeating: 0, count: 32)
        guard SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) == errSecSuccess else {
            throw APIError.network(String(localized: "Unable to start secure login."))
        }
        let verifier = Self.base64url(Data(bytes))
        let challenge = Self.base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
        let state = UUID().uuidString
        var returnURL = URLComponents(url: base.appendingPathComponent("v4/devices/mobile-return"), resolvingAgainstBaseURL: false)!
        returnURL.queryItems = [URLQueryItem(name: "state", value: state), URLQueryItem(name: "code_challenge", value: challenge)]
        var startURL = URLComponents(url: start, resolvingAgainstBaseURL: false)!
        startURL.queryItems = (startURL.queryItems ?? []).filter { $0.name != "redirect_after" }
            + [URLQueryItem(name: "redirect_after", value: returnURL.url!.absoluteString)]
        defer { session = nil; anchor = nil }
        let callback: URL = try await withCheckedThrowingContinuation { continuation in
            let browser = ASWebAuthenticationSession(url: startURL.url!, callbackURLScheme: "cnothing") { url, error in
                if let error { continuation.resume(throwing: error) }
                else if let url { continuation.resume(returning: url) }
                else { continuation.resume(throwing: APIError.network(String(localized: "Login did not return an account."))) }
            }
            browser.presentationContextProvider = self
            // Adding a second account must not silently reuse the first browser account.
            browser.prefersEphemeralWebBrowserSession = true
            session = browser
            if !browser.start() {
                continuation.resume(throwing: APIError.network(String(localized: "Unable to open login.")))
            }
        }
        session = nil
        guard callback.scheme == "cnothing", callback.host == "login-callback",
              let parts = URLComponents(url: callback, resolvingAgainstBaseURL: false),
              parts.queryItems?.first(where: { $0.name == "state" })?.value == state,
              let code = parts.queryItems?.first(where: { $0.name == "code" })?.value, !code.isEmpty else {
            throw APIError.network(String(localized: "Invalid login callback. Please try again."))
        }
        try await APIClient.shared.pair(code: code, deviceName: UIDevice.current.name, baseURLOverride: base, codeVerifier: verifier)
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        // Set before the authentication session starts and retained until completion.
        anchor!
    }

    private static func base64url(_ data: Data) -> String {
        data.base64EncodedString().replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
    }
}
