import Foundation
import Security

/// The ABRP token and API key, kept in this iPhone's Keychain instead of with the other settings. Readable
/// only after the first unlock since the iPhone started, never in backups or on another device, and in the
/// app's own Keychain group, so the widgets and the watch (which share the App Group) can't read them.
enum SecretStore {
    private static let service = "com.justice.OceanABRP.abrp"
    static let tokenAccount = "abrpToken"
    static let keyAccount = "abrpKey"

    /// The saved value, "" when there is none, or nil when the Keychain can't be read right now
    /// (for example before the first unlock).
    static func get(_ account: String) -> String? {
        var query = base(account)
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound { return "" }
        guard status == errSecSuccess, let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8) ?? ""
    }

    /// Saves the value, or removes it when empty. Returns whether that worked.
    @discardableResult
    static func set(_ value: String, for account: String) -> Bool {
        if value.isEmpty {
            let status = SecItemDelete(base(account) as CFDictionary)
            return status == errSecSuccess || status == errSecItemNotFound
        }
        let attributes: [String: Any] = [
            kSecValueData as String: Data(value.utf8),
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        var status = SecItemUpdate(base(account) as CFDictionary, attributes as CFDictionary)
        if status == errSecItemNotFound {
            var add = base(account)
            add.merge(attributes) { $1 }
            status = SecItemAdd(add as CFDictionary, nil)
        }
        return status == errSecSuccess
    }

    private static func base(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}
