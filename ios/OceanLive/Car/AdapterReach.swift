import Foundation

/// What to tell the owner when the first connection of a session fails. The Ocean powers the OBD port all the
/// time, so the adapter is never power-cycled: an asleep adapter, or one held by another app, is the usual cause.
/// Pure, so it can be unit tested.
enum FirstConnect {
    static let unreachableMessage = String(localized: "Can't reach the adapter. It may be asleep or connected to another app. Close other OBD apps, press the adapter's button or replug it, then tap Connect.")
    static let noAnswerMessage = String(localized: "The adapter connected but didn't answer. Unplug it for a few seconds, plug it back in, then tap Connect.")
    static let vLinkerNote = String(localized: "vLinker adapters need firmware 2.2.82 or newer to wake up on their own in an electric car.")

    enum Failure: Equatable {
        /// The Bluetooth link never came up.
        case unreachable
        /// The link came up, but the adapter didn't answer its setup commands.
        case noAnswer
        /// Bluetooth off, or not an OBD adapter: their own messages say it best.
        case other
    }

    /// `linkUp`: the Bluetooth link was open and the adapter was being set up when the error came.
    static func failure(_ error: Error, linkUp: Bool) -> Failure {
        if let e = error as? ElmError, e == .bluetoothOff || e == .notAdapter { return .other }
        return linkUp ? .noAnswer : .unreachable
    }

    /// The message for the start card. vLinkers only wake up by themselves in an electric car with newer firmware.
    static func message(_ failure: Failure, error: Error, adapterName: String?) -> String {
        let text: String
        switch failure {
        case .unreachable: text = unreachableMessage
        case .noAnswer: text = noAnswerMessage
        case .other: return error.localizedDescription
        }
        guard let name = adapterName, name.lowercased().contains("vlinker") else { return text }
        return text + "\n" + vLinkerNote
    }
}

/// Finding the saved adapter again at a new Bluetooth identifier: a vLinker MC+ gets a new one each time it's
/// plugged in. A match is only offered to the owner, never used by itself, since another Ocean's adapter with the
/// same name may be parked next to you. Pure, so it can be unit tested.
enum MovedAdapter {
    /// The one scan after a failed connect stops after this long.
    static let scanSeconds = 8.0

    /// Whether the saved name can tell the adapter apart: not blank, and not the name used when it had none.
    static func canLookFor(_ savedName: String?) -> Bool {
        guard let name = savedName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty else { return false }
        return name != "Adapter" && name != String(localized: "Adapter")
    }

    /// The same name as the saved adapter (trimmed, exact, case-sensitive) at a different identifier.
    static func matches(name: String, id: UUID, savedName: String?, savedId: UUID) -> Bool {
        guard let saved = savedName, canLookFor(saved), id != savedId else { return false }
        return name.trimmingCharacters(in: .whitespacesAndNewlines) == saved.trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
