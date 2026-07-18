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
            return "设备尚未配对"
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
        let response: PairDeviceResponse = try await request(
            method: "POST",
            path: "/v4/devices/pair",
            body: [
                "pairing_code": code,
                "device_name": deviceName,
                "platform": "ios",
            ],
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
        try await request(
            method: "POST",
            path: "/v4/access-requests/\(requestId)/approve",
            body: ["connection_id": connectionId]
        )
    }

    func deny(requestId: String) async throws {
        let _: SimpleOkResponse = try await request(
            method: "POST",
            path: "/v4/access-requests/\(requestId)/deny",
            body: [:]
        )
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
