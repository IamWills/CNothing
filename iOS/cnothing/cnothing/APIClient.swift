import Combine
import Foundation

enum APIError: LocalizedError {
    case http(status: Int, message: String)
    case notPaired
    case network(String)

    var errorDescription: String? {
        switch self {
        case let .http(status, message):
            return "HTTP \(status): \(message)"
        case .notPaired:
            return String(localized: "Device is not paired yet")
        case let .network(message):
            return message
        }
    }
}

/// Talks to the CNothing v4 API using the **active** paired account.
final class APIClient: ObservableObject {
    static let shared = APIClient()

    @Published private(set) var accounts: [PairedAccount] = []
    @Published private(set) var activeAccount: PairedAccount?

    var isPaired: Bool { activeAccount != nil }
    var deviceId: String? { activeAccount?.deviceId }
    var userId: String? { activeAccount?.userId }

    var baseURL: URL {
        get {
            if let raw = activeAccount?.baseURL, let url = URL(string: raw) {
                return url
            }
            if let raw = UserDefaults.standard.string(forKey: "cnothing.baseURL"),
               let url = URL(string: raw) {
                return url
            }
            return URL(string: "https://cnothing.com")!
        }
        set {
            UserDefaults.standard.set(newValue.absoluteString, forKey: "cnothing.baseURL")
        }
    }

    private var sessionToken: String? {
        guard let deviceId = activeAccount?.deviceId else { return nil }
        return AccountStore.shared.sessionToken(for: deviceId)
    }

    private var urlSession: URLSession = APIClient.makeSession()
    private let sessionLock = NSLock()
    private var storeCancellable: AnyCancellable?

    private init() {
        syncFromStore()
        storeCancellable = AccountStore.shared.objectWillChange.sink { [weak self] _ in
            DispatchQueue.main.async {
                self?.syncFromStore()
            }
        }
    }

    private func syncFromStore() {
        accounts = AccountStore.shared.accounts
        activeAccount = AccountStore.shared.activeAccount
        objectWillChange.send()
    }

