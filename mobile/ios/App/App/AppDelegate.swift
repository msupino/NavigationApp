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

    @objc func discover(_ call: CAPPluginCall) {
        let timeoutMs = max(500, min(10_000, call.getInt("timeoutMs") ?? 3_500))
        let bridgePort = max(1, min(65_535, call.getInt("bridgePort") ?? 2_020))
        Task {
            do {
                if let found = try await findBridge(port: bridgePort, timeoutMs: timeoutMs) {
                    call.resolve([
                        "found": true,
                        "host": found,
                        "name": "X-Plane",
                        "bridgeUrl": "http://\(found):\(bridgePort)",
                        "source": "local-bridge-scan"
                    ])
                } else {
                    call.resolve(["found": false])
                }
            } catch {
                call.reject("X-Plane discovery failed", nil, error)
            }
        }
    }

    private func findBridge(port: Int, timeoutMs: Int) async throws -> String? {
        guard let address = wifiIPv4(), let dot = address.lastIndex(of: ".") else { return nil }
        let prefix = String(address[...dot])
        let ownSuffix = Int(address[address.index(after: dot)...]) ?? -1
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = min(0.7, Double(timeoutMs) / 1000.0)
        config.timeoutIntervalForResource = config.timeoutIntervalForRequest
        config.waitsForConnectivity = false
        let session = URLSession(configuration: config)
        defer { session.invalidateAndCancel() }

        let candidates = (1...254).filter { $0 != ownSuffix }
        for start in stride(from: 0, to: candidates.count, by: 64) {
            if Task.isCancelled { return nil }
            let end = min(start + 64, candidates.count)
            if let host = await withTaskGroup(of: String?.self, returning: String?.self, body: { group in
                for suffix in candidates[start..<end] {
                    let host = prefix + String(suffix)
                    group.addTask { await self.probeBridge(host: host, port: port, session: session) }
                }
                for await result in group {
                    if let result {
                        group.cancelAll()
                        return result
                    }
                }
                return nil
            }) { return host }
        }
        return nil
    }

    private func probeBridge(host: String, port: Int, session: URLSession) async -> String? {
        guard let url = URL(string: "http://\(host):\(port)") else { return nil }
        do {
            let (data, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                  let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  json["latitude"] is NSNumber, json["longitude"] is NSNumber else { return nil }
            return host
        } catch {
            return nil
        }
    }

    private func wifiIPv4() -> String? {
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return nil }
        defer { freeifaddrs(list) }
        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let item = cursor {
            let interface = item.pointee
            if interface.ifa_addr.pointee.sa_family == UInt8(AF_INET),
               String(cString: interface.ifa_name) == "en0" {
                var address = interface.ifa_addr.pointee
                var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
                if getnameinfo(&address, socklen_t(interface.ifa_addr.pointee.sa_len),
                               &buffer, socklen_t(buffer.count), nil, 0, NI_NUMERICHOST) == 0 {
                    return String(cString: buffer)
                }
            }
            cursor = interface.ifa_next
        }
        return nil
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
