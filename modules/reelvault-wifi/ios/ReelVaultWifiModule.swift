import ExpoModulesCore
import Foundation
import Network
import UIKit

/// Wi-Fi transfer: while the Wi-Fi screen is open, the phone serves a small
/// upload page on the local network. A computer on the same Wi-Fi opens the
/// address shown in the app, types the four-digit code, and drops videos in.
/// Each upload is streamed straight to a temporary file (never held in memory)
/// and handed to JavaScript, which imports it like any other video. The server
/// stops when the screen closes; nothing listens otherwise.
public class ReelVaultWifiModule: Module {
  private var listener: NWListener?
  private var sessions: [ObjectIdentifier: UploadSession] = [:]
  fileprivate var code = ""
  fileprivate let queue = DispatchQueue(label: "app.reelvault.wifi")

  public func definition() -> ModuleDefinition {
    Name("ReelVaultWifi")

    Events("onFileStart", "onFileProgress", "onFileDone", "onFileError")

    AsyncFunction("start") { (code: String, promise: Promise) in
      self.queue.async {
        self.stopListener()
        self.code = code
        self.startListener(port: 8080, promise: promise, fallback: true)
      }
    }

    Function("stop") {
      self.queue.async { self.stopListener() }
    }

    /// True when the phone is on Wi-Fi (en0 has an address), for "download on Wi-Fi only".
    Function("onWifi") { () -> Bool in
      var ifaddr: UnsafeMutablePointer<ifaddrs>?
      guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return false }
      defer { freeifaddrs(ifaddr) }
      for ptr in sequence(first: first, next: { $0.pointee.ifa_next }) {
        let iface = ptr.pointee
        guard let sa = iface.ifa_addr, sa.pointee.sa_family == UInt8(AF_INET) else { continue }
        if String(cString: iface.ifa_name) == "en0" && (iface.ifa_flags & UInt32(IFF_UP)) != 0 { return true }
      }
      return false
    }

    OnDestroy {
      self.queue.async { self.stopListener() }
    }
  }

  /// Tries port 8080 first (easy to type), then any free port.
  private func startListener(port: UInt16, promise: Promise, fallback: Bool) {
    let params = NWParameters.tcp
    params.allowLocalEndpointReuse = true
    let nwPort: NWEndpoint.Port = port == 0 ? .any : (NWEndpoint.Port(rawValue: port) ?? .any)
    let listener: NWListener
    do {
      listener = try NWListener(using: params, on: nwPort)
    } catch {
      if fallback {
        startListener(port: 0, promise: promise, fallback: false)
      } else {
        promise.reject("ERR_WIFI", "The Wi-Fi server could not start: \(error.localizedDescription)")
      }
      return
    }
    // A box, not a var: the state handler may run as a @Sendable closure.
    let settled = Once()
    listener.newConnectionHandler = { [weak self] connection in
      self?.accept(connection)
    }
    listener.stateUpdateHandler = { [weak self] state in
      guard let self = self else { return }
      switch state {
      case .ready:
        if settled.done { return }
        settled.done = true
        let p = listener.port?.rawValue ?? port
        let url = Self.wifiAddress().map { "http://\($0):\(p)" } ?? ""
        DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = true }
        promise.resolve(["url": url])
      case .failed(let error):
        listener.cancel()
        if self.listener === listener { self.listener = nil }
        if settled.done { return }
        settled.done = true
        if fallback {
          self.startListener(port: 0, promise: promise, fallback: false)
        } else {
          promise.reject("ERR_WIFI", "The Wi-Fi server could not start: \(error.localizedDescription)")
        }
      default:
        break
      }
    }
    self.listener = listener
    listener.start(queue: queue)
  }

  fileprivate func stopListener() {
    listener?.cancel()
    listener = nil
    for s in sessions.values { s.cancel() }
    sessions.removeAll()
    DispatchQueue.main.async { UIApplication.shared.isIdleTimerDisabled = false }
  }

  private func accept(_ connection: NWConnection) {
    let session = UploadSession(connection: connection, module: self)
    sessions[ObjectIdentifier(session)] = session
    session.start()
  }

  fileprivate func finished(_ session: UploadSession) {
    sessions.removeValue(forKey: ObjectIdentifier(session))
  }

  fileprivate func emit(_ name: String, _ body: [String: Any]) {
    sendEvent(name, body)
  }

  /// The phone's Wi-Fi IPv4 address (en0), or another local one.
  static func wifiAddress() -> String? {
    var fallback: String?
    var ifaddr: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return nil }
    defer { freeifaddrs(ifaddr) }
    for ptr in sequence(first: first, next: { $0.pointee.ifa_next }) {
      let iface = ptr.pointee
      guard let sa = iface.ifa_addr, sa.pointee.sa_family == UInt8(AF_INET) else { continue }
      let name = String(cString: iface.ifa_name)
      guard name.hasPrefix("en") else { continue }
      var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
      if getnameinfo(sa, socklen_t(sa.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
        let ip = String(cString: host)
        if name == "en0" { return ip }
        if fallback == nil { fallback = ip }
      }
    }
    return fallback
  }

  /// Free space for big files, in bytes.
  static func freeBytes() -> Int64? {
    let url = URL(fileURLWithPath: NSHomeDirectory())
    return (try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]))?.volumeAvailableCapacityForImportantUsage
  }
}

