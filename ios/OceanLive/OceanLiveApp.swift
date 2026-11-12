import SwiftUI

@main
struct OceanLiveApp: App {
    @StateObject private var car = Car()

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
        .task { car.autoStart() }
    }
}
