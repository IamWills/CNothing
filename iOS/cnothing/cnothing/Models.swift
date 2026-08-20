import Foundation

struct PairDeviceResponse: Decodable {
    struct Device: Decodable {
        let id: String
        let user_id: String
        let platform: String
        let device_name: String
    }

    let ok: Bool
    let device: Device
    let session_token: String
}

struct PendingRequestsResponse: Decodable {
    let ok: Bool
    let items: [AccessRequest]
}

struct AccessRequest: Decodable, Identifiable, Hashable {
    let access_request_id: String
    let agent_id: String?
    let provider: String
    let requested_hosts: [String]
    let reason: String?
    let status: String
    let expires_at: String
    let created_at: String?
    let type: String?
    let action: String?

    var id: String { access_request_id }
    var isTransaction: Bool { type == "transaction" }
}

struct AccessRequestDetail: Decodable {
    struct Resource: Decodable {
        let method: String?
        let url: String?
        let path: String?
    }

    let ok: Bool
    let access_request_id: String
    let agent_id: String?
    let provider: String
    let requested_hosts: [String]
    let reason: String?
    let status: String
    let expires_at: String
    let type: String?
    let action: String?
    let resource: Resource?

    var isTransaction: Bool { type == "transaction" }
}

struct ConnectionsResponse: Decodable {
    let ok: Bool
    let items: [OAuthConnection]
}

struct OAuthConnection: Decodable, Identifiable, Hashable {
    let id: String
    let provider_slug: String
    let display_name: String?
    let status: String
}

struct ApproveResponse: Decodable {
    struct Grant: Decodable {
        let id: String
        let allowed_hosts: [String]
    }

    let ok: Bool
    let grant: Grant?
    let transaction_id: String?
    let status: String?
}

struct SimpleOkResponse: Decodable {
    let ok: Bool
}

struct ApprovalChallengeResponse: Decodable {
    let ok: Bool
    let challenge_id: String
    let nonce: String
    let expires_at: String
}

struct APIErrorEnvelope: Decodable {
    struct Inner: Decodable {
        let type: String?
        let message: String?
        let error_code: String?
    }

    let error: Inner
}