fileprivate final class Once {
  var done = false
}

/// One HTTP connection: the upload page, the code check, or one file upload.
fileprivate final class UploadSession {
  let connection: NWConnection
  weak var module: ReelVaultWifiModule?
  private let queue: DispatchQueue

  private var buffer = Data()
  private var headersDone = false
  private var method = ""
  private var path = "/"
  private var query: [String: String] = [:]
  private var headers: [String: String] = [:]

  private var expected = 0
  private var received = 0
  private var lastReport = 0
  private var handle: FileHandle?
  private var fileURL: URL?
  private var name = ""
  private let id = UUID().uuidString

  private var responded = false
  private var cleaned = false

  init(connection: NWConnection, module: ReelVaultWifiModule) {
    self.connection = connection
    self.module = module
    self.queue = module.queue
  }

  func start() {
    connection.stateUpdateHandler = { [weak self] state in
      switch state {
      case .failed, .cancelled:
        self?.cleanup()
      default:
        break
      }
    }
    connection.start(queue: queue)
    receive()
  }

  func cancel() {
    connection.cancel()
  }

  private func receive() {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 1 << 20) { [weak self] data, _, isComplete, error in
      guard let self = self else { return }
      if let data = data, !data.isEmpty { self.consume(data) }
      if error != nil || isComplete {
        if !self.responded { self.connection.cancel() }
        return
      }
      if !self.responded { self.receive() }
    }
  }

  private func consume(_ data: Data) {
    if responded { return }
    if headersDone {
      write(data)
      return
    }
    buffer.append(data)
    guard let range = buffer.range(of: Data("\r\n\r\n".utf8)) else {
      if buffer.count > 64 * 1024 { respond(431, "text/plain", "Request headers too large") }
      return
    }
    let head = String(decoding: buffer.subdata(in: buffer.startIndex..<range.lowerBound), as: UTF8.self)
    let rest = buffer.subdata(in: range.upperBound..<buffer.endIndex)
    buffer = Data()
    headersDone = true
    parseHead(head)
    route(rest)
  }

  private func parseHead(_ head: String) {
    let lines = head.components(separatedBy: "\r\n")
    let parts = (lines.first ?? "").split(separator: " ")
    method = parts.count > 0 ? String(parts[0]) : ""
    let target = parts.count > 1 ? String(parts[1]) : "/"
    let comps = URLComponents(string: "http://phone" + target)
    path = comps?.path ?? "/"
    for item in comps?.queryItems ?? [] { query[item.name] = item.value ?? "" }
    for line in lines.dropFirst() {
      guard let i = line.firstIndex(of: ":") else { continue }
      headers[line[..<i].lowercased()] = line[line.index(after: i)...].trimmingCharacters(in: .whitespaces)
    }
  }

  private func route(_ body: Data) {
    let codeOK = !(module?.code.isEmpty ?? true) && query["code"] == module?.code
    switch (method, path) {
    case ("GET", "/"), ("GET", "/index.html"):
      respond(200, "text/html; charset=utf-8", uploadPage)
    case ("GET", "/check"):
      respond(codeOK ? 200 : 403, "application/json", codeOK ? "{\"ok\":true}" : "{\"ok\":false}")
    case ("POST", "/upload"):
      guard codeOK else {
        respond(403, "text/plain", "Wrong code. Look at the code on the phone.")
        return
      }
      guard let len = Int(headers["content-length"] ?? ""), len > 0 else {
        respond(411, "text/plain", "The browser did not say how big the file is.")
        return
      }
      if let free = ReelVaultWifiModule.freeBytes(), Int64(len) > free - 500_000_000 {
        respond(507, "text/plain", "Not enough free space on the phone for this video.")
        return
      }
      name = Self.safeName(query["name"] ?? "video.mov")
      expected = len
      let dir = FileManager.default.temporaryDirectory.appendingPathComponent("wifi", isDirectory: true)
      try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      let url = dir.appendingPathComponent("\(id)-\(name)")
      FileManager.default.createFile(atPath: url.path, contents: nil)
      guard let h = try? FileHandle(forWritingTo: url) else {
        respond(500, "text/plain", "The phone could not save the file.")
        return
      }
      handle = h
      fileURL = url
      module?.emit("onFileStart", ["id": id, "name": name, "total": len])
      if !body.isEmpty { write(body) }
    default:
      respond(404, "text/plain", "Not found")
    }
  }

  private func write(_ data: Data) {
    guard let h = handle else { return }
    let take = min(data.count, expected - received)
    if take <= 0 { return }
    do {
      try h.write(contentsOf: take == data.count ? data : data.prefix(take))
    } catch {
      respond(500, "text/plain", "The phone could not save the file.")
      connection.cancel()
      return
    }
    received += take
    if received - lastReport >= 2_000_000 || received >= expected {
      lastReport = received
      module?.emit("onFileProgress", ["id": id, "name": name, "received": received, "total": expected])
    }
    if received >= expected {
      try? h.close()
      handle = nil
      if let u = fileURL {
        module?.emit("onFileDone", ["id": id, "name": name, "path": u.absoluteString, "total": expected])
      }
      // The file now belongs to JavaScript, which moves it into the vault.
      fileURL = nil
      respond(200, "application/json", "{\"ok\":true}")
    }
  }

  private func respond(_ status: Int, _ type: String, _ text: String) {
    if responded { return }
    responded = true
    let reasons = [200: "OK", 403: "Forbidden", 404: "Not Found", 411: "Length Required", 431: "Request Header Fields Too Large", 500: "Internal Server Error", 507: "Insufficient Storage"]
    let body = Data(text.utf8)
    let head = "HTTP/1.1 \(status) \(reasons[status] ?? "OK")\r\nContent-Type: \(type)\r\nContent-Length: \(body.count)\r\nConnection: close\r\nCache-Control: no-store\r\n\r\n"
    var out = Data(head.utf8)
    out.append(body)
    connection.send(content: out, completion: .contentProcessed { [weak self] _ in
      self?.connection.cancel()
    })
  }

  private func cleanup() {
    if cleaned { return }
    cleaned = true
    if let h = handle {
      try? h.close()
      handle = nil
      if let u = fileURL { try? FileManager.default.removeItem(at: u) }
      fileURL = nil
      module?.emit("onFileError", ["id": id, "name": name, "reason": "The upload stopped before the end."])
    }
    module?.finished(self)
  }

  static func safeName(_ raw: String) -> String {
    let base = (raw as NSString).lastPathComponent
    let cleaned = base.replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: ":", with: "_")
    let trimmed = String(cleaned.prefix(120))
    return trimmed.isEmpty ? "video.mov" : trimmed
  }
}

