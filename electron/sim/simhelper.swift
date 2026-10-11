// Drives one booted simulator without Simulator.app: frames come from the device framebuffer IOSurface, input goes
// through SimulatorKit's Indigo HID client. Private frameworks, so no Screen Recording or Accessibility permission.
// Usage: simhelper <developer-dir> <udid>. stdout: frames as [u32 BE length][JPEG]. stdin: one JSON command per line.
// stderr: `ready <width> <height>` once, then errors as plain lines.
import CoreImage
import Foundation
import ImageIO
import IOSurface
import UniformTypeIdentifiers

let developerDir = CommandLine.arguments[1]
let udid = CommandLine.arguments[2]

func fail(_ message: String) -> Never {
  FileHandle.standardError.write("error \(message)\n".data(using: .utf8)!)
  exit(1)
}

guard dlopen("/Library/Developer/PrivateFrameworks/CoreSimulator.framework/CoreSimulator", RTLD_NOW) != nil else { fail("CoreSimulator not found") }
// Xcode 26+ ships SimulatorKit in SharedFrameworks; older Xcodes kept it under the developer dir.
let simulatorKitPaths = ["\(developerDir)/../SharedFrameworks", "\(developerDir)/Library/PrivateFrameworks"].map { "\($0)/SimulatorKit.framework/SimulatorKit" }
guard let simulatorKit = simulatorKitPaths.lazy.compactMap({ dlopen($0, RTLD_NOW) }).first else { fail("SimulatorKit not found") }

typealias MouseMessage = @convention(c) (UnsafePointer<CGPoint>, UnsafePointer<CGPoint>?, UInt32, UInt, CGSize, UInt32) -> UnsafeMutableRawPointer?
typealias ButtonMessage = @convention(c) (UInt32, UInt32, UInt32) -> UnsafeMutableRawPointer?
typealias KeyMessage = @convention(c) (UInt32, UInt32) -> UnsafeMutableRawPointer?
func symbol<T>(_ name: String, as _: T.Type) -> T {
  guard let pointer = dlsym(simulatorKit, name) else { fail("\(name) missing from SimulatorKit") }
  return unsafeBitCast(pointer, to: T.self)
}
let mouseMessage = symbol("IndigoHIDMessageForMouseNSEvent", as: MouseMessage.self)
let buttonMessage = symbol("IndigoHIDMessageForButton", as: ButtonMessage.self)
let keyMessage = symbol("IndigoHIDMessageForKeyboardArbitrary", as: KeyMessage.self)

typealias ErrorCall1 = @convention(c) (AnyObject, Selector, AnyObject?, UnsafeMutablePointer<NSError?>) -> AnyObject?
typealias ErrorCall0 = @convention(c) (AnyObject, Selector, UnsafeMutablePointer<NSError?>) -> AnyObject?
func call(_ target: AnyObject, _ selector: String, _ argument: AnyObject? = nil) -> AnyObject {
  let sel = NSSelectorFromString(selector)
  guard let imp = (target as? NSObject)?.method(for: sel) else { fail("\(selector) unavailable") }
  var error: NSError?
  let result = argument == nil
    ? unsafeBitCast(imp, to: ErrorCall0.self)(target, sel, &error)
    : unsafeBitCast(imp, to: ErrorCall1.self)(target, sel, argument, &error)
  guard let result else { fail("\(selector): \(error?.localizedDescription ?? "nil")") }
  return result
}
func get(_ target: AnyObject, _ selector: String) -> AnyObject? {
  (target as? NSObject)?.perform(NSSelectorFromString(selector))?.takeUnretainedValue()
}

guard let contextClass = NSClassFromString("SimServiceContext") else { fail("SimServiceContext missing") }
let context = call(contextClass, "sharedServiceContextForDeveloperDir:error:", developerDir as NSString)
let deviceSet = call(context, "defaultDeviceSetWithError:")
let devices = get(deviceSet, "devices") as? [NSObject] ?? []
guard let device = devices.first(where: { (get($0, "UDID") as? NSUUID)?.uuidString == udid }) else { fail("no device \(udid)") }