    private static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 20
        config.timeoutIntervalForResource = 40
        config.waitsForConnectivity = true
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config)
    }

    func resetNetworkSession() {
        sessionLock.lock()
        defer { sessionLock.unlock() }
        urlSession.invalidateAndCancel()
        urlSession = APIClient.makeSession()
    }

    func switchAccount(deviceId: String) {
        guard !deviceId.isEmpty else { return }
        AccountStore.shared.switchTo(deviceId: deviceId)
        syncFromStore()
    }

    // MARK: - Pairing

    /// Pair an additional (or first) account. Activates the new account on success.
    func pair(code: String, deviceName: String, baseURLOverride: URL? = nil) async throws {
        let keyTag = UUID().uuidString
        var body: [String: Any] = [
            "pairing_code": code,
            "device_name": deviceName,
            "platform": "ios",
        ]
        if let jwk = DeviceKey.publicKeyJwk(keyTag: keyTag) {
            body["public_key_jwk"] = jwk
        }

        let pairBase = baseURLOverride ?? baseURL
        if let baseURLOverride {
            self.baseURL = baseURLOverride
        }

        let response: PairDeviceResponse = try await request(
            method: "POST",
            path: "/v4/devices/pair",
            body: body,
            authenticated: false,
            baseURLOverride: pairBase,
            sessionTokenOverride: nil
        )

        _ = AccountStore.shared.upsertAccount(
            deviceId: response.device.id,
            userId: response.device.user_id,
            keyTag: keyTag,
            deviceName: response.device.device_name.isEmpty ? deviceName : response.device.device_name,
            baseURL: pairBase.absoluteString,
            sessionToken: response.session_token,
            activate: true
        )
        await MainActor.run {
            self.syncFromStore()
        }
    }

    /// Remove the active account (or a specific device). If none remain, returns to pairing.
    func unpair(deviceId: String? = nil) {
        let target = deviceId ?? activeAccount?.deviceId
        guard let target else { return }
        AccountStore.shared.removeAccount(deviceId: target)
        syncFromStore()
    }

    // MARK: - Push token

    func registerPushToken(_ token: String) async {
        let snapshot = AccountStore.shared.accounts
        #if DEBUG
        let environment = "sandbox"
        #else
        let environment = "production"
        #endif
        for account in snapshot {
            guard let session = AccountStore.shared.sessionToken(for: account.deviceId),
                  let base = URL(string: account.baseURL)
            else { continue }
            do {
                let _: SimpleOkResponse = try await request(
                    method: "POST",
                    path: "/v4/devices/\(account.deviceId)/push-token",
                    body: ["push_token": token, "push_environment": environment],
                    baseURLOverride: base,
                    sessionTokenOverride: session
                )
            } catch {
                print("push token registration failed for \(account.userId): \(error)")
            }
        }
        UserDefaults.standard.set(token, forKey: "cnothing.lastPushToken")
    }

    // MARK: - Approvals

    func pendingRequests() async throws -> [AccessRequest] {
        let response: PendingRequestsResponse = try await request(
            method: "GET",
            path: "/v4/access-requests/pending"
        )
        return response.items
    }

    /// Fetch pending for every paired account (for inbox aggregation / routing).
    func pendingRequestsAllAccounts() async -> [(account: PairedAccount, items: [AccessRequest])] {
        var results: [(PairedAccount, [AccessRequest])] = []
        for account in AccountStore.shared.accounts {
            guard let token = AccountStore.shared.sessionToken(for: account.deviceId),
                  let base = URL(string: account.baseURL)
            else { continue }
            do {
                let response: PendingRequestsResponse = try await request(
                    method: "GET",
                    path: "/v4/access-requests/pending",
                    baseURLOverride: base,
                    sessionTokenOverride: token
                )
                results.append((account, response.items))
            } catch {
                continue
            }
        }
        return results
    }

    func accessRequest(id: String) async throws -> AccessRequestDetail {
        try await request(method: "GET", path: "/v4/access-requests/\(id)")
    }

    func connections() async throws -> [OAuthConnection] {
        let response: ConnectionsResponse = try await request(
            method: "GET",
            path: "/v4/connections"
        )
        return response.items
    }

    func approve(requestId: String, connectionId: String) async throws -> ApproveResponse {
        let proof = try await signedChallenge(requestId: requestId, verdict: "approved")
        return try await request(
            method: "POST",
            path: "/v4/access-requests/\(requestId)/approve",
            body: [
                "connection_id": connectionId,
                "challenge_id": proof.challengeId,
                "signature": proof.signature,
            ]
        )
    }

    func deny(requestId: String) async throws {
        let proof = try await signedChallenge(requestId: requestId, verdict: "denied")
        let _: SimpleOkResponse = try await request(
            method: "POST",
            path: "/v4/access-requests/\(requestId)/deny",
            body: [
                "challenge_id": proof.challengeId,
                "signature": proof.signature,
            ]
        )
    }

    /// Switch to the account that owns this access request (by user_id hint or by probing).
    @discardableResult
    func activateAccountForAccessRequest(
        requestId: String,
        preferredUserId: String? = nil
    ) async -> Bool {
        if let preferredUserId, AccountStore.shared.switchToUserId(preferredUserId) {
            await MainActor.run { syncFromStore() }
            return true
        }
        let all = await pendingRequestsAllAccounts()
        if let match = all.first(where: { pair in
            pair.items.contains(where: { $0.access_request_id == requestId })
        }) {
            AccountStore.shared.switchTo(deviceId: match.account.deviceId)
            await MainActor.run { syncFromStore() }
            return true
        }
        // Last resort: try loading the request with each account session.
        for account in AccountStore.shared.accounts {
            guard let token = AccountStore.shared.sessionToken(for: account.deviceId),
                  let base = URL(string: account.baseURL)
            else { continue }
            do {
                let _: AccessRequestDetail = try await request(
                    method: "GET",
                    path: "/v4/access-requests/\(requestId)",
                    baseURLOverride: base,
                    sessionTokenOverride: token
                )
                AccountStore.shared.switchTo(deviceId: account.deviceId)
                await MainActor.run { syncFromStore() }
                return true
            } catch {
                continue
            }
        }
        return false
    }

    private func signedChallenge(
        requestId: String,
        verdict: String
    ) async throws -> (challengeId: String, signature: String) {
        guard let account = activeAccount else { throw APIError.notPaired }
        let challenge: ApprovalChallengeResponse = try await request(
            method: "POST",
            path: "/v4/access-requests/\(requestId)/challenge",
            body: [:]
        )
        let payload =
            "cnothing-approval.v1.\(challenge.challenge_id).\(challenge.nonce).\(requestId).\(verdict)"
        guard let signature = DeviceKey.sign(payload, keyTag: account.keyTag) else {
            throw APIError.http(
                status: 0,
                message: String(localized: "Device signing failed. Re-pair this device to enroll its signing key.")
            )
        }
        return (challenge.challenge_id, signature)
    }

    // MARK: - Transport

    private func currentSession() -> URLSession {
        sessionLock.lock()
        defer { sessionLock.unlock() }
        return urlSession
    }

    private func request<T: Decodable>(
        method: String,
        path: String,
        body: [String: Any]? = nil,
        authenticated: Bool = true,
        baseURLOverride: URL? = nil,
        sessionTokenOverride: String? = nil
    ) async throws -> T {
        let normalizedPath = path.hasPrefix("/") ? String(path.dropFirst()) : path
        let root = baseURLOverride ?? baseURL
        guard let url = URL(string: normalizedPath, relativeTo: root)?.absoluteURL else {
            throw APIError.network(String(localized: "Invalid request URL."))
        }
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = method
        urlRequest.timeoutInterval = 20

        if authenticated {
            let token = sessionTokenOverride ?? sessionToken
            guard let token else { throw APIError.notPaired }
            urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
            urlRequest.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        do {
            let (data, response) = try await currentSession().data(for: urlRequest)
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard (200 ..< 300).contains(status) else {
                let message = (try? JSONDecoder().decode(APIErrorEnvelope.self, from: data))?
                    .error.message ?? String(data: data, encoding: .utf8) ?? "unknown error"
                throw APIError.http(status: status, message: message)
            }
            return try JSONDecoder().decode(T.self, from: data)
        } catch let error as APIError {
            throw error
        } catch {
            throw mapTransportError(error)
        }
    }

    private func mapTransportError(_ error: Error) -> APIError {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain {
            switch nsError.code {
            case NSURLErrorSecureConnectionFailed,
                 NSURLErrorServerCertificateUntrusted,
                 NSURLErrorServerCertificateHasBadDate,
                 NSURLErrorServerCertificateHasUnknownRoot,
                 NSURLErrorServerCertificateNotYetValid,
                 NSURLErrorClientCertificateRejected,
                 NSURLErrorClientCertificateRequired,
                 NSURLErrorCannotLoadFromNetwork:
                return .network(
                    String(localized: "Secure connection failed (TLS). Tap Refresh to retry.")
                )
            case NSURLErrorNotConnectedToInternet,
                 NSURLErrorNetworkConnectionLost,
                 NSURLErrorDataNotAllowed:
                return .network(
                    String(localized: "No network connection. Check Wi‑Fi or cellular, then tap Refresh.")
                )
            case NSURLErrorTimedOut:
                return .network(String(localized: "Request timed out. Tap Refresh to retry."))
            case NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost, NSURLErrorDNSLookupFailed:
                return .network(
                    String(localized: "Cannot reach the server. Tap Refresh to retry.")
                )
            default:
                break
            }
        }
        return .network(
            String(
                format: String(localized: "Network error: %@. Tap Refresh to retry."),
                error.localizedDescription
            )
        )
    }
}
