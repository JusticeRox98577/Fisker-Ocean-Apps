import SwiftUI

@main
struct OceanLiveApp: App {
    @StateObject private var car = Car.shared

    init() {
        // Must be registered before launch finishes. Only ever asks the adapter for the 12V.
        V12Background.register()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(car)
                .preferredColorScheme(.dark)
        }
    }
}

struct RootView: View {
    @EnvironmentObject var car: Car
    @Environment(\.scenePhase) private var scenePhase
    @State private var tab = 0

    init() {
        let bar = UITabBarAppearance()
        bar.configureWithOpaqueBackground()
        bar.backgroundColor = UIColor(Theme.bg)
        bar.shadowColor = UIColor(Theme.edge)
        UITabBar.appearance().standardAppearance = bar
        UITabBar.appearance().scrollEdgeAppearance = bar
    }

    var body: some View {
        TabView(selection: $tab) {
            LiveView().tabItem { Label("Live", systemImage: "bolt.circle") }.tag(0)
            BatteryView().tabItem { Label("Battery", systemImage: "battery.75percent") }.tag(1)
            TripsView().tabItem { Label("Trips", systemImage: "point.topleft.down.to.point.bottomright.curvepath") }.tag(2)
            FaultsView().tabItem { Label("Faults", systemImage: "exclamationmark.triangle") }.tag(3)
            SettingsView().tabItem { Label("Settings", systemImage: "gearshape") }.tag(4)
        }
        .tint(Theme.aqua)
        // Connects only once the app is actually on screen, never from a launch in the background.
        .task { car.setInBackground(scenePhase != .active) }
        .onChange(of: scenePhase) { _, phase in
            // Off screen, a parked car is left to sleep after a while; back on screen connects again.
            car.setInBackground(phase != .active)
            // Remember the last reading in case iPhone ends the app while it's in the background.
            if phase == .background { car.saveParkedAnchor() }
        }
    }
}
