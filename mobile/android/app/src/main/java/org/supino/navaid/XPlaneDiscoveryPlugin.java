package org.supino.navaid;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.DatagramPacket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.MulticastSocket;
import java.net.URL;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;

@CapacitorPlugin(name = "XPlaneDiscovery")
public class XPlaneDiscoveryPlugin extends Plugin {
  private static final String GROUP = "239.255.1.1";
  private static final int PORT = 49707;
  private static final int BRIDGE_PORT = 2020;
  private static final int TIMEOUT_MS = 3500;
  private final ExecutorService executor = Executors.newSingleThreadExecutor();
  private volatile MulticastSocket activeSocket;

  @PluginMethod
  public void discover(PluginCall call) {
    if (!isTrustedProductionPage()) {
      call.reject("X-Plane discovery is available only on production NavAid", "UNTRUSTED_ORIGIN");
      return;
    }
    executor.execute(() -> listen(call));
  }

  private boolean isTrustedProductionPage() {
    String raw = getBridge().getWebView().getUrl();
    if (raw == null) return false;
    Uri uri = Uri.parse(raw);
    return "https".equals(uri.getScheme()) && "navaid.supino.org".equals(uri.getHost()) &&
        uri.getPort() == -1 && (uri.getPath() == null || "/".equals(uri.getPath()));
  }

  private void listen(PluginCall call) {
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
      activeSocket = socket;
      socket.setReuseAddress(true);
      socket.setSoTimeout(TIMEOUT_MS);
      InetAddress group = InetAddress.getByName(GROUP);
      socket.joinGroup(group);
      long deadline = System.currentTimeMillis() + TIMEOUT_MS;
      byte[] buffer = new byte[1024];
      while (System.currentTimeMillis() < deadline) {
        DatagramPacket packet = new DatagramPacket(buffer, buffer.length);
        socket.receive(packet);
        if (!isBeacon(packet.getData(), packet.getLength()) ||
            (!packet.getAddress().isSiteLocalAddress() && !packet.getAddress().isLinkLocalAddress())) {
          continue;
        }
        String host = packet.getAddress().getHostAddress();
        if (!probeBridge(host)) continue;
        JSObject result = new JSObject();
        result.put("found", true);
        result.put("host", host);
        result.put("name", beaconName(packet.getData(), packet.getLength()));
        result.put("xplanePort", beaconPort(packet.getData(), packet.getLength()));
        result.put("bridgeUrl", "http://" + host + ":" + BRIDGE_PORT);
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
      if (activeSocket == socket) activeSocket = null;
      if (lock != null && lock.isHeld()) lock.release();
    }
  }

  static boolean isBeacon(byte[] data, int length) {
    return length >= 22 && data[0] == 'B' && data[1] == 'E' && data[2] == 'C' &&
        data[3] == 'N' && data[4] == 0 && data[5] == 1 && beaconPort(data, length) > 0 &&
        data[21] != 0 && beaconNameTerminated(data, length);
  }

  private static boolean beaconNameTerminated(byte[] data, int length) {
    for (int index = 22; index < length; index++) {
      if (data[index] == 0) return true;
    }
    return false;
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

  private boolean probeBridge(String host) {
    HttpURLConnection connection = null;
    try {
      connection = (HttpURLConnection) new URL("http", host, BRIDGE_PORT, "/").openConnection();
      connection.setConnectTimeout(650);
      connection.setReadTimeout(650);
      connection.setRequestMethod("GET");
      if (connection.getResponseCode() < 200 || connection.getResponseCode() >= 300) return false;
      try (BufferedInputStream input = new BufferedInputStream(connection.getInputStream());
           ByteArrayOutputStream output = new ByteArrayOutputStream()) {
        byte[] chunk = new byte[2048];
        int read;
        while ((read = input.read(chunk)) >= 0 && output.size() <= 65536) output.write(chunk, 0, read);
        if (output.size() > 65536) return false;
        JSONObject json = new JSONObject(output.toString(StandardCharsets.UTF_8.name()));
        return validCoordinates(json.opt("latitude"), json.opt("longitude"));
      }
    } catch (Exception ignored) {
      return false;
    } finally {
      if (connection != null) connection.disconnect();
    }
  }

  static boolean validCoordinates(Object latitudeValue, Object longitudeValue) {
    if (!(latitudeValue instanceof Number) || !(longitudeValue instanceof Number)) return false;
    double latitude = ((Number) latitudeValue).doubleValue();
    double longitude = ((Number) longitudeValue).doubleValue();
    return Double.isFinite(latitude) && Double.isFinite(longitude) &&
        latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
  }

  @Override
  protected void handleOnDestroy() {
    MulticastSocket socket = activeSocket;
    if (socket != null) socket.close();
    executor.shutdownNow();
  }
}
