import Foundation
import Security

/// Device-bound signing key (Okta Verify-style proof of possession).
/// A P-256 keypair is generated at pairing; the private key lives in the
/// Secure Enclave (software keychain fallback on Simulator) and never leaves
/// the device. Every approve/deny signs a server-issued one-time challenge.
enum DeviceKey {
    private static let tag = "com.molobaya.app.cnothing.device-key".data(using: .utf8)!

    static func getOrCreate() -> SecKey? {
        if let existing = load() {
            return existing
        }
        return create()
    }

    private static func load() -> SecKey? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: tag,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecReturnRef as String: true,
        ]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess else {
            return nil
        }
        return (result as! SecKey)
    }

    private static func create() -> SecKey? {
        var attributes: [String: Any] = [
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
            kSecAttrKeySizeInBits as String: 256,
            kSecPrivateKeyAttrs as String: [
                kSecAttrIsPermanent as String: true,
                kSecAttrApplicationTag as String: tag,
            ],
        ]
        #if !targetEnvironment(simulator)
        attributes[kSecAttrTokenID as String] = kSecAttrTokenIDSecureEnclave
        #endif

        var error: Unmanaged<CFError>?
        if let key = SecKeyCreateRandomKey(attributes as CFDictionary, &error) {
            return key
        }
        // Secure Enclave unavailable (e.g. older hardware): software keychain key.
        attributes.removeValue(forKey: kSecAttrTokenID as String)
        return SecKeyCreateRandomKey(attributes as CFDictionary, nil)
    }

    /// Public key as an EC P-256 JWK dictionary for enrollment.
    static func publicKeyJwk() -> [String: String]? {
        guard let privateKey = getOrCreate(),
              let publicKey = SecKeyCopyPublicKey(privateKey),
              let data = SecKeyCopyExternalRepresentation(publicKey, nil) as Data?
        else {
            return nil
        }
        // X9.63 uncompressed point: 0x04 || X(32) || Y(32)
        guard data.count == 65, data.first == 0x04 else { return nil }
        let x = data.subdata(in: 1 ..< 33)
        let y = data.subdata(in: 33 ..< 65)
        return [
            "kty": "EC",
            "crv": "P-256",
            "x": base64url(x),
            "y": base64url(y),
        ]
    }

    /// ECDSA P-256 / SHA-256 signature over the UTF-8 message, DER, base64url.
    static func sign(_ message: String) -> String? {
        guard let privateKey = getOrCreate() else { return nil }
        let data = Data(message.utf8)
        var error: Unmanaged<CFError>?
        guard let signature = SecKeyCreateSignature(
            privateKey,
            .ecdsaSignatureMessageX962SHA256,
            data as CFData,
            &error
        ) as Data? else {
            return nil
        }
        return base64url(signature)
    }

    private static func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
