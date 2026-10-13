// Lists and captures other apps' windows through ScreenCaptureKit, on every Space: Electron's desktopCapturer sees only
// the current Space, so with Mochi in full screen it found no windows at all.
//   windows list <own pid>        → JSON [{ id, title, app, icon }] on stdout, windows on screen first
//   windows capture <id> <edge>   → base64 JPEG on stdout, fitted inside edge × edge; nothing when the window is gone
import AppKit
import ScreenCaptureKit

// SCContentFilter needs a window server connection, which NSApplication opens.
_ = NSApplication.shared

// System chrome that reports titled, layer-0 windows of its own.
let hiddenApps: Set<String> = ["com.apple.WindowManager", "com.apple.dock", "com.apple.controlcenter", "com.apple.notificationcenterui"]

struct Listed: Encodable {
  let id: String
  let title: String
  let app: String
  let icon: String?
}

func windows(excludingPid pid: pid_t) async throws -> [SCWindow] {
  let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
  return content.windows
    .filter { w in
      guard let owner = w.owningApplication, w.windowLayer == 0, !(w.title ?? "").isEmpty else { return false }
      return owner.processID != pid && !hiddenApps.contains(owner.bundleIdentifier) && w.frame.width > 64 && w.frame.height > 64
    }
    .sorted { $0.isOnScreen && !$1.isOnScreen }
}

func iconDataURL(_ pid: pid_t) -> String? {
  guard let icon = NSRunningApplication(processIdentifier: pid)?.icon else { return nil }
  let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 32, pixelsHigh: 32, bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
  NSGraphicsContext.saveGraphicsState()
  NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
  icon.draw(in: NSRect(x: 0, y: 0, width: 32, height: 32))
  NSGraphicsContext.restoreGraphicsState()
  return rep.representation(using: .png, properties: [:]).map { "data:image/png;base64,\($0.base64EncodedString())" }
}

func list(excludingPid pid: pid_t) async throws {
  var icons: [pid_t: String?] = [:]
  let listed = try await windows(excludingPid: pid).map { w -> Listed in
    let owner = w.owningApplication!
    if icons[owner.processID] == nil { icons[owner.processID] = iconDataURL(owner.processID) }
    return Listed(id: String(w.windowID), title: w.title!, app: owner.applicationName, icon: icons[owner.processID]!)
  }
  FileHandle.standardOutput.write(try JSONEncoder().encode(listed))
}

func capture(_ id: CGWindowID, edge: CGFloat) async throws {
  let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
  guard let window = content.windows.first(where: { $0.windowID == id }) else { return }
  let filter = SCContentFilter(desktopIndependentWindow: window)
  let config = SCStreamConfiguration()
  let scale = min(CGFloat(filter.pointPixelScale), edge / max(window.frame.width, window.frame.height))
  config.width = Int(window.frame.width * scale)
  config.height = Int(window.frame.height * scale)
  config.showsCursor = false
  let image = try await SCScreenshotManager.captureImage(contentFilter: filter, configuration: config)
  guard let jpeg = NSBitmapImageRep(cgImage: image).representation(using: .jpeg, properties: [.compressionFactor: 0.8]) else { return }
  FileHandle.standardOutput.write(jpeg.base64EncodedData())
}

let args = CommandLine.arguments
let done = DispatchSemaphore(value: 0)
Task {
  do {
    if args.count == 3, args[1] == "list", let pid = pid_t(args[2]) { try await list(excludingPid: pid) }
    else if args.count == 4, args[1] == "capture", let id = CGWindowID(args[2]), let edge = Double(args[3]) { try await capture(id, edge: CGFloat(edge)) }
    else { FileHandle.standardError.write("usage: windows list <pid> | windows capture <id> <edge>\n".data(using: .utf8)!); exit(2) }
  } catch {
    FileHandle.standardError.write("\(error)\n".data(using: .utf8)!)
    exit(1)
  }
  done.signal()
}
done.wait()
