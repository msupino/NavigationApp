import UIKit
import Capacitor
import Foundation
import Darwin
import CoreFoundation
import CoreMotion
import CoreLocation
import WebKit

@objc(XPlaneDiscoveryPlugin)
public class XPlaneDiscoveryPlugin: CAPPlugin, CAPBridgedPlugin {
    private static let maximumBridgeResponseBytes = 65_536
    public let identifier = "XPlaneDiscoveryPlugin"
    public let jsName = "XPlaneDiscovery"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "discover", returnType: CAPPluginReturnPromise)
    ]
    private var discoveryTask: Task<Void, Never>?

    private enum DiscoveryError: Error {
        case noWifi
        case subnetTooLarge
        case networkDenied
    }

    private enum ProbeResult {
        case found(String)
        case unavailable
        case networkDenied
    }

    @objc func discover(_ call: CAPPluginCall) {
        guard isTrustedProductionPage() else {
            call.reject("X-Plane discovery is available only on production NavAid", "UNTRUSTED_ORIGIN")
            return
        }
        discoveryTask?.cancel()
        discoveryTask = Task {
            do {
                if let found = try await findBridge() {
                    call.resolve([
                        "found": true,
                        "host": found,
                        "name": "X-Plane",
                        "bridgeUrl": "http://\(found):2020",
                        "source": "local-bridge-scan"
                    ])
                } else {
                    call.resolve(["found": false])
                }
            } catch DiscoveryError.noWifi {
                call.reject("Wi-Fi is unavailable", "NO_WIFI")
            } catch DiscoveryError.subnetTooLarge {
                call.reject("The Wi-Fi subnet is too large to scan safely", "SUBNET_TOO_LARGE")
            } catch DiscoveryError.networkDenied {
                call.reject("Local Network access is denied or unavailable", "LOCAL_NETWORK_DENIED")
            } catch {
                call.reject("X-Plane discovery failed", nil, error)
            }
        }
    }

    private func isTrustedProductionPage() -> Bool {
        guard let url = bridge?.webView?.url else { return false }
        return Self.isTrustedAppURL(url)
    }

    static func isTrustedAppURL(_ url: URL) -> Bool {
        guard url.port == nil, url.user == nil, url.password == nil else { return false }
        if url.scheme == "capacitor" && url.host == "localhost" {
            return url.path.isEmpty || url.path == "/" || url.path == "/index.html"
        }
        return url.scheme == "https" && url.host == "navaid.supino.org" &&
            (url.path.isEmpty || url.path == "/")
    }

    private func findBridge() async throws -> String? {
        guard let network = wifiNetwork() else { throw DiscoveryError.noWifi }
        let wildcard = ~network.mask
        guard wildcard > 1 else { return nil }
        guard wildcard <= 1_023 else { throw DiscoveryError.subnetTooLarge }
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 0.7
        config.timeoutIntervalForResource = config.timeoutIntervalForRequest
        config.waitsForConnectivity = false
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }

        let first = (network.address & network.mask) + 1
        let last = (network.address & network.mask) + wildcard - 1
        let candidates = (first...last).filter { $0 != network.address }
        var denied = false
        for start in stride(from: 0, to: candidates.count, by: 64) {
            if Task.isCancelled { return nil }
            let end = min(start + 64, candidates.count)
            let batch = await withTaskGroup(of: ProbeResult.self,
                                            returning: (String?, Bool).self, body: { group in
                for address in candidates[start..<end] {
                    guard let host = self.ipv4String(address) else { continue }
                    group.addTask { await self.probeBridge(host: host, session: session) }
                }
                var sawDenied = false
                for await result in group {
                    switch result {
                    case .found(let host):
                        group.cancelAll()
                        return (host, sawDenied)
                    case .networkDenied:
                        sawDenied = true
                    case .unavailable:
                        break
                    }
                }
                return (nil, sawDenied)
            })
            if let host = batch.0 { return host }
            denied = denied || batch.1
        }
        if denied { throw DiscoveryError.networkDenied }
        return nil
    }

    private func probeBridge(host: String, session: URLSession) async -> ProbeResult {
        guard let url = URL(string: "http://\(host):2020") else { return .unavailable }
        do {
            let (bytes, response) = try await session.bytes(from: url)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                  http.expectedContentLength <= Self.maximumBridgeResponseBytes else {
                return .unavailable
            }
            var data = Data()
            data.reserveCapacity(min(max(Int(http.expectedContentLength), 0),
                                     Self.maximumBridgeResponseBytes))
            for try await byte in bytes {
                guard data.count < Self.maximumBridgeResponseBytes else { return .unavailable }
                data.append(byte)
            }
            guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  validCoordinates(json) else { return .unavailable }
            return .found(host)
        } catch let error as URLError where error.code == .notConnectedToInternet ||
                                              error.code == .dataNotAllowed {
            return .networkDenied
        } catch {
            return .unavailable
        }
    }

    private func validCoordinates(_ json: [String: Any]) -> Bool {
        guard let latitude = json["latitude"] as? NSNumber,
              let longitude = json["longitude"] as? NSNumber,
              CFGetTypeID(latitude) != CFBooleanGetTypeID(),
              CFGetTypeID(longitude) != CFBooleanGetTypeID() else { return false }
        let lat = latitude.doubleValue
        let lng = longitude.doubleValue
        return lat.isFinite && lng.isFinite && (-90...90).contains(lat) &&
            (-180...180).contains(lng)
    }

    private func wifiNetwork() -> (address: UInt32, mask: UInt32)? {
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return nil }
        defer { freeifaddrs(list) }
        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let item = cursor {
            let interface = item.pointee
            if let addressPointer = interface.ifa_addr,
               let maskPointer = interface.ifa_netmask,
               addressPointer.pointee.sa_family == UInt8(AF_INET),
               String(cString: interface.ifa_name) == "en0" {
                let address = addressPointer.withMemoryRebound(to: sockaddr_in.self, capacity: 1) {
                    UInt32(bigEndian: $0.pointee.sin_addr.s_addr)
                }
                let mask = maskPointer.withMemoryRebound(to: sockaddr_in.self, capacity: 1) {
                    UInt32(bigEndian: $0.pointee.sin_addr.s_addr)
                }
                return (address, mask)
            }
            cursor = interface.ifa_next
        }
        return nil
    }

    private func ipv4String(_ value: UInt32) -> String? {
        var address = in_addr(s_addr: value.bigEndian)
        var buffer = [CChar](repeating: 0, count: Int(INET_ADDRSTRLEN))
        guard inet_ntop(AF_INET, &address, &buffer, socklen_t(buffer.count)) != nil else { return nil }
        return String(cString: buffer)
    }

    deinit {
        discoveryTask?.cancel()
    }
}

