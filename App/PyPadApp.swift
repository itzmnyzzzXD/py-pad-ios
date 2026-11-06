import SwiftUI

@main
struct PyPadApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
        }
    }
}

struct ContentView: View {
    var body: some View {
        ZStack {
            Color(red: 0.043, green: 0.055, blue: 0.078).ignoresSafeArea()
            // The IDE UI is a bundled web app. The keyboard safe-area is kept so the
            // page resizes above the keyboard; every other edge is edge-to-edge.
            WebViewContainer()
                .ignoresSafeArea(.container, edges: .all)
        }
    }
}
