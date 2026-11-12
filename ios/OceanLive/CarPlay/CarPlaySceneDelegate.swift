import CarPlay
import SwiftUI
import UIKit

/// CarPlay entry point (driving-task category). The interface is built once and then
/// updated in place every second, so CarPlay never reloads the screen.
@MainActor
final class CarPlaySceneDelegate: UIResponder, CPTemplateApplicationSceneDelegate {
    private var dashboard: CarPlayDashboard?

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                  didConnect interfaceController: CPInterfaceController) {
        let car = Car.shared
        car.setCarPlayConnected(true)
        car.autoStart()
        let dash = CarPlayDashboard(car: car)
        dashboard = dash
        interfaceController.setRootTemplate(dash.template, animated: false, completion: nil)
        dash.start()
    }

    func templateApplicationScene(_ templateApplicationScene: CPTemplateApplicationScene,
                                  didDisconnectInterfaceController interfaceController: CPInterfaceController) {
        dashboard?.stop()
        dashboard = nil
        Car.shared.setCarPlayConnected(false)
    }
}

/// The CarPlay version of the Live screen: charge ring, power, the current charge or drive,
/// and the same battery tiles as the phone, each with its accent colour.
@MainActor
final class CarPlayDashboard {
    let template: CPListTemplate

    private let car: Car
    private let charge: CPListItem
    private let power: CPListItem
    private let session: CPListItem
    private let tiles: [Tile]
    private var task: Task<Void, Never>?
    private var ringKey = ""

    private struct Tile {
        let item: CPListItem
        let value: (CarState, Settings, [HistoryEntry]) -> String
        let caption: (CarState, Settings, [HistoryEntry]) -> String
    }

    init(car: Car) {
        self.car = car
        // Every row starts with its final layout (text, detail and a fixed-size image), so later
        // updates only swap content and never change a row's height. That is what made CarPlay jump.
        charge = CPListItem(text: "—", detailText: "Connecting…",
                            image: CarPlayDashboard.ring(soc: nil, charging: false, live: false))
        power = CPListItem(text: "— kW", detailText: "power", image: CarPlayDashboard.symbol("bolt.circle.fill", Theme.aqua))
        session = CPListItem(text: "Parked", detailText: "No charge or drive in progress", image: CarPlayDashboard.symbol("car.fill", Theme.aqua))

        func tile(_ symbol: String, _ color: Color, value: @escaping (CarState, Settings, [HistoryEntry]) -> String,
                  caption: @escaping (CarState, Settings, [HistoryEntry]) -> String) -> Tile {
            Tile(item: CPListItem(text: "—", detailText: nil, image: CarPlayDashboard.symbol(symbol, color)), value: value, caption: caption)
        }

        tiles = [
            tile("bolt.fill", Theme.violet,
                 value: { s, _, _ in s.snapshot.packV.map { Format.n($0, 1) + " V" } ?? "—" },
                 caption: { _, _, _ in "Pack voltage" }),
            tile("arrow.left.arrow.right", Theme.cyan,
                 value: { s, _, _ in s.snapshot.packA.map { Format.n($0, 1) + " A" } ?? "—" },
                 caption: { _, _, _ in "Current" }),
            tile("thermometer.medium", Theme.warn,
                 value: { s, settings, _ in Format.temp(s.snapshot.tempAvg, settings) ?? "—" },
                 caption: { s, settings, _ in
                     "Battery temp" + (Format.temp(s.snapshot.tempMax, settings).map { " · max " + $0 } ?? "")
                 }),
            tile("chart.bar.fill", Theme.aqua,
                 value: { s, _, _ in s.snapshot.cellSpread.map { "\(Int($0.rounded())) mV" } ?? "—" },
                 caption: { s, _, _ in "Cell spread" + (s.snapshot.cellSpread.map { " · " + balanceLabel($0) } ?? "") }),
            tile("minus.plus.batteryblock.fill", Theme.good,
                 value: { s, _, _ in s.snapshot.aux12v.map { Format.n($0, 2) + " V" } ?? "—" },
                 caption: { s, _, _ in "12V battery" + (s.snapshot.aux12v.map { " · " + auxStatus($0) } ?? "") }),
            tile("road.lanes", Theme.violet,
                 value: { s, settings, _ in Format.distance(s.snapshot.odometerKm, settings) ?? "—" },
                 caption: { _, settings, history in
                     "Odometer" + (Format.efficiency(Format.whPerKm(history), settings).map { " · avg " + $0 } ?? "")
                 }),
        ]

        template = CPListTemplate(title: "Ocean Live", sections: [
            CPListSection(items: [charge, power, session]),
            CPListSection(items: tiles.map(\.item), header: "Battery", sectionIndexTitle: nil),
        ])

        // Tapping the charge row connects when the app isn't connected yet.
        charge.handler = { [weak self] _, completion in
            Task { @MainActor in
                self?.connectIfIdle()
                completion()
            }
        }
    }

