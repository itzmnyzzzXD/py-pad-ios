import SwiftUI
import WebKit

struct WebViewContainer: UIViewRepresentable {
    func makeCoordinator() -> Bridge { Bridge() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        // Serve the bundled IDE from a real origin (app://local) so fetch(), WebAssembly,
        // localStorage etc. behave like they do on a normal website.
        config.setURLSchemeHandler(AppSchemeHandler(), forURLScheme: "app")
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

        let bridge = context.coordinator
        config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "fs")
        config.userContentController.add(bridge, name: "native")

        let web = WKWebView(frame: .zero, configuration: config)
        web.isOpaque = false
        web.backgroundColor = UIColor(red: 0.043, green: 0.055, blue: 0.078, alpha: 1)
        web.scrollView.backgroundColor = web.backgroundColor
        web.scrollView.contentInsetAdjustmentBehavior = .never
        web.scrollView.bounces = false
        web.scrollView.isScrollEnabled = false
        web.allowsLinkPreview = false
        web.allowsBackForwardNavigationGestures = false
        if #available(iOS 16.4, *) { web.isInspectable = true }

        bridge.attach(web)
        web.load(URLRequest(url: URL(string: "app://local/index.html")!))
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}
}

/// Serves files from the bundled `Web` folder under app://local/...
final class AppSchemeHandler: NSObject, WKURLSchemeHandler {
    private let base = Bundle.main.resourceURL!.appendingPathComponent("Web", isDirectory: true)

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL)); return
        }
        var path = url.path
        if path.isEmpty || path == "/" { path = "/index.html" }
        let file = base.appendingPathComponent(String(path.dropFirst()))

        let basePath = base.standardizedFileURL.path
        guard file.standardizedFileURL.path.hasPrefix(basePath),
              let data = try? Data(contentsOf: file, options: .mappedIfSafe) else {
            let r = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1",
                                    headerFields: ["Access-Control-Allow-Origin": "*"])!
            urlSchemeTask.didReceive(r)
            urlSchemeTask.didReceive(Data())
            urlSchemeTask.didFinish()
            return
        }
        let headers = [
            "Content-Type": AppSchemeHandler.mime(file.pathExtension),
            "Content-Length": "\(data.count)",
            "Access-Control-Allow-Origin": "*",
            "Cache-Control": "no-cache"
        ]
        let r = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!
        urlSchemeTask.didReceive(r)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    static func mime(_ ext: String) -> String {
        switch ext.lowercased() {
        case "html", "htm": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json", "map": return "application/json; charset=utf-8"
        case "py", "txt", "md": return "text/plain; charset=utf-8"
        case "wasm": return "application/wasm"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "jpg", "jpeg": return "image/jpeg"
        case "woff2": return "font/woff2"
        default: return "application/octet-stream"
        }
    }
}