// The iPhone/iPad pressure sensor, for the barometric readouts in docs/app/device-extras.js
// (pressure altitude, vertical speed). Same contract as the Android BarometerPlugin: isAvailable,
// start, stop, and a "pressure" event { hPa, t } about once a second. CMAltimeter reports kPa.
@objc(BarometerPlugin)
public class BarometerPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "BarometerPlugin"
    public let jsName = "Barometer"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]
    private let altimeter = CMAltimeter()
    private var running = false

    @objc func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": CMAltimeter.isRelativeAltitudeAvailable()])
    }

    @objc func start(_ call: CAPPluginCall) {
        guard CMAltimeter.isRelativeAltitudeAvailable() else {
            call.reject("No pressure sensor", "UNAVAILABLE"); return
        }
        if !running {
            running = true
            altimeter.startRelativeAltitudeUpdates(to: OperationQueue.main) { [weak self] data, _ in
                guard let self = self, let d = data else { return }
                self.notifyListeners("pressure", data: [
                    "hPa": d.pressure.doubleValue * 10.0,
                    "t": Date().timeIntervalSince1970 * 1000.0
                ])
            }
        }
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) {
        halt(); call.resolve()
    }

    private func halt() {
        if running { altimeter.stopRelativeAltitudeUpdates() }
        running = false
    }

    deinit { halt() }
}