    func start() {
        refresh()
        task?.cancel()
        task = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                self?.refresh()
            }
        }
    }

    func stop() {
        task?.cancel()
        task = nil
    }

    private func connectIfIdle() {
        let status = car.state.status
        if status == .idle || status == .error { car.connectSaved() }
    }

    /// Changes only what differs, in place. No template or section is ever replaced.
    private func refresh() {
        let state = car.state
        let settings = car.settings
        let history = car.history
        let snap = state.snapshot
        let charging = state.mode == .charging

        set(charge, text: snap.soc.map { Format.n($0, 1) + "%" } ?? "—",
            detail: [Format.range(snap.soc, settings, history), statusText(state)].compactMap { $0 }.joined(separator: " · "))
        let key = ringKeyFor(snap.soc, charging: charging, live: state.status == .live)
        if key != ringKey {
            ringKey = key
            charge.setImage(Self.ring(soc: snap.soc, charging: charging, live: state.status == .live))
        }

        let p = snap.powerKw
        set(power, text: p.map { Format.n(abs($0), 1) + " kW" } ?? "— kW", detail: powerLabel(p, charging: charging))

        if charging, let c = state.currentCharge {
            // Kept short so the line never wraps (a wrap would change the row height and make the list jump).
            var parts = [Format.duration(c.minutes)]
            if let t = timeToTarget(snap.soc, p, settings) { parts.append("to \(settings.alertHigh)% " + t) }
            set(session, text: (c.fast ? "DC fast charging" : "Charging") + " · +" + Format.n(c.kwh, 1) + " kWh",
                detail: parts.joined(separator: " · "))
        } else if state.mode == .driving, let d = state.currentDrive {
            let parts = [Format.n(d.kwh, 1) + " kWh", Format.efficiency(d.whPerKm, settings), Format.duration(d.minutes)].compactMap { $0 }
            set(session, text: "Drive · " + (Format.distance(d.distanceKm, settings, decimals: 1) ?? "—"),
                detail: parts.joined(separator: " · "))
        } else {
            set(session, text: "Parked", detail: "No charge or drive in progress")
        }

        for t in tiles {
            set(t.item, text: t.value(state, settings, history), detail: t.caption(state, settings, history))
        }
    }

    private func set(_ item: CPListItem, text: String, detail: String) {
        if item.text != text { item.setText(text) }
        if item.detailText != detail { item.setDetailText(detail) }
    }

    private func statusText(_ s: CarState) -> String {
        switch s.status {
        case .live:
            if s.mode == .charging { return s.currentCharge?.fast == true ? "DC fast charging" : "Charging" }
            if s.mode == .driving { return "Driving" }
            return "Parked · live"
        case .reconnecting: return "Reconnecting"
        case .connecting: return "Connecting"
        case .scanning: return "Looking for adapter"
        case .idle, .error:
            if s.stopped != nil && car.settings.adapterId != nil { return "Car left to sleep · tap to connect" }
            return car.settings.adapterId != nil ? "Not connected · tap to connect" : "No adapter set up"
        }
    }

    private func powerLabel(_ p: Double?, charging: Bool) -> String {
        guard let p else { return "power" }
        if p > 0.3 { return charging ? "into the battery" : "regenerating" }
        if p < -0.3 { return "from the battery" }
        return "idle"
    }

    private func timeToTarget(_ soc: Double?, _ powerKw: Double?, _ s: Settings) -> String? {
        guard let soc, let powerKw, powerKw >= 0.5, soc < Double(s.alertHigh), s.usableKwh > 0 else { return nil }
        let kwh = (Double(s.alertHigh) - soc) / 100 * s.usableKwh
        return "≈ " + Format.duration(Int64((kwh / powerKw * 60).rounded()))
    }

    // MARK: Images

    /// Redraw the ring only when it would look different (half-percent steps).
    private func ringKeyFor(_ soc: Double?, charging: Bool, live: Bool) -> String {
        "\(soc.map { Int(($0 * 2).rounded()) } ?? -1)-\(charging)-\(live)"
    }

    /// The phone's charge ring: a 270° gradient arc over a dark track.
    static func ring(soc: Double?, charging: Bool, live: Bool) -> UIImage {
        let size = CPListItem.maximumImageSize
        let colors: [UIColor]
        if charging {
            colors = [Theme.good, Theme.aqua, Theme.good].map { UIColor($0) }
        } else if let soc, soc < 20 {
            colors = [Theme.bad, Theme.warn, Theme.bad].map { UIColor($0) }
        } else {
            colors = [Theme.aqua, Theme.cyan, Theme.violet].map { UIColor($0) }
        }
        return UIGraphicsImageRenderer(size: size).image { _ in
            let w = Swift.min(size.width, size.height)
            let line = w * 0.15
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let radius = (w - line) / 2 - 1
            let start = CGFloat.pi * 0.75
            let sweep = CGFloat.pi * 1.5

            let track = UIBezierPath(arcCenter: center, radius: radius, startAngle: start, endAngle: start + sweep, clockwise: true)
            track.lineWidth = line
            track.lineCapStyle = .round
            UIColor(Theme.track).setStroke()
            track.stroke()

            guard let soc else { return }
            let fraction = CGFloat(Swift.min(Swift.max(soc / 100, 0), 1))
            guard fraction > 0 else { return }
            let steps = Swift.max(Int(80 * fraction), 2)
            for i in 0..<steps {
                let t0 = CGFloat(i) / CGFloat(steps)
                let t1 = CGFloat(i + 1) / CGFloat(steps)
                let seg = UIBezierPath(arcCenter: center, radius: radius,
                                       startAngle: start + sweep * fraction * t0,
                                       endAngle: start + sweep * fraction * t1 + 0.004, clockwise: true)
                seg.lineWidth = line
                seg.lineCapStyle = (i == 0 || i == steps - 1) ? .round : .butt
                blend(colors, t0).withAlphaComponent(live ? 1 : 0.6).setStroke()
                seg.stroke()
            }
        }
    }

    private static func blend(_ colors: [UIColor], _ t: CGFloat) -> UIColor {
        guard colors.count > 1 else { return colors.first ?? .white }
        let x = Swift.min(Swift.max(t, 0), 1) * CGFloat(colors.count - 1)
        let i = Swift.min(Int(x), colors.count - 2)
        let f = x - CGFloat(i)
        var r1: CGFloat = 0, g1: CGFloat = 0, b1: CGFloat = 0, a1: CGFloat = 0
        var r2: CGFloat = 0, g2: CGFloat = 0, b2: CGFloat = 0, a2: CGFloat = 0
        colors[i].getRed(&r1, green: &g1, blue: &b1, alpha: &a1)
        colors[i + 1].getRed(&r2, green: &g2, blue: &b2, alpha: &a2)
        return UIColor(red: r1 + (r2 - r1) * f, green: g1 + (g2 - g1) * f, blue: b1 + (b2 - b1) * f, alpha: 1)
    }

    /// An SF Symbol in the tile's accent colour, as on the phone.
    static func symbol(_ name: String, _ color: Color) -> UIImage? {
        let config = UIImage.SymbolConfiguration(pointSize: 22, weight: .semibold)
        return UIImage(systemName: name, withConfiguration: config)?
            .withTintColor(UIColor(color), renderingMode: .alwaysOriginal)
    }
}
