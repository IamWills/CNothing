import Combine
import Foundation
import UIKit

/// One paired CNothing user on this phone (each pair creates a server-side device).
struct PairedAccount: Codable, Identifiable, Hashable {
    /// Server device id — unique per pairing.
    var id: String { deviceId }

    let deviceId: String
    let userId: String
    /// Local Secure Enclave / Keychain key tag used for device-bound approvals.
    let keyTag: String
    var deviceName: String
    var baseURL: String
    let createdAt: Date
    /// Human email from the IdP identity, when CNothing has one.
    var email: String?
    /// Human display name from the IdP identity (e.g. Google profile name).
    var personName: String?

    /// Email if known; otherwise the login/sub parsed from `user_id`.
    var accountEmail: String? {
        if let email, !email.isEmpty { return email }
        return accountLogin.contains("@") ? accountLogin : nil
    }

    /// Primary row: name, else email, else the user_id login/sub.
    var titleText: String {
        if let personName, !personName.isEmpty { return personName }
        return accountEmail ?? accountLogin
    }

    /// Always includes the IdP (Google/GitHub). Adds email when it is not already the title.
    var subtitleText: String {
        if let email = accountEmail, titleText != email {
            return "\(platformDisplayName) · \(email)"
        }
        return platformDisplayName
    }

    var identityLine: String { subtitleText }

    var displayName: String { titleText }

    /// `github:alice` → `github`
    var platformSlug: String {
        let parts = userId.split(separator: ":", maxSplits: 1).map(String.init)
        return parts.count == 2 ? parts[0] : "cnothing"
    }

    /// `github:alice` → `alice`
    var accountLogin: String {
        let parts = userId.split(separator: ":", maxSplits: 1).map(String.init)
        return parts.count == 2 ? parts[1] : userId
    }

    var platformDisplayName: String {
        switch platformSlug.lowercased() {
        case "github": return "GitHub"
        case "google": return "Google"
        case "microsoft": return "Microsoft"
        case "apple": return "Apple"
        default: return platformSlug.capitalized
        }
    }
}

/// Persists multiple paired accounts and the currently active one.
final class AccountStore: ObservableObject {
    static let shared = AccountStore()

    private static let accountsKey = "cnothing.accounts.v1"
    private static let activeKey = "cnothing.activeAccountId.v1"
    private static let legacySessionKey = "device.sessionToken"
    private static let legacyDeviceIdKey = "cnothing.deviceId"
    private static let legacyUserIdKey = "cnothing.userId"
    private static let legacyBaseURLKey = "cnothing.baseURL"

    @Published private(set) var accounts: [PairedAccount] = []
    @Published private(set) var activeAccountId: String?

    var activeAccount: PairedAccount? {
        guard let activeAccountId else { return accounts.first }
        return accounts.first(where: { $0.deviceId == activeAccountId }) ?? accounts.first
    }

    var hasAccounts: Bool { !accounts.isEmpty }

    private init() {
        load()
        migrateLegacyIfNeeded()
    }

    func sessionToken(for deviceId: String) -> String? {
        KeychainStore.read(forKey: Self.tokenKey(deviceId))
    }

    func saveSessionToken(_ token: String, for deviceId: String) {
        KeychainStore.save(token, forKey: Self.tokenKey(deviceId))
    }

    func deleteSessionToken(for deviceId: String) {
        KeychainStore.delete(forKey: Self.tokenKey(deviceId))
    }

    private static func tokenKey(_ deviceId: String) -> String {
        "device.sessionToken.\(deviceId)"
    }