// What iOS tells about a fix beyond the web Geolocation API, for the GPS details panel
// (docs/app/gps-status.js). iOS gives no satellite data to any app; this is what it does give:
// speed and course accuracy, and whether the fix comes from an external receiver (a Bluetooth
// GPS paired with the iPhone/iPad). A "quality" event per fix while started.
@objc(LocationQualityPlugin)
public class LocationQualityPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "LocationQualityPlugin"
    public let jsName = "LocationQuality"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]
    private var manager: CLLocationManager?

    @objc func start(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if self.manager == nil {
                let m = CLLocationManager()
                m.delegate = self
                m.desiredAccuracy = kCLLocationAccuracyBestForNavigation
                self.manager = m
            }
            // Location permission is the page's own (navigator.geolocation asked for it);
            // without it this sends nothing, and the panel simply shows less.
            self.manager?.startUpdatingLocation()
            call.resolve()
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.manager?.stopUpdatingLocation()
            call.resolve()
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let l = locations.last else { return }
        var o: [String: Any] = ["t": l.timestamp.timeIntervalSince1970 * 1000.0]
        if l.speedAccuracy >= 0 { o["speedAcc"] = l.speedAccuracy }
        if l.courseAccuracy >= 0 { o["courseAcc"] = l.courseAccuracy }
        if l.verticalAccuracy >= 0 { o["ellAlt"] = l.ellipsoidalAltitude }
        if #available(iOS 15.0, *), let info = l.sourceInformation {
            o["external"] = info.isProducedByAccessory
            o["simulated"] = info.isSimulatedBySoftware
        }
        notifyListeners("quality", data: o)
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { /* nothing to show */ }
}

// ADS-B traffic from a Wi-Fi receiver (Stratux, SkyEcho and the like), for docs/app/gdl90.js.
// Same contract as the Android Gdl90Plugin: start({ port }) listens on UDP (4000 by default),
// each datagram goes to the page as a "packet" event { data: base64 }, stop() closes it.
// Receivers that send to this device's address arrive as they are; iOS hands broadcast
// datagrams to apps only with Apple's multicast entitlement, which this build does not hold.
@objc(Gdl90Plugin)
public class Gdl90Plugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "Gdl90Plugin"
    public let jsName = "Gdl90"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise)
    ]
    private let lock = NSLock()
    private var fd: Int32 = -1

    @objc func start(_ call: CAPPluginCall) {
        let port = UInt16(call.getInt("port") ?? 4000)
        lock.lock(); let running = fd >= 0; lock.unlock()
        if running { call.resolve(); return }
        let s = socket(AF_INET, SOCK_DGRAM, IPPROTO_UDP)
        guard s >= 0 else { call.reject("Cannot open a UDP socket", "UNAVAILABLE"); return }
        var one: Int32 = 1
        setsockopt(s, SOL_SOCKET, SO_REUSEADDR, &one, socklen_t(MemoryLayout<Int32>.size))
        setsockopt(s, SOL_SOCKET, SO_REUSEPORT, &one, socklen_t(MemoryLayout<Int32>.size))
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = port.bigEndian
        addr.sin_addr = in_addr(s_addr: INADDR_ANY)
        let bound = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(s, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        guard bound == 0 else {
            close(s); call.reject("Cannot listen on UDP \(port)", "UNAVAILABLE"); return
        }
        lock.lock(); fd = s; lock.unlock()
        Thread.detachNewThread { [weak self] in
            var buf = [UInt8](repeating: 0, count: 2048)
            while true {
                let n = recv(s, &buf, buf.count, 0)
                guard let self = self else { break }
                self.lock.lock(); let current = self.fd; self.lock.unlock()
                if current != s || n <= 0 { break }
                self.notifyListeners("packet", data: ["data": Data(buf[0..<n]).base64EncodedString()])
            }
        }
        call.resolve()
    }

    @objc func stop(_ call: CAPPluginCall) { halt(); call.resolve() }

    private func halt() {
        lock.lock(); let s = fd; fd = -1; lock.unlock()
        if s >= 0 { shutdown(s, SHUT_RDWR); close(s) }
    }

    deinit { halt() }
}

