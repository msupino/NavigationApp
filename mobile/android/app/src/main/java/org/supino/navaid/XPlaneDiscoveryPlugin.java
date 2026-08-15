package org.supino.navaid;

import android.content.Context;
import android.net.wifi.WifiManager;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.DatagramPacket;
import java.net.InetAddress;
import java.net.MulticastSocket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "XPlaneDiscovery")
public class XPlaneDiscoveryPlugin extends Plugin {
  private static final String GROUP = "239.255.1.1";
  private static final int PORT = 49707;
  private final ExecutorService executor = Executors.newSingleThreadExecutor();

  @PluginMethod
  public void discover(PluginCall call) {
    final int timeoutMs = Math.max(500, Math.min(10000, call.getInt("timeoutMs", 3500)));
    final int bridgePort = Math.max(1, Math.min(65535, call.getInt("bridgePort", 2020)));
    executor.execute(() -> listen(call, timeoutMs, bridgePort));
  }

  private void listen(PluginCall call, int timeoutMs, int bridgePort) {
    WifiManager wifi = (WifiManager) getContext().getApplicationContext()
        .getSystemService(Context.WIFI_SERVICE);
    WifiManager.MulticastLock lock = wifi == null ? null
        : wifi.createMulticastLock("navaid-xplane-discovery");
    MulticastSocket socket = null;
    try {
      if (lock != null) {
        lock.setReferenceCounted(false);
        lock.acquire();
      }
      socket = new MulticastSocket(PORT);
      socket.setReuseAddress(true);
      socket.setSoTimeout(timeoutMs);
      InetAddress group = InetAddress.getByName(GROUP);
      socket.joinGroup(group);
      long deadline = System.currentTimeMillis() + timeoutMs;
      byte[] buffer = new byte[1024];
      while (System.currentTimeMillis() < deadline) {
        DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
        socket.receive(packet);
        if (!isBeacon(packet.getData(), packet.getLength())) continue;
        String host = packet.getAddress().getHostAddress();
        JSObject result = new JSObject();
        result.put("found", true);
        result.put("host", host);
        result.put("name", beaconName(packet.getData(), packet.getLength()));
        result.put("xplanePort", beaconPort(packet.getData(), packet.getLength()));
        result.put("bridgeUrl", "http://" + host + ":" + bridgePort);
        result.put("source", "xplane-becn");
        socket.leaveGroup(group);
        call.resolve(result);
        return;
      }
      JSObject result = new JSObject();
      result.put("found", false);
      call.resolve(result);
    } catch (java.net.SocketTimeoutException timeout) {
      JSObject result = new JSObject();
      result.put("found", false);
      call.resolve(result);
    } catch (Exception error) {
      call.reject("X-Plane discovery failed", error);
    } finally {
      if (socket != null) socket.close();
      if (lock != null && lock.isHeld()) lock.release();
    }
  }

  static boolean isBeacon(byte[] data, int length) {
    return length >= 21 && data[0] == 'B' && data[1] == 'E' && data[2] == 'C' &&
        data[3] == 'N' && data[4] == 0;
  }

  static int beaconPort(byte[] data, int length) {
    if (length < 21) return 0;
    return (data[19] & 0xff) | ((data[20] & 0xff) << 8);
  }

  static String beaconName(byte[] data, int length) {
    if (length <= 21) return "X-Plane";
    int end = 21;
    while (end < length && data[end] != 0) end++;
    String name = new String(data, 21, end - 21, StandardCharsets.UTF_8).trim();
    return name.isEmpty() ? "X-Plane" : name;
  }

  @Override
  protected void handleOnDestroy() {
    executor.shutdownNow();
  }
}