/// The page the computer sees. Plain HTML and JavaScript, no outside files.
fileprivate let uploadPage = #"""
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ReelVault Wi-Fi transfer</title>
<style>
  :root { color-scheme: dark; --bg:#0b0b10; --card:#17171f; --line:#2a2a36; --text:#f5f5f7; --soft:#a1a1aa; --accent:#0a84ff; --good:#30d158; --bad:#ff453a; }
  * { box-sizing: border-box; }
  body { margin:0; font: 15px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: radial-gradient(1200px 600px at 20% -10%, #1d2a6b 0%, transparent 60%), radial-gradient(900px 500px at 110% 10%, #5a1d6b 0%, transparent 55%), var(--bg); color: var(--text); min-height: 100vh; }
  main { max-width: 720px; margin: 0 auto; padding: 48px 20px 80px; }
  h1 { font-size: 34px; letter-spacing: -0.8px; margin: 0 0 6px; }
  p { color: var(--soft); margin: 0 0 22px; }
  .card { background: rgba(23,23,31,0.85); border: 1px solid var(--line); border-radius: 20px; padding: 22px; backdrop-filter: blur(10px); }
  .code { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
  .code input { font-size: 28px; letter-spacing: 12px; width: 190px; text-align: center; padding: 10px 12px; border-radius: 14px; border: 1px solid var(--line); background: #0f0f15; color: var(--text); }
  button { font: inherit; font-weight: 700; border: 0; border-radius: 999px; padding: 12px 20px; background: var(--accent); color: #fff; cursor: pointer; }
  #drop { margin-top: 18px; border: 2px dashed #3a3a4a; border-radius: 18px; padding: 44px 16px; text-align: center; transition: .2s; cursor: pointer; }
  #drop.over { border-color: var(--accent); background: rgba(10,132,255,0.08); }
  #drop strong { display: block; font-size: 19px; margin-bottom: 6px; }
  .hidden { display: none; }
  ul { list-style: none; padding: 0; margin: 18px 0 0; display: grid; gap: 10px; }
  li { background: #101017; border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; }
  .row { display: flex; justify-content: space-between; gap: 12px; font-weight: 600; }
  .row span:last-child { color: var(--soft); font-weight: 500; white-space: nowrap; }
  .bar { height: 6px; background: #22222c; border-radius: 6px; margin-top: 8px; overflow: hidden; }
  .bar i { display: block; height: 100%; width: 0; background: linear-gradient(90deg, #0a84ff, #bf5af2); transition: width .2s; }
  .done .bar i { background: var(--good); }
  .err .bar i { background: var(--bad); width: 100% !important; }
  .msg { color: var(--bad); margin-top: 10px; min-height: 1em; }
  footer { color: var(--soft); font-size: 13px; margin-top: 20px; }
</style>
</head>
<body>
<main>
  <h1>ReelVault</h1>
  <p>Send videos from this computer to your iPhone over Wi-Fi. Keep the Wi-Fi screen open on the phone while they go.</p>
  <div class="card">
    <div id="gate">
      <div class="code">
        <input id="code" inputmode="numeric" maxlength="4" placeholder="0000" autofocus>
        <button id="go">Connect</button>
      </div>
      <div class="msg" id="gateMsg"></div>
      <footer>Type the 4-digit code shown on the phone.</footer>
    </div>
    <div id="up" class="hidden">
      <div id="drop"><strong>Drop videos here</strong>or click to choose files (MOV, MP4, M4V…)</div>
      <input id="file" type="file" accept="video/*,.mov,.mp4,.m4v,.mkv,.avi,.webm,.3gp,.mts" multiple class="hidden">
      <ul id="list"></ul>
      <footer id="sum"></footer>
    </div>
  </div>
</main>
<script>
  let code = sessionStorage.getItem('rv-code') || '';
  const $ = (id) => document.getElementById(id);
  const fmt = (b) => b > 1e9 ? (b / 1e9).toFixed(2) + ' GB' : (b / 1e6).toFixed(1) + ' MB';
  const queue = [];
  let busy = false, sent = 0;
  async function check(c) {
    try { const r = await fetch('/check?code=' + encodeURIComponent(c)); return r.ok; } catch (e) { return false; }
  }
  async function connect() {
    const c = $('code').value.trim();
    if (await check(c)) { code = c; sessionStorage.setItem('rv-code', c); $('gate').classList.add('hidden'); $('up').classList.remove('hidden'); }
    else $('gateMsg').textContent = 'That code is not right, or the Wi-Fi screen on the phone was closed.';
  }
  $('go').onclick = connect;
  $('code').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
  if (code) check(code).then((ok) => { if (ok) { $('code').value = code; connect(); } });
  const drop = $('drop');
  drop.onclick = () => $('file').click();
  $('file').onchange = (e) => add(e.target.files);
  ['dragenter', 'dragover'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((t) => drop.addEventListener(t, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => add(e.dataTransfer.files));
  function add(files) {
    for (const f of files) {
      const li = document.createElement('li');
      li.innerHTML = '<div class="row"><span></span><span>Waiting</span></div><div class="bar"><i></i></div>';
      li.querySelector('.row span').textContent = f.name;
      $('list').appendChild(li);
      queue.push({ f, li });
    }
    next();
  }
  function next() {
    if (busy || !queue.length) return;
    busy = true;
    const { f, li } = queue.shift();
    const state = li.querySelector('.row span:last-child');
    const bar = li.querySelector('.bar i');
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/upload?code=' + encodeURIComponent(code) + '&name=' + encodeURIComponent(f.name));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) { bar.style.width = (e.loaded / e.total * 100) + '%'; state.textContent = fmt(e.loaded) + ' of ' + fmt(e.total); } };
    xhr.onload = () => {
      if (xhr.status === 200) { li.classList.add('done'); bar.style.width = '100%'; state.textContent = 'Sent ✓'; sent++; }
      else { li.classList.add('err'); state.textContent = xhr.responseText || ('Error ' + xhr.status); }
      $('sum').textContent = sent + ' sent. The phone adds each one to your vault.';
      busy = false; next();
    };
    xhr.onerror = () => { li.classList.add('err'); state.textContent = 'Lost the connection'; busy = false; next(); };
    xhr.send(f);
  }
</script>
</body>
</html>
"""#
