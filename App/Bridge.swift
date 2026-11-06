import UIKit
import WebKit
import UniformTypeIdentifiers

/// Connects the web IDE to iOS: persistent workspace (Documents/Workspace, visible in the
/// Files app), native JS dialogs (alert/confirm/prompt -> used by Python input()),
/// share sheets, haptics and mouse-pointer control.
final class Bridge: NSObject, WKScriptMessageHandler, WKScriptMessageHandlerWithReply,
                    WKUIDelegate, UIPointerInteractionDelegate, UIDocumentPickerDelegate {

    enum BridgeError: LocalizedError {
        case bad(String)
        var errorDescription: String? { if case .bad(let m) = self { return m }; return nil }
    }

    weak var web: WKWebView?
    private var hidePointer = false
    private var pointerInteraction: UIPointerInteraction?
    private var pickerReply: ((Any?, String?) -> Void)?
    private var pickerTarget = ""
    let root: URL

    override init() {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        root = docs.appendingPathComponent("Workspace", isDirectory: true)
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        super.init()
    }

    func attach(_ w: WKWebView) {
        web = w
        w.uiDelegate = self
        let pi = UIPointerInteraction(delegate: self)
        pointerInteraction = pi
        w.addInteraction(pi)
    }

    // MARK: - Path helpers

    private func url(_ rel: String) throws -> URL {
        let comps = rel.split(separator: "/").map(String.init).filter { $0 != "." && !$0.isEmpty }
        if comps.contains("..") { throw BridgeError.bad("Invalid path") }
        return comps.reduce(root) { $0.appendingPathComponent($1) }
    }

    private func str(_ b: [String: Any], _ key: String) throws -> String {
        guard let s = b[key] as? String else { throw BridgeError.bad("Missing \(key)") }
        return s
    }

    private func mimeFor(_ u: URL) -> String {
        UTType(filenameExtension: u.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
    }

    private func writeContent(_ content: String, to u: URL) throws {
        try FileManager.default.createDirectory(at: u.deletingLastPathComponent(), withIntermediateDirectories: true)
        if content.hasPrefix("data:"), let comma = content.firstIndex(of: ","),
           content[..<comma].contains(";base64"),
           let data = Data(base64Encoded: String(content[content.index(after: comma)...])) {
            try data.write(to: u, options: .atomic)
        } else {
            try content.write(to: u, atomically: true, encoding: .utf8)
        }
    }

    private func readAll() -> [String: Any] {
        var files = [String: String]()
        var dirs = [String]()
        let base = root.resolvingSymlinksInPath().path
        guard let en = FileManager.default.enumerator(
            at: root, includingPropertiesForKeys: [.isDirectoryKey, .fileSizeKey],
            options: [.skipsHiddenFiles]) else { return ["files": files, "dirs": dirs] }
        for case let u as URL in en {
            let p = u.resolvingSymlinksInPath().path
            guard p.hasPrefix(base) else { continue }
            let rel = String(p.dropFirst(base.count)).trimmingCharacters(in: CharacterSet(charactersIn: "/"))
            if rel.isEmpty { continue }
            let v = try? u.resourceValues(forKeys: [.isDirectoryKey, .fileSizeKey])
            if v?.isDirectory == true { dirs.append(rel); continue }
            if (v?.fileSize ?? 0) > 3_000_000 { continue }
            if let s = try? String(contentsOf: u, encoding: .utf8) {
                files[rel] = s
            } else if let d = try? Data(contentsOf: u) {
                files[rel] = "data:\(mimeFor(u));base64,\(d.base64EncodedString())"
            }
        }
        return ["files": files, "dirs": dirs]
    }

    // MARK: - fs (with reply)

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard let b = message.body as? [String: Any], let op = b["op"] as? String else {
            replyHandler(nil, "Bad message"); return
        }
        let fm = FileManager.default
        do {
            switch op {
            case "readAll":
                replyHandler(readAll(), nil)
            case "write":
                try writeContent(b["content"] as? String ?? "", to: try url(try str(b, "path")))
                replyHandler(true, nil)
            case "mkdir":
                try fm.createDirectory(at: try url(try str(b, "path")), withIntermediateDirectories: true)
                replyHandler(true, nil)
            case "delete":
                let u = try url(try str(b, "path"))
                if u.path != root.path, fm.fileExists(atPath: u.path) { try fm.removeItem(at: u) }
                replyHandler(true, nil)
            case "rename":
                let from = try url(try str(b, "from")), to = try url(try str(b, "to"))
                try fm.createDirectory(at: to.deletingLastPathComponent(), withIntermediateDirectories: true)
                if fm.fileExists(atPath: to.path) { try fm.removeItem(at: to) }
                try fm.moveItem(at: from, to: to)
                replyHandler(true, nil)
            case "import":
                let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
                picker.allowsMultipleSelection = true
                picker.delegate = self
                pickerReply = replyHandler
                pickerTarget = (b["dir"] as? String) ?? ""
                present(picker)
            default:
                replyHandler(nil, "Unknown op \(op)")
            }
        } catch {
            replyHandler(nil, error.localizedDescription)
        }
    }

    // MARK: - native (fire and forget)

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let b = message.body as? [String: Any], let cmd = b["cmd"] as? String else { return }
        switch cmd {
        case "haptic":
            let style: UIImpactFeedbackGenerator.FeedbackStyle = (b["style"] as? String) == "medium" ? .medium : .light
            UIImpactFeedbackGenerator(style: style).impactOccurred()
        case "openURL":
            if let s = b["url"] as? String, let u = URL(string: s) { UIApplication.shared.open(u) }
        case "pointerHidden":
            hidePointer = (b["value"] as? Bool) ?? false
            pointerInteraction?.invalidate()
        case "share":
            let name = (b["name"] as? String) ?? "file.txt"
            let content = (b["text"] as? String) ?? ""
            let safe = name.replacingOccurrences(of: "/", with: "_")
            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent(safe)
            try? FileManager.default.removeItem(at: tmp)
            if (try? writeContent(content, to: tmp)) != nil {
                present(UIActivityViewController(activityItems: [tmp], applicationActivities: nil))
            }
        case "exportZip":
            let coordinator = NSFileCoordinator()
            var err: NSError?
            coordinator.coordinate(readingItemAt: root, options: [.forUploading], error: &err) { zipURL in
                let dest = FileManager.default.temporaryDirectory.appendingPathComponent("PyPad-Workspace.zip")
                try? FileManager.default.removeItem(at: dest)
                try? FileManager.default.copyItem(at: zipURL, to: dest)
                DispatchQueue.main.async {
                    self.present(UIActivityViewController(activityItems: [dest], applicationActivities: nil))
                }
            }
        default:
            break
        }
    }

    // MARK: - Document picker

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        let fm = FileManager.default
        let dir = (try? url(pickerTarget)) ?? root
        var added = [String]()
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
        for u in urls {
            let dest = dir.appendingPathComponent(u.lastPathComponent)
            try? fm.removeItem(at: dest)
            if (try? fm.copyItem(at: u, to: dest)) != nil { added.append(u.lastPathComponent) }
        }
        pickerReply?(added, nil)
        pickerReply = nil
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pickerReply?([String](), nil)
        pickerReply = nil
    }

    // MARK: - Pointer (mouse / trackpad)

    func pointerInteraction(_ interaction: UIPointerInteraction, styleFor region: UIPointerRegion) -> UIPointerStyle? {
        hidePointer ? UIPointerStyle.hidden() : nil
    }

    // MARK: - JS dialogs (alert / confirm / prompt -> Python input())

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(a)
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        let a = UIAlertController(title: "Input", message: prompt, preferredStyle: .alert)
        a.addTextField { $0.text = defaultText; $0.autocapitalizationType = .none; $0.autocorrectionType = .no }
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(a.textFields?.first?.text ?? "") })
        present(a)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = navigationAction.request.url, u.scheme?.hasPrefix("http") == true {
            UIApplication.shared.open(u)
        }
        return nil
    }

    // MARK: - Presenting

    private func topController() -> UIViewController? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first
        var vc = scene?.windows.first(where: { $0.isKeyWindow })?.rootViewController ?? scene?.windows.first?.rootViewController
        while let p = vc?.presentedViewController { vc = p }
        return vc
    }

    private func present(_ vc: UIViewController) {
        guard let top = topController() else { return }
        if let pop = vc.popoverPresentationController {
            pop.sourceView = top.view
            pop.sourceRect = CGRect(x: top.view.bounds.midX, y: top.view.bounds.midY, width: 0, height: 0)
            pop.permittedArrowDirections = []
        }
        top.present(vc, animated: true)
    }
}
