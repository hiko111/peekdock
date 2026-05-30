import AppKit
import Darwin
import Foundation

let bridgeURL = URL(string: ProcessInfo.processInfo.environment["PEEKDOCK_BRIDGE_URL"] ?? "http://127.0.0.1:4173")!
let repoRoot = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
let assetRoot = repoRoot.appendingPathComponent("assets/raw")
let debugVisible = ProcessInfo.processInfo.environment["PEEKDOCK_PET_DEBUG"] == "1"
let lockURL = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("peekdock-pet.lock")

struct PublicTask {
    let source: String
    let agentName: String
    let title: String
    let statusText: String
}

struct PublicState {
    let mode: String
    let phase: String
    let currentAgent: String
    let agentLocation: String
    let currentTask: PublicTask?
}

final class PetView: NSView {
    private let imageView = NSImageView()
    private let card = NSVisualEffectView()
    private let phaseLabel = NSTextField(labelWithString: "idle")
    private let titleLabel = NSTextField(labelWithString: "CodeX")
    private let statusLabel = NSTextField(labelWithString: "ready on Mac")
    private var cardVisible = false
    private var dragStart: NSPoint?
    private var dragStartGlobal: NSPoint?
    private var windowStart: NSPoint?
    private var dragged = false
    private var sentToDockFromDrag = false
    private var lastLocation = "mac"
    private var currentState = PublicState(mode: "clean", phase: "idle", currentAgent: "codex", agentLocation: "mac", currentTask: nil)
    private var frameIndex = 0
    private var animationTimer: Timer?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = debugVisible ? NSColor(calibratedRed: 0.08, green: 0.09, blue: 0.12, alpha: 1).cgColor : NSColor.clear.cgColor
        layer?.cornerRadius = debugVisible ? 14 : 0

        imageView.imageScaling = .scaleProportionallyUpOrDown
        imageView.frame = debugVisible ? NSRect(x: 54, y: 116, width: 150, height: 150) : NSRect(x: 28, y: 24, width: 38, height: 38)
        addSubview(imageView)

        card.material = .hudWindow
        card.blendingMode = .withinWindow
        card.state = .active
        card.wantsLayer = true
        card.layer?.cornerRadius = 10
        card.frame = debugVisible ? NSRect(x: 24, y: 16, width: 212, height: 94) : NSRect(x: 4, y: 4, width: 84, height: 22)
        card.isHidden = !debugVisible
        addSubview(card)

        phaseLabel.frame = NSRect(x: 8, y: debugVisible ? 62 : 10, width: debugVisible ? 150 : 66, height: 11)
        phaseLabel.textColor = NSColor(calibratedRed: 1, green: 0.42, blue: 0.1, alpha: 1)
        phaseLabel.font = .boldSystemFont(ofSize: debugVisible ? 10 : 9)
        card.addSubview(phaseLabel)

        titleLabel.frame = NSRect(x: 8, y: debugVisible ? 36 : 10, width: debugVisible ? 150 : 66, height: 12)
        titleLabel.textColor = .white
        titleLabel.font = .boldSystemFont(ofSize: debugVisible ? 13 : 10)
        titleLabel.lineBreakMode = .byTruncatingTail
        card.addSubview(titleLabel)

        statusLabel.frame = NSRect(x: 8, y: debugVisible ? 12 : 2, width: debugVisible ? 150 : 66, height: 10)
        statusLabel.textColor = NSColor(calibratedWhite: 0.74, alpha: 1)
        statusLabel.font = .systemFont(ofSize: debugVisible ? 11 : 9)
        statusLabel.lineBreakMode = .byTruncatingTail
        card.addSubview(statusLabel)