// The system print sheet, for docs/app/native-print.js. Same contract as the Android
// NavAidPrintPlugin: printPage() prints the app's own page with its print styles,
// printHtml({ html }) prints a page of the app's making (its images are files in the app's
// cache), and "printFinished" goes back to the page when the sheet is done, printed or not.
@objc(NavAidPrintPlugin)
public class NavAidPrintPlugin: CAPPlugin, CAPBridgedPlugin, WKNavigationDelegate {
    public let identifier = "NavAidPrintPlugin"
    public let jsName = "NavAidPrint"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "printPage", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "printHtml", returnType: CAPPluginReturnPromise)
    ]
    // Held while its job runs: a web view nothing refers to is released mid-print.
    private var printView: WKWebView?
    private var printName = "NavAid"

    @objc func printPage(_ call: CAPPluginCall) {
        let name = call.getString("name") ?? "NavAid"
        DispatchQueue.main.async {
            guard let web = self.bridge?.webView else { call.reject("Could not print"); return }
            self.present(web.viewPrintFormatter(), name: name)
            call.resolve()
        }
    }

    @objc func printHtml(_ call: CAPPluginCall) {
        guard let html = call.getString("html") else { call.reject("No page to print"); return }
        printName = call.getString("name") ?? "NavAid"
        DispatchQueue.main.async {
            do {
                // Written beside the images, so the page may read them (file:// in Caches).
                let caches = try FileManager.default.url(for: .cachesDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
                let dir = caches.appendingPathComponent("print", isDirectory: true)
                try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
                let file = dir.appendingPathComponent("navaid-print.html")
                try html.write(to: file, atomically: true, encoding: .utf8)
                let view = WKWebView(frame: CGRect(x: 0, y: 0, width: 800, height: 1100))
                view.navigationDelegate = self
                self.printView = view
                view.loadFileURL(file, allowingReadAccessTo: caches)
                call.resolve()
            } catch {
                call.reject("Could not print", nil, error)
            }
        }
    }

    public func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard webView === printView else { return }
        present(webView.viewPrintFormatter(), name: printName)
    }

    public func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { finished() }

    private func present(_ formatter: UIPrintFormatter, name: String) {
        let pc = UIPrintInteractionController.shared
        let info = UIPrintInfo(dictionary: nil)
        info.jobName = name
        info.outputType = .general
        pc.printInfo = info
        pc.printFormatter = formatter
        let done: UIPrintInteractionController.CompletionHandler = { [weak self] _, _, _ in self?.finished() }
        if UIDevice.current.userInterfaceIdiom == .pad, let view = bridge?.viewController?.view {
            // On iPad the sheet is a popover and needs somewhere to point: the middle of the screen.
            pc.present(from: CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1), in: view, animated: true, completionHandler: done)
        } else {
            pc.present(animated: true, completionHandler: done)
        }
    }

    private func finished() {
        printView = nil
        notifyListeners("printFinished", data: [:])
    }
}

// Position with the screen locked, for docs/app/gps.js -- what the community
// background-geolocation plugin does on Android (its Swift package pins Capacitor 7, so it is
// not in the iOS build). Same name and contract: addWatcher(options, callback) returns the
// watcher id and calls back with { latitude, longitude, accuracy, altitude, altitudeAccuracy,
// speed, bearing, time } per fix; removeWatcher({ id }) ends it. Started while the app is in
// use, iOS keeps it running in the background (UIBackgroundModes: location) and shows the
// blue location indicator, so "While Using the App" permission is enough.
@objc(BackgroundGeolocationPlugin)
public class BackgroundGeolocationPlugin: CAPPlugin, CAPBridgedPlugin, CLLocationManagerDelegate {
    public let identifier = "BackgroundGeolocationPlugin"
    public let jsName = "BackgroundGeolocation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "addWatcher", returnType: CAPPluginReturnCallback),
        CAPPluginMethod(name: "removeWatcher", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]
    private var manager: CLLocationManager?
    private var watchers: [String: CAPPluginCall] = [:]