// Ports are ROCK remote proxies: KVC throws on them, plain selectors work.
func framebuffer() -> IOSurface? {
  guard let io = get(device, "io"), let ports = get(io, "ioPorts") as? [NSObject] else { return nil }
  for port in ports {
    guard let descriptor = get(port, "descriptor") as? NSObject, descriptor.responds(to: NSSelectorFromString("framebufferSurface")) else { continue }
    if let surface = get(descriptor, "framebufferSurface") as? IOSurface { return surface }
  }
  return nil
}

guard let hidClass = NSClassFromString("_TtC12SimulatorKit24SimDeviceLegacyHIDClient") as? NSObject.Type else { fail("SimDeviceLegacyHIDClient missing") }
let hid = call(hidClass.perform(NSSelectorFromString("alloc")).takeUnretainedValue(), "initWithDevice:error:", device)
typealias SendCall = @convention(c) (AnyObject, Selector, UnsafeMutableRawPointer, Bool, AnyObject?, AnyObject?) -> Void
let sendSelector = NSSelectorFromString("sendWithMessage:freeWhenDone:completionQueue:completion:")
let sendImp = unsafeBitCast((hid as! NSObject).method(for: sendSelector), to: SendCall.self)
func send(_ message: UnsafeMutableRawPointer?) {
  guard let message else { return }
  sendImp(hid, sendSelector, message, true, nil, nil)
}

let touchTarget: UInt32 = 0x32
let buttonTarget: UInt32 = 0x33
let buttons: [String: UInt32] = ["home": 0x0, "lock": 0x1, "side": 0xbb8, "siri": 0x400002, "applepay": 0x1f4]

guard var surface = framebuffer() else { fail("no framebuffer: is \(udid) booted?") }
FileHandle.standardError.write("ready \(surface.width) \(surface.height)\n".data(using: .utf8)!)

func handle(_ line: String) {
  guard let data = line.data(using: .utf8), let command = try? JSONSerialization.jsonObject(with: data) as? [String: Any], let kind = command["t"] as? String else { return }
  switch kind {
  case "touch":
    // x/y arrive as 0...1 of the screen; Indigo takes them as a ratio with a unit size.
    guard let x = command["x"] as? Double, let y = command["y"] as? Double, let phase = command["phase"] as? String else { return }
    let types: [String: UInt] = ["down": 1, "move": 6, "up": 2]
    guard let type = types[phase] else { return }
    var point = CGPoint(x: x, y: y)
    send(mouseMessage(&point, nil, touchTarget, type, CGSize(width: 1, height: 1), 0))
  case "button":
    guard let name = command["name"] as? String, let source = buttons[name] else { return }
    send(buttonMessage(source, 1, buttonTarget))
    send(buttonMessage(source, 2, buttonTarget))
  case "key":
    guard let usage = command["usage"] as? Int, let down = command["down"] as? Bool else { return }
    send(keyMessage(UInt32(usage), down ? 1 : 2))
  default:
    return
  }
}

DispatchQueue.global().async {
  while let line = readLine() { handle(line) }
  exit(0)
}

let ciContext = CIContext(options: [.useSoftwareRenderer: false])
let scale = Double(CommandLine.arguments.count > 3 ? CommandLine.arguments[3] : "0.5") ?? 0.5
let stdout = FileHandle.standardOutput
var lastSeed: UInt32 = 0
let timer = DispatchSource.makeTimerSource(queue: .main)
// GAP: polls the surface seed at 60 Hz; a damage callback would save the wakeups while the screen is idle.
timer.schedule(deadline: .now(), repeating: .milliseconds(16))
timer.setEventHandler {
  if surface.seed == lastSeed, let fresh = framebuffer(), fresh.width != surface.width { surface = fresh }
  guard surface.seed != lastSeed else { return }
  lastSeed = surface.seed
  let image = CIImage(ioSurface: surface).transformed(by: CGAffineTransform(scaleX: scale, y: scale))
  guard let cgImage = ciContext.createCGImage(image, from: image.extent) else { return }
  let jpeg = NSMutableData()
  guard let destination = CGImageDestinationCreateWithData(jpeg, UTType.jpeg.identifier as CFString, 1, nil) else { return }
  CGImageDestinationAddImage(destination, cgImage, [kCGImageDestinationLossyCompressionQuality: 0.7] as CFDictionary)
  guard CGImageDestinationFinalize(destination) else { return }
  var length = UInt32(jpeg.length).bigEndian
  stdout.write(Data(bytes: &length, count: 4))
  stdout.write(jpeg as Data)
}
timer.resume()
dispatchMain()
