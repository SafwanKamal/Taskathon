import AppKit
import WebKit
import Foundation

final class WindowDragView: NSView {
    override var mouseDownCanMoveWindow: Bool { true }

    override func acceptsFirstMouse(for event: NSEvent?) -> Bool {
        return true
    }

    override func hitTest(_ point: NSPoint) -> NSView? {
        return bounds.contains(point) ? self : nil
    }

    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var webProcess: Process?
    private var mcpProcess: Process?
    private let host = "127.0.0.1"
    private let webPort = "3000"
    private let mcpPort = "8000"

    func applicationDidFinishLaunching(_ notification: Notification) {
        createWindow()
        prepareDataDirectory()
        startServers()
        loadWhenReady()
    }

    func applicationWillTerminate(_ notification: Notification) {
        webProcess?.terminate()
        mcpProcess?.terminate()
    }

    private func createWindow() {
        let configuration = WKWebViewConfiguration()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.translatesAutoresizingMaskIntoConstraints = false

        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        window.center()
        window.title = "Taskathon"
        window.titleVisibility = .hidden
        window.titlebarAppearsTransparent = true
        window.styleMask.insert(.fullSizeContentView)
        window.titlebarSeparatorStyle = .none
        window.backgroundColor = NSColor.clear
        window.isOpaque = false
        window.isMovableByWindowBackground = true

        let contentView = NSView()
        contentView.wantsLayer = true
        contentView.layer?.backgroundColor = NSColor.clear.cgColor

        let dragView = WindowDragView()
        dragView.translatesAutoresizingMaskIntoConstraints = false
        dragView.wantsLayer = true
        dragView.layer?.backgroundColor = NSColor.clear.cgColor

        contentView.addSubview(webView)
        contentView.addSubview(dragView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            webView.topAnchor.constraint(equalTo: contentView.topAnchor),
            webView.bottomAnchor.constraint(equalTo: contentView.bottomAnchor),
            dragView.leadingAnchor.constraint(equalTo: contentView.leadingAnchor, constant: 92),
            dragView.trailingAnchor.constraint(equalTo: contentView.trailingAnchor),
            dragView.topAnchor.constraint(equalTo: contentView.topAnchor),
            dragView.heightAnchor.constraint(equalToConstant: 40)
        ])

        window.contentView = contentView
        window.makeKeyAndOrderFront(nil)
    }

    private func prepareDataDirectory() {
        let fileManager = FileManager.default
        let supportDir = applicationSupportDirectory()
        let dataPath = supportDir.appendingPathComponent("workspace.json")
        guard !fileManager.fileExists(atPath: dataPath.path) else { return }

        do {
            try fileManager.createDirectory(at: supportDir, withIntermediateDirectories: true)
            if let seedPath = Bundle.main.resourceURL?.appendingPathComponent("app/data/workspace.json") {
                try fileManager.copyItem(at: seedPath, to: dataPath)
            }
        } catch {
            NSLog("Taskathon data setup failed: \(error.localizedDescription)")
        }
    }

    private func startServers() {
        guard let resourceURL = Bundle.main.resourceURL else { return }
        let appRoot = resourceURL.appendingPathComponent("app")
        let serverScript = appRoot.appendingPathComponent("src/server.js")
        let mcpScript = appRoot.appendingPathComponent("mcp/taskathon-mcp-server.js")
        let dataPath = applicationSupportDirectory().appendingPathComponent("workspace.json").path

        webProcess = runNode(
            script: serverScript.path,
            currentDirectory: appRoot.path,
            environment: [
                "HOST": host,
                "PORT": webPort,
                "DATA_PATH": dataPath
            ]
        )

        mcpProcess = runNode(
            script: mcpScript.path,
            currentDirectory: appRoot.path,
            environment: [
                "MCP_HOST": host,
                "MCP_PORT": mcpPort,
                "TASKATHON_URL": "http://\(host):\(webPort)"
            ]
        )
    }

    private func runNode(script: String, currentDirectory: String, environment: [String: String]) -> Process {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        process.arguments = ["node", script]
        process.currentDirectoryURL = URL(fileURLWithPath: currentDirectory)

        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
        for (key, value) in environment {
            env[key] = value
        }
        process.environment = env

        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = pipe

        do {
            try process.run()
        } catch {
            NSLog("Failed to start node process \(script): \(error.localizedDescription)")
        }

        return process
    }

    private func loadWhenReady(attempt: Int = 0) {
        let url = URL(string: "http://\(host):\(webPort)/?app=mac")!
        let healthURL = URL(string: "http://\(host):\(webPort)/api/health")!
        var request = URLRequest(url: healthURL)
        request.timeoutInterval = 0.6

        URLSession.shared.dataTask(with: request) { [weak self] data, response, _ in
            let statusOK = (response as? HTTPURLResponse)?.statusCode == 200
            let serviceOK = data.flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }?["service"] as? String == "taskathon-notion-lite"
            let ok = statusOK && serviceOK
            DispatchQueue.main.async {
                if ok {
                    self?.webView.load(URLRequest(url: url))
                } else if attempt < 60 {
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                        self?.loadWhenReady(attempt: attempt + 1)
                    }
                } else {
                    self?.webView.loadHTMLString("<h1>Taskathon could not start</h1><p>Check that Node.js is installed and ports 3000/8000 are available.</p>", baseURL: nil)
                }
            }
        }.resume()
    }

    private func applicationSupportDirectory() -> URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Taskathon", isDirectory: true)
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()
