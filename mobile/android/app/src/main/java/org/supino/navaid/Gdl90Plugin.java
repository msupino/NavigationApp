package org.supino.navaid;

import android.content.Context;
import android.net.wifi.WifiManager;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetSocketAddress;
import java.net.SocketException;
import java.util.Arrays;

// GDL90 from a portable ADS-B receiver (Stratux, SkyEcho, Sentry...) on the cockpit Wi-Fi: the
// receiver broadcasts UDP datagrams to port 4000. This only listens and forwards each datagram
// to the page as base64 ("packet" events); framing, CRC and decoding are in docs/app/gdl90.js,
// where they are tested. A browser cannot open a UDP socket, so this exists in the APK only.
@CapacitorPlugin(name = "Gdl90")
public class Gdl90Plugin extends Plugin {
  private static final String TAG = "Gdl90";
  private volatile DatagramSocket socket;
  private Thread thread;
  private WifiManager.MulticastLock lock;

  @PluginMethod
  public void start(PluginCall call) {
    int port = call.getInt("port", 4000);
    if (socket != null) { call.resolve(); return; }
    try {
      DatagramSocket s = new DatagramSocket(null);
      s.setReuseAddress(true);
      s.setBroadcast(true);
      s.bind(new InetSocketAddress(port));
      socket = s;
    } catch (SocketException e) {
      call.reject("Cannot listen on UDP " + port + ": " + e.getMessage(), "UNAVAILABLE");
      return;
    }
    // Some receivers send to the broadcast address; Android drops those without this lock.
    WifiManager wifi = (WifiManager) getContext().getApplicationContext().getSystemService(Context.WIFI_SERVICE);
    if (wifi != null) {
      lock = wifi.createMulticastLock("navaid-gdl90");
      lock.setReferenceCounted(false);
      lock.acquire();
    }
    final DatagramSocket s = socket;
    thread = new Thread(() -> {
      byte[] buf = new byte[2048];
      while (socket == s) {
        try {
          DatagramPacket p = new DatagramPacket(buf, buf.length);
          s.receive(p);
          JSObject o = new JSObject();
          o.put("data", Base64.encodeToString(Arrays.copyOf(p.getData(), p.getLength()), Base64.NO_WRAP));
          notifyListeners("packet", o);
        } catch (Exception e) {
          if (socket == s) Log.w(TAG, "receive failed", e);
          break;
        }
      }
    }, "navaid-gdl90");
    thread.setDaemon(true);
    thread.start();
    call.resolve();
  }

  @PluginMethod
  public void stop(PluginCall call) {
    halt();
    call.resolve();
  }

  @Override
  protected void handleOnDestroy() { halt(); }

  private void halt() {
    DatagramSocket s = socket;
    socket = null;
    if (s != null) s.close();
    if (lock != null && lock.isHeld()) lock.release();
    lock = null;
    thread = null;
  }
}