    @discardableResult
    func upsertAccount(
        deviceId: String,
        userId: String,
        keyTag: String,
        deviceName: String,
        baseURL: String,
        sessionToken: String,
        email: String? = nil,
        personName: String? = nil,
        activate: Bool = true
    ) -> PairedAccount {
        saveSessionToken(sessionToken, for: deviceId)

        if let index = accounts.firstIndex(where: { $0.userId == userId && $0.baseURL == baseURL }) {
            let old = accounts[index]
            if old.deviceId != deviceId {
                deleteSessionToken(for: old.deviceId)
                DeviceKey.delete(keyTag: old.keyTag)
            }
            accounts[index] = PairedAccount(
                deviceId: deviceId,
                userId: userId,
                keyTag: keyTag,
                deviceName: deviceName,
                baseURL: baseURL,
                createdAt: old.createdAt,
                email: email ?? old.email,
                personName: personName ?? old.personName
            )
        } else if let index = accounts.firstIndex(where: { $0.deviceId == deviceId }) {
            let old = accounts[index]
            accounts[index] = PairedAccount(
                deviceId: deviceId,
                userId: userId,
                keyTag: keyTag,
                deviceName: deviceName,
                baseURL: baseURL,
                createdAt: old.createdAt,
                email: email ?? old.email,
                personName: personName ?? old.personName
            )
        } else {
            accounts.append(
                PairedAccount(
                    deviceId: deviceId,
                    userId: userId,
                    keyTag: keyTag,
                    deviceName: deviceName,
                    baseURL: baseURL,
                    createdAt: Date(),
                    email: email,
                    personName: personName
                )
            )
        }

        if activate {
            activeAccountId = deviceId
        } else if activeAccountId == nil {
            activeAccountId = deviceId
        }
        persist()
        return accounts.first(where: { $0.deviceId == deviceId })!
    }

    func updateProfile(deviceId: String, email: String?, personName: String?) {
        guard let index = accounts.firstIndex(where: { $0.deviceId == deviceId }) else { return }
        var account = accounts[index]
        if let email, !email.isEmpty {
            account.email = email
        }
        if let personName, !personName.isEmpty {
            account.personName = personName
        }
        accounts[index] = account
        persist()
    }

    func switchTo(deviceId: String) {
        guard accounts.contains(where: { $0.deviceId == deviceId }) else { return }
        activeAccountId = deviceId
        persist()
        objectWillChange.send()
    }

    @discardableResult
    func switchToUserId(_ userId: String) -> Bool {
        guard let account = accounts.first(where: { $0.userId == userId }) else { return false }
        switchTo(deviceId: account.deviceId)
        return true
    }

    func removeAccount(deviceId: String) {
        if let account = accounts.first(where: { $0.deviceId == deviceId }) {
            deleteSessionToken(for: account.deviceId)
            DeviceKey.delete(keyTag: account.keyTag)
        }
        accounts.removeAll { $0.deviceId == deviceId }
        if activeAccountId == deviceId {
            activeAccountId = accounts.first?.deviceId
        }
        persist()
    }

    func removeAll() {
        for account in accounts {
            deleteSessionToken(for: account.deviceId)
            DeviceKey.delete(keyTag: account.keyTag)
        }
        accounts = []
        activeAccountId = nil
        persist()
        clearLegacyMetadata()
    }

    private func load() {
        guard let data = UserDefaults.standard.data(forKey: Self.accountsKey),
              let decoded = try? JSONDecoder().decode([PairedAccount].self, from: data)
        else {
            accounts = []
            activeAccountId = nil
            return
        }
        accounts = decoded
        activeAccountId = UserDefaults.standard.string(forKey: Self.activeKey)
        if activeAccountId == nil {
            activeAccountId = accounts.first?.deviceId
        }
    }

    private func persist() {
        if let data = try? JSONEncoder().encode(accounts) {
            UserDefaults.standard.set(data, forKey: Self.accountsKey)
        }
        if let activeAccountId {
            UserDefaults.standard.set(activeAccountId, forKey: Self.activeKey)
        } else {
            UserDefaults.standard.removeObject(forKey: Self.activeKey)
        }
    }

    private func migrateLegacyIfNeeded() {
        guard accounts.isEmpty,
              let token = KeychainStore.read(forKey: Self.legacySessionKey),
              let deviceId = UserDefaults.standard.string(forKey: Self.legacyDeviceIdKey),
              let userId = UserDefaults.standard.string(forKey: Self.legacyUserIdKey)
        else {
            return
        }
        let baseURL =
            UserDefaults.standard.string(forKey: Self.legacyBaseURLKey) ?? "https://cnothing.com"
        let keyTag = deviceId
        DeviceKey.migrateLegacyKeyIfNeeded(toKeyTag: keyTag)
        upsertAccount(
            deviceId: deviceId,
            userId: userId,
            keyTag: keyTag,
            deviceName: UIDevice.current.name,
            baseURL: baseURL,
            sessionToken: token,
            activate: true
        )
        KeychainStore.delete(forKey: Self.legacySessionKey)
        clearLegacyMetadata()
    }

    private func clearLegacyMetadata() {
        UserDefaults.standard.removeObject(forKey: Self.legacyDeviceIdKey)
        UserDefaults.standard.removeObject(forKey: Self.legacyUserIdKey)
    }
}