        setImage(named: "codex_idle_01.png")
        startAnimation()
    }

    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    private func setImage(named name: String) {
        imageView.image = NSImage(contentsOf: assetRoot.appendingPathComponent(name))
    }

    private func startAnimation() {
        animationTimer = Timer.scheduledTimer(withTimeInterval: 0.46, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.frameIndex = (self.frameIndex + 1) % 2
            self.applyImage(for: self.currentState)
        }
    }

    private func applyImage(for state: PublicState) {
        let suffix = frameIndex == 0 ? "01" : "02"
        let source = state.currentTask?.source ?? state.currentAgent
        let prefix = source == "claude" ? "claude" : "codex"
        if state.phase == "completed" {
            setImage(named: "\(prefix)_completed_\(suffix).png")
        } else if state.phase == "failed" || state.phase == "needs_input" {
            if prefix == "claude" {
                setImage(named: "claude_completed_\(suffix).png")
            } else {
                setImage(named: "codex_error_\(suffix).png")
            }
        } else if state.phase == "running" || state.phase == "handoff" {
            setImage(named: "\(prefix)_running_\(suffix).png")
        } else {
            setImage(named: "\(prefix)_idle_\(suffix).png")
        }
    }

    func apply(_ state: PublicState, window: NSWindow?) {
        currentState = state
        applyImage(for: state)

        if let task = state.currentTask {
            phaseLabel.stringValue = state.phase
            titleLabel.stringValue = task.title
            statusLabel.stringValue = task.statusText
        } else {
            phaseLabel.stringValue = "idle"
            titleLabel.stringValue = state.currentAgent == "claude" ? "Claude" : "CodeX"
            statusLabel.stringValue = "ready"
        }

        guard let window else { return }
        if state.agentLocation == "dock" {
            if lastLocation == "dock" {
                window.orderOut(nil)
                return
            }
            animateOut(window)
        } else if lastLocation == "dock" || !window.isVisible {
            window.orderFrontRegardless()
            animateIn(window)
        } else {
            window.orderFrontRegardless()
            keepWindowOnScreen(window)
        }
        lastLocation = state.agentLocation
    }

    private func animateOut(_ window: NSWindow) {
        sentToDockFromDrag = false
        let target = NSPoint(x: NSScreen.main!.visibleFrame.maxX + 40, y: window.frame.origin.y)
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.42
            context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
            window.animator().setFrameOrigin(target)
        } completionHandler: {
            window.orderOut(nil)
        }
    }

    private func animateIn(_ window: NSWindow) {
        guard let screen = NSScreen.main else { return }
        let visible = screen.visibleFrame
        let final = NSPoint(x: visible.maxX - window.frame.width - 24, y: visible.maxY - window.frame.height - 24)
        window.setFrameOrigin(NSPoint(x: visible.maxX + 40, y: final.y))
        NSAnimationContext.runAnimationGroup { context in
            context.duration = 0.46
            context.timingFunction = CAMediaTimingFunction(name: .easeOut)
            window.animator().setFrameOrigin(final)
        }
    }

    private func keepWindowOnScreen(_ window: NSWindow) {
        guard let screen = NSScreen.main else { return }
        let visible = screen.visibleFrame
        let frame = window.frame
        if frame.maxX < visible.minX || frame.minX > visible.maxX || frame.maxY < visible.minY || frame.minY > visible.maxY {
            window.setFrameOrigin(NSPoint(x: visible.maxX - frame.width - 24, y: visible.maxY - frame.height - 24))
        }
    }

    override func mouseDown(with event: NSEvent) {
        dragStart = event.locationInWindow
        dragStartGlobal = NSEvent.mouseLocation
        windowStart = window?.frame.origin
        dragged = false
        sentToDockFromDrag = false
    }

    override func mouseDragged(with event: NSEvent) {
        guard let window, let dragStart, let windowStart else { return }
        let current = NSEvent.mouseLocation
        let newOrigin = NSPoint(
            x: current.x - dragStart.x,
            y: current.y - dragStart.y
        )
        window.setFrameOrigin(newOrigin)
        self.windowStart = windowStart
        dragged = true
        sendToDockIfAtRightEdge()
    }

    override func mouseUp(with event: NSEvent) {
        guard let dragStartGlobal else { return }
        let endGlobal = NSEvent.mouseLocation
        let moved = abs(endGlobal.x - dragStartGlobal.x) + abs(endGlobal.y - dragStartGlobal.y)
        self.dragStart = nil
        self.dragStartGlobal = nil
        self.windowStart = nil
        if moved < 6 {
            cardVisible.toggle()
            card.isHidden = !cardVisible
            return
        }

        sendToDockIfAtRightEdge()
    }

    private func sendToDockIfAtRightEdge() {
        guard dragged, !sentToDockFromDrag, let window, let screen = NSScreen.main else { return }
        let visible = screen.visibleFrame
        let mouse = NSEvent.mouseLocation
        let pointerAtEdge = mouse.x >= visible.maxX - 44
        let windowAtEdge = window.frame.maxX >= visible.maxX - 8
        guard pointerAtEdge || windowAtEdge else { return }
        sentToDockFromDrag = true
        sendToDock()
    }

    private func sendToDock() {
        var request = URLRequest(url: bridgeURL.appendingPathComponent("api/send-to-dock"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "content-type")
        request.httpBody = Data("{}".utf8)
        URLSession.shared.dataTask(with: request).resume()
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate, URLSessionDataDelegate {
    private var window: NSWindow?
    private var petView: PetView?
    private var buffer = ""
    private var pollTimer: Timer?

    func applicationDidFinishLaunching(_ notification: Notification) {
        guard acquireSingleInstanceLock() else {
            NSApp.terminate(nil)
            return
        }
        NSApp.setActivationPolicy(.accessory)
        createWindow()
        fetchInitialState()
        connectEvents()
        startPollingState()
    }

    func applicationWillTerminate(_ notification: Notification) {
        pollTimer?.invalidate()
        try? FileManager.default.removeItem(at: lockURL)
    }

    private func acquireSingleInstanceLock() -> Bool {
        if let contents = try? String(contentsOf: lockURL, encoding: .utf8),
           let pid = Int32(contents.trimmingCharacters(in: .whitespacesAndNewlines)),
           kill(pid, 0) == 0 {
            _ = kill(pid, SIGTERM)
            usleep(250_000)
        }
        try? "\(ProcessInfo.processInfo.processIdentifier)".write(to: lockURL, atomically: true, encoding: .utf8)
        return true
    }

    private func createWindow() {
        guard let screen = NSScreen.main else { return }
        let visible = screen.visibleFrame
        let size = debugVisible ? NSSize(width: 260, height: 300) : NSSize(width: 96, height: 84)
        let origin = debugVisible
            ? NSPoint(x: visible.midX - size.width / 2, y: visible.midY - size.height / 2)
            : NSPoint(x: visible.maxX - size.width - 24, y: visible.maxY - size.height - 24)
        let frame = NSRect(origin: origin, size: size)

        let window = NSWindow(
            contentRect: frame,
            styleMask: debugVisible ? [.titled, .closable, .miniaturizable] : [.borderless],
            backing: .buffered,
            defer: false
        )
        window.title = "PeekDock Pet Debug"
        window.isOpaque = debugVisible
        window.backgroundColor = debugVisible ? NSColor(calibratedRed: 0.08, green: 0.09, blue: 0.12, alpha: 1) : .clear
        window.hasShadow = debugVisible
        window.level = debugVisible ? .normal : .floating
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        window.ignoresMouseEvents = false

        let petView = PetView(frame: NSRect(origin: .zero, size: size))
        window.contentView = petView
        window.orderFrontRegardless()
        NSApp.activate(ignoringOtherApps: true)

        self.window = window
        self.petView = petView
    }

    private func fetchInitialState() {
        let url = bridgeURL.appendingPathComponent("api/state")
        URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let data, let state = parseStateResponse(data) else { return }
            DispatchQueue.main.async {
                self?.petView?.apply(state, window: self?.window)
            }
        }.resume()
    }

    private func startPollingState() {
        pollTimer = Timer.scheduledTimer(withTimeInterval: 0.75, repeats: true) { [weak self] _ in
            self?.fetchInitialState()
        }
    }

    private func connectEvents() {
        let url = bridgeURL.appendingPathComponent("events")
        let session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
        session.dataTask(with: url).resume()
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let chunk = String(data: data, encoding: .utf8) else { return }
        buffer += chunk
        while let range = buffer.range(of: "\n\n") {
            let block = String(buffer[..<range.lowerBound])
            buffer.removeSubrange(buffer.startIndex..<range.upperBound)
            guard block.hasPrefix("data: ") else { continue }
            let jsonLine = String(block.dropFirst(6))
            guard let data = jsonLine.data(using: .utf8), let state = parseStateEvent(data) else { continue }
            DispatchQueue.main.async {
                self.petView?.apply(state, window: self.window)
            }
        }
    }
}

func parseStateResponse(_ data: Data) -> PublicState? {
    guard
        let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        let state = root["state"] as? [String: Any]
    else { return nil }
    return parseState(state)
}

func parseStateEvent(_ data: Data) -> PublicState? {
    guard
        let event = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        event["type"] as? String == "state",
        let state = event["state"] as? [String: Any]
    else { return nil }
    return parseState(state)
}

func parseState(_ state: [String: Any]) -> PublicState {
    var task: PublicTask?
    if let rawTask = state["currentTask"] as? [String: Any] {
        task = PublicTask(
            source: rawTask["source"] as? String ?? "codex",
            agentName: rawTask["agentName"] as? String ?? "CodeX",
            title: rawTask["title"] as? String ?? "Untitled",
            statusText: rawTask["statusText"] as? String ?? ""
        )
    }
    return PublicState(
        mode: state["mode"] as? String ?? "clean",
        phase: state["phase"] as? String ?? "idle",
        currentAgent: state["currentAgent"] as? String ?? "codex",
        agentLocation: state["agentLocation"] as? String ?? "mac",
        currentTask: task
    )
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()
