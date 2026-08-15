import UIKit
import Capacitor
import Foundation
import Darwin

@objc(XPlaneDiscoveryPlugin)
public class XPlaneDiscoveryPlugin: CAPPlugin, CAPBridgedPlugin {
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
        return url.scheme == "https" && url.host == "navaid.supino.org" && url.port == nil &&
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
            let (data, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                  let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  json["latitude"] is NSNumber, json["longitude"] is NSNumber else {
                return .unavailable
            }
            return .found(host)
        } catch let error as URLError where error.code == .notConnectedToInternet ||
                                              error.code == .dataNotAllowed {
            return .networkDenied
        } catch {
            return .unavailable
        }
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

@objc(NavAidBridgeViewController)
class NavAidBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(XPlaneDiscoveryPlugin())
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
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
