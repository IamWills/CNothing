import Combine
import Foundation

enum APIError: LocalizedError {
    case http(status: Int, message: String)
    case notPaired

    var errorDescription: String? {
        switch self {
        case let .http(status, message):
            return "HTTP \(status): \(message)"
        case .notPaired:
            return String(localized: "Device is not paired yet")
        }
    }
}

/// Talks to the CNothing v4 API with the device session token.
final class APIClient: ObservableObject {
    static let shared = APIClient()

    @Published var isPaired: Bool
    @Published var deviceId: String?
    @Published var userId: String?

    var baseURL: URL {
        get {
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
        KeychainStore.read(forKey: "device.sessionToken")
    }

    private init() {
        isPaired = KeychainStore.read(forKey: "device.sessionToken") != nil
        deviceId = UserDefaults.standard.string(forKey: "cnothing.deviceId")
        userId = UserDefaults.standard.string(forKey: "cnothing.userId")
    }

    // MARK: - Pairing

    func pair(code: String, deviceName: String) async throws {
        var body: [String: Any] = [
            "pairing_code": code,
            "device_name": deviceName,
            "platform": "ios",
        ]
        // Enroll the Secure Enclave public key (Okta Verify-style device binding).
        if let jwk = DeviceKey.publicKeyJwk() {
            body["public_key_jwk"] = jwk
        }
        let response: PairDeviceResponse = try await request(
            method: "POST",
            path: "/v4/devices/pair",
            body: body,
            authenticated: false
        )
        KeychainStore.save(response.session_token, forKey: "device.sessionToken")
        UserDefaults.standard.set(response.device.id, forKey: "cnothing.deviceId")
        UserDefaults.standard.set(response.device.user_id, forKey: "cnothing.userId")
        await MainActor.run {
            self.isPaired = true
            self.deviceId = response.device.id
            self.userId = response.device.user_id
        }
    }

    func unpair() {
        KeychainStore.delete(forKey: "device.sessionToken")
        UserDefaults.standard.removeObject(forKey: "cnothing.deviceId")
        UserDefaults.standard.removeObject(forKey: "cnothing.userId")
        isPaired = false
        deviceId = nil
        userId = nil
    }

    // MARK: - Push token

    func registerPushToken(_ token: String) async {
        guard let deviceId else { return }
        #if DEBUG
        let environment = "sandbox"
        #else
        let environment = "production"
        #endif
        do {
            let _: SimpleOkResponse = try await request(
                method: "POST",
                path: "/v4/devices/\(deviceId)/push-token",
                body: ["push_token": token, "push_environment": environment]
            )
        } catch {
            print("push token registration failed: \(error)")
        }
    }

    // MARK: - Approvals

    func pendingRequests() async throws -> [AccessRequest] {
        let response: PendingRequestsResponse = try await request(
            method: "GET",
            path: "/v4/access-requests/pending"
        )
        return response.items
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

    /// Okta Verify-style proof of possession: fetch a one-time challenge and
    /// sign it with the Secure Enclave key.
    private func signedChallenge(
        requestId: String,
        verdict: String
    ) async throws -> (challengeId: String, signature: String) {
        let challenge: ApprovalChallengeResponse = try await request(
            method: "POST",
            path: "/v4/access-requests/\(requestId)/challenge",
            body: [:]
        )
        let payload = "cnothing-approval.v1.\(challenge.challenge_id).\(challenge.nonce).\(requestId).\(verdict)"
        guard let signature = DeviceKey.sign(payload) else {
            throw APIError.http(
                status: 0,
                message: String(localized: "Device signing failed. Re-pair this device to enroll its signing key.")
            )
        }
        return (challenge.challenge_id, signature)
    }

    // MARK: - Transport

    private func request<T: Decodable>(
        method: String,
        path: String,
        body: [String: Any]? = nil,
        authenticated: Bool = true
    ) async throws -> T {
        var urlRequest = URLRequest(url: baseURL.appendingPathComponent(path))
        urlRequest.httpMethod = method
        urlRequest.timeoutInterval = 20

        if authenticated {
            guard let token = sessionToken else { throw APIError.notPaired }
            urlRequest.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }
        if let body {
            urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
            urlRequest.httpBody = try JSONSerialization.data(withJSONObject: body)
        }

        let (data, response) = try await URLSession.shared.data(for: urlRequest)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200 ..< 300).contains(status) else {
            let message = (try? JSONDecoder().decode(APIErrorEnvelope.self, from: data))?
                .error.message ?? String(data: data, encoding: .utf8) ?? "unknown error"
            throw APIError.http(status: status, message: message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
