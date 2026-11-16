import Foundation
import LocalAuthentication

/// A fresh context for each approval: never reuse a previous successful verification.
/// Existing device signing keys remain valid; this gates approval submission in the app.
enum ApprovalAuthentication {
    enum Failure: LocalizedError {
        case unavailable
        case cancelled
        case failed
        case accountChanged

        var errorDescription: String? {
            switch self {
            case .unavailable:
                return String(localized: "Set a device passcode in Settings to approve requests securely.")
            case .cancelled:
                return String(localized: "Verification cancelled. This request has not been approved.")
            case .failed:
                return String(localized: "Verification failed. This request has not been approved. Try again.")
            case .accountChanged:
                return String(localized: "The active account changed. Review the request again before approving.")
            }
        }
    }

    @MainActor
    static func verify(context: LAContext = LAContext()) async throws {
        context.touchIDAuthenticationAllowableReuseDuration = 0
        defer { context.invalidate() }
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &error) else {
            throw Failure.unavailable
        }
        do {
            let verified = try await context.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: String(localized: "Verify your identity to approve this agent request.")
            )
            guard verified else { throw Failure.failed }
        } catch let error as LAError {
            switch error.code {
            case .userCancel, .appCancel, .systemCancel:
                throw Failure.cancelled
            case .passcodeNotSet, .notInteractive:
                throw Failure.unavailable
            default:
                throw Failure.failed
            }
        }
    }
}
