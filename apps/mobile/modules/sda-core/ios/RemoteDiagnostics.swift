import Foundation

final class RemoteDiagnostics: NSObject, URLSessionTaskDelegate {
 private let queue = DispatchQueue(label:"sda.diagnostics",qos:.utility)
 private lazy var session: URLSession = {
  let config = URLSessionConfiguration.ephemeral
  config.timeoutIntervalForRequest = 3; config.timeoutIntervalForResource = 4
  config.urlCache = nil; config.httpShouldSetCookies = false
  return URLSession(configuration:config,delegate:self,delegateQueue:nil)
 }()
 private var timer: DispatchSourceTimer?
 private var task: URLSessionDataTask?
 private var epoch = 0
 private let statusLock = NSLock()
 private var detail = "已关闭"
 func urlSession(_ session:URLSession,task:URLSessionTask,willPerformHTTPRedirection response:HTTPURLResponse,newRequest request:URLRequest,completionHandler:@escaping (URLRequest?) -> Void) {
  completionHandler(nil)
 }
 var status: String { statusLock.lock(); defer { statusLock.unlock() }; return detail }
 private func setStatus(_ text:String) { statusLock.lock(); detail=text; statusLock.unlock() }
 static func endpoint(_ text:String) throws -> URL? {
  if text.isEmpty { return nil }
  guard let url=URL(string:text), ["http","https"].contains(url.scheme ?? ""),
    let host=url.host, url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
    host == "localhost" ||
    host.hasSuffix(".ts.net") || {
     let parts=host.split(separator:".").compactMap { Int($0) }
     guard parts.count == 4, parts.allSatisfy({ (0...255).contains($0) }) else { return false }
     return parts[0] == 10 || (parts[0] == 192 && parts[1] == 168) ||
       (parts[0] == 172 && (16...31).contains(parts[1])) ||
       (parts[0] == 100 && (64...127).contains(parts[1]))
    }() else { throw SdaError.message("请填写局域网或 Tailscale HTTP/HTTPS 地址") }
  return url
 }
 func configure(enabled:Bool, urls:[URL], token:String, snapshot:@escaping () -> [String:Any]) {
  queue.async {
   self.epoch += 1; let epoch=self.epoch
   self.timer?.cancel(); self.timer=nil; self.task?.cancel(); self.task=nil
   guard enabled else { self.setStatus("已关闭"); return }
   self.setStatus("等待发送")
   let timer=DispatchSource.makeTimerSource(queue:self.queue)
   timer.schedule(deadline:.now(),repeating:1)
   timer.setEventHandler { [weak self] in
    guard let self, self.task == nil, self.epoch == epoch,
      let body=try? JSONSerialization.data(withJSONObject:snapshot()) else { return }
    self.send(body,urls:urls,index:0,token:token,epoch:epoch)
   }
   self.timer=timer; timer.resume()
  }
 }
 private func send(_ body:Data,urls:[URL],index:Int,token:String,epoch:Int) {
  guard epoch == self.epoch, index < urls.count else { return }
  var request=URLRequest(url:urls[index]); request.httpMethod="POST"; request.httpBody=body
  request.setValue("application/json",forHTTPHeaderField:"Content-Type")
  request.setValue("Bearer "+token,forHTTPHeaderField:"Authorization")
  task=session.dataTask(with:request) { [weak self] _, response, error in
   guard let self else { return }
   self.queue.async {
    guard self.epoch == epoch else { return }; self.task=nil
    if error == nil, let http=response as? HTTPURLResponse, (200...299).contains(http.statusCode) {
     self.setStatus("已发送 · "+(urls[index].host ?? ""))
    } else if index+1 < urls.count { self.send(body,urls:urls,index:index+1,token:token,epoch:epoch) }
    else { self.setStatus("发送失败 · 请检查地址、令牌和网络") }
   }
  }
  task?.resume()
 }
}

extension SdaPlayer {
 func configureDiagnostics(_ enabled:Bool,_ lan:String,_ tail:String,_ token:String) throws {
  let urls=try [lan,tail].compactMap { try RemoteDiagnostics.endpoint($0) }
  guard !enabled || (!urls.isEmpty && token.count >= 16) else { throw SdaError.message("请填写接收地址和至少 16 位访问令牌") }
  prefs.set(enabled,forKey:"sda.diagnostics.enabled")
  prefs.set(lan,forKey:"sda.diagnostics.lan"); prefs.set(tail,forKey:"sda.diagnostics.tail")
  prefs.set(token,forKey:"sda.diagnostics.token")
  diagnostics.configure(enabled:enabled,urls:urls,token:token) { [weak self] in
   guard let self else { return [:] }
   return self.locked {
    let status=(self.hasPlayback ? (try? self.command("status")) as? [String:Any] : nil) ?? [:]
    var playback:[String:Any]=[:]
    for key in ["positionMs","fifoFrames","decodedSamplePos","consumedSamplePos","sourceCodec","outputChannels","outputLayout","underruns"] {
     playback[key]=status[key]
    }
    return ["schema":1,"time":Date().timeIntervalSince1970,"playback":playback,
     "playing":self.hasPlayback && !self.done,"paused":self.isPaused,"background":self.inBackground,
     "generation":self.generation,"route":self.systemSpatial == nil ? "KU100" : "Apple",
     "tracking":self.headTrackingDetail,"motion":self.diagnosticMotion,
     "backgroundTrackingExperiment":self.prefs.bool(forKey:"sda.headTrackingBackgroundExperiment"),
     "error":self.failure == nil ? "" : "playback-error",
     "events":self.playbackEvents.suffix(16).map { ["time":$0["time"] ?? 0,"event":$0["event"] ?? "","generation":$0["generation"] ?? 0] }]
   }
  }
 }
}