    @objc func addWatcher(_ call: CAPPluginCall) {
        call.keepAlive = true
        DispatchQueue.main.async {
            self.watchers[call.callbackId] = call
            let m = self.manager ?? CLLocationManager()
            if self.manager == nil {
                m.delegate = self
                m.desiredAccuracy = kCLLocationAccuracyBestForNavigation
                m.distanceFilter = kCLDistanceFilterNone
                m.activityType = .airborne
                m.pausesLocationUpdatesAutomatically = false
                m.allowsBackgroundLocationUpdates = true
                m.showsBackgroundLocationIndicator = true
                self.manager = m
            }
            switch m.authorizationStatus {
            case .notDetermined:
                if call.getBool("requestPermissions") ?? true { m.requestWhenInUseAuthorization() }
            case .denied, .restricted:
                self.watchers[call.callbackId] = nil
                call.reject("Permission denied.", "NOT_AUTHORIZED")
                self.bridge?.releaseCall(call)
                return
            default: break
            }
            m.startUpdatingLocation()
        }
    }

    @objc func removeWatcher(_ call: CAPPluginCall) {
        let id = call.getString("id") ?? ""
        DispatchQueue.main.async {
            if let w = self.watchers.removeValue(forKey: id) { self.bridge?.releaseCall(w) }
            if self.watchers.isEmpty { self.manager?.stopUpdatingLocation() }
            call.resolve()
        }
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
            call.resolve()
        }
    }

    public func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let st = manager.authorizationStatus
        if st == .denied || st == .restricted {
            // Taken away mid-watch (Settings): each watcher hears it once and is ended, as on
            // Android, rather than being rejected again on every later change.
            let ended = watchers; watchers.removeAll()
            for (_, w) in ended { w.reject("Permission denied.", "NOT_AUTHORIZED"); bridge?.releaseCall(w) }
            manager.stopUpdatingLocation()
        }
    }

    public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let l = locations.last else { return }
        var o: [String: Any] = [
            "latitude": l.coordinate.latitude, "longitude": l.coordinate.longitude,
            "accuracy": l.horizontalAccuracy, "time": l.timestamp.timeIntervalSince1970 * 1000.0,
            "simulated": false
        ]
        if l.verticalAccuracy >= 0 { o["altitude"] = l.altitude; o["altitudeAccuracy"] = l.verticalAccuracy }
        if l.speed >= 0 { o["speed"] = l.speed }
        if l.course >= 0 { o["bearing"] = l.course }
        for (_, w) in watchers { w.resolve(o) }
    }

    public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // kCLErrorLocationUnknown is a passing state (no fix yet); the watch carries on.
        if let e = error as? CLError, e.code == .locationUnknown { return }
        for (_, w) in watchers { w.reject(error.localizedDescription, nil, error) }
    }
}

@objc(NavAidBridgeViewController)
class NavAidBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(XPlaneDiscoveryPlugin())
        bridge?.registerPluginInstance(BarometerPlugin())
        bridge?.registerPluginInstance(LocationQualityPlugin())
        bridge?.registerPluginInstance(Gdl90Plugin())
        bridge?.registerPluginInstance(NavAidPrintPlugin())
        bridge?.registerPluginInstance(BackgroundGeolocationPlugin())
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Older iPads cannot use the web Screen Wake Lock API. Keep the chart visible
        // while NavAid is active, then restore the user's Auto-Lock behavior below.
        application.isIdleTimerDisabled = true
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        application.isIdleTimerDisabled = false
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        application.isIdleTimerDisabled = true
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
