// Standalone regression checks; not part of the app target.
// swiftc cnothing/cnothing/ApprovalAuthentication.swift tests/ApprovalAuthenticationChecks.swift -o /tmp/cnothing-auth-checks
import Foundation
import LocalAuthentication

final class AuthenticationStub: LAContext {
    var available = true
    var result = true
    var failure: LAError.Code?
    var evaluations = 0
    var invalidated = false

    override func canEvaluatePolicy(_ policy: LAPolicy, error: NSErrorPointer) -> Bool {
        precondition(policy == .deviceOwnerAuthentication, "Must allow system passcode fallback")
        return available
    }

    override func evaluatePolicy(_ policy: LAPolicy, localizedReason: String,
                                 reply: @escaping (Bool, Error?) -> Void) {
        precondition(policy == .deviceOwnerAuthentication)
        evaluations += 1
        reply(result && failure == nil, failure.map { LAError($0) })
    }

    override func invalidate() { invalidated = true }
}

@main
struct AuthenticationChecks {
    @MainActor
    static func main() async throws {
        let success = AuthenticationStub()
        try await ApprovalAuthentication.verify(context: success)
        precondition(success.evaluations == 1 && success.invalidated)
        precondition(success.touchIDAuthenticationAllowableReuseDuration == 0)

        let unavailable = AuthenticationStub()
        unavailable.available = false
        do {
            try await ApprovalAuthentication.verify(context: unavailable)
            preconditionFailure("An unprotected device must never approve")
        } catch ApprovalAuthentication.Failure.unavailable { }
        precondition(unavailable.evaluations == 0 && unavailable.invalidated)

        for cancellation in [LAError.Code.userCancel, .appCancel, .systemCancel] {
            let context = AuthenticationStub()
            context.failure = cancellation
            do {
                try await ApprovalAuthentication.verify(context: context)
                preconditionFailure("Cancellation must never authorize submission")
            } catch ApprovalAuthentication.Failure.cancelled { }
            precondition(context.invalidated)
        }

        let rejected = AuthenticationStub()
        rejected.result = false
        do {
            try await ApprovalAuthentication.verify(context: rejected)
            preconditionFailure("False verification must not authorize submission")
        } catch ApprovalAuthentication.Failure.failed { }
        precondition(rejected.invalidated)
        print("6 authentication checks passed")
    }
}
