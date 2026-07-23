import Foundation
import Security

/// Device-bound signing key (Okta Verify-style proof of possession).
/// Each paired account stores its own `keyTag`; the private key never leaves the device.
enum DeviceKey {
    private static let legacyTag = "com.molobaya.app.cnothing.device-key".data(using: .utf8)!

    private static func applicationTag(_ keyTag: String) -> Data {
        "com.molobaya.app.cnothing.device-key.\(keyTag)".data(using: .utf8)!
    }

    static func getOrCreate(keyTag: String) -> SecKey? {
        let tag = applicationTag(keyTag)
        if let existing = load(tag: tag) {
            return existing
        }
        return create(tag: tag)
    }

    /// Public key as an EC P-256 JWK dictionary for enrollment.
    static func publicKeyJwk(keyTag: String) -> [String: String]? {
        guard let privateKey = getOrCreate(keyTag: keyTag),
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
    static func sign(_ message: String, keyTag: String) -> String? {
        guard let privateKey = getOrCreate(keyTag: keyTag) else { return nil }
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

    static func delete(keyTag: String) {
        delete(tag: applicationTag(keyTag))
    }

    /// Migrate the pre-multi-account single key onto a per-account keyTag.
    static func migrateLegacyKeyIfNeeded(toKeyTag keyTag: String) {
        guard load(tag: legacyTag) != nil else { return }
        let destination = applicationTag(keyTag)
        if load(tag: destination) != nil {
            delete(tag: legacyTag)
            return
        }
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: legacyTag,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        ]
        let updates: [String: Any] = [
            kSecAttrApplicationTag as String: destination,
        ]
        if SecItemUpdate(query as CFDictionary, updates as CFDictionary) != errSecSuccess {
            _ = getOrCreate(keyTag: keyTag)
            delete(tag: legacyTag)
        }
    }

    // MARK: - Private

    private static func load(tag: Data) -> SecKey? {
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

    private static func create(tag: Data) -> SecKey? {
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
        attributes.removeValue(forKey: kSecAttrTokenID as String)
        return SecKeyCreateRandomKey(attributes as CFDictionary, nil)
    }

    private static func delete(tag: Data) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassKey,
            kSecAttrApplicationTag as String: tag,
            kSecAttrKeyType as String: kSecAttrKeyTypeECSECPrimeRandom,
        ]
        SecItemDelete(query as CFDictionary)
    }

    private static func base64url(_ data: Data) -> String {
        data.base64EncodedString()
            .replacingOccurrences(of: "+", with: "-")
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "=", with: "")
    }
}
