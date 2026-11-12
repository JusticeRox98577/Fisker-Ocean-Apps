import SwiftUI

@main
struct OceanLiveWatchApp: App {
    @StateObject private var store = WatchStore()

    var body: some Scene {
        WindowGroup {
            WatchView()
                .environmentObject(store)
                .task { store.start() }
        }
    }
}
