package org.supino.navaid;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.location.GnssStatus;
import android.location.LocationManager;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// The satellites behind the position, for the location status line (docs/app/gps-status.js).
// The web's Geolocation API -- and the background-geolocation plugin built on it -- give a
// position and an accuracy, never the satellites; Android's GnssStatus does: every satellite in
// view, whether it is used in the fix, its constellation and its signal (C/N0). This forwards a
// summary to the page about once a second as a "gnss" event while started. It reads only; the
// position itself still comes from the location plugin.
@CapacitorPlugin(name = "GnssStatus")
public class GnssStatusPlugin extends Plugin {
  private static final String TAG = "GnssStatus";
  private static final long MIN_INTERVAL_MS = 900;   // the GNSS engine reports ~1 Hz; never faster

  private final Handler main = new Handler(Looper.getMainLooper());
  private GnssStatus.Callback callback;
  private long lastSentAt = 0;

  @PluginMethod
  public void start(PluginCall call) {
    if (getContext().checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
        != PackageManager.PERMISSION_GRANTED) {
      call.reject("Location permission not granted", "NO_PERMISSION");
      return;
    }
    LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
    if (lm == null) {
      call.reject("No location service", "UNAVAILABLE");
      return;
    }
    main.post(() -> {
      try {
        if (callback == null) {
          callback = new GnssStatus.Callback() {
            @Override
            public void onSatelliteStatusChanged(GnssStatus status) {
              long now = SystemClock.elapsedRealtime();
              if (now - lastSentAt < MIN_INTERVAL_MS) return;
              lastSentAt = now;
              notifyListeners("gnss", summary(status));
            }

            @Override
            public void onFirstFix(int ttffMillis) {
              JSObject o = new JSObject();
              o.put("firstFixMs", ttffMillis);
              notifyListeners("gnss", o);
            }

            @Override
            public void onStarted() {
              JSObject o = new JSObject();
              o.put("started", true);
              notifyListeners("gnss", o);
            }

            @Override
            public void onStopped() {
              JSObject o = new JSObject();
              o.put("stopped", true);
              notifyListeners("gnss", o);
            }
          };
          lm.registerGnssStatusCallback(callback, main);
        }
        call.resolve();
      } catch (SecurityException e) {
        call.reject("Location permission not granted", "NO_PERMISSION");
      } catch (Exception e) {
        Log.w(TAG, "could not start", e);
        call.reject(String.valueOf(e.getMessage()), "UNAVAILABLE");
      }
    });
  }

  @PluginMethod
  public void stop(PluginCall call) {
    main.post(() -> {
      unregister();
      call.resolve();
    });
  }

  @Override
  protected void handleOnDestroy() {
    unregister();
  }

  private void unregister() {
    if (callback == null) return;
    try {
      LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
      if (lm != null) lm.unregisterGnssStatusCallback(callback);
    } catch (Exception e) {
      Log.w(TAG, "could not stop", e);
    }
    callback = null;
  }

  // { inView, used, cn0: mean C/N0 of the used satellites (dB-Hz), systems: { GPS: {inView, used}, ... } }
  private static JSObject summary(GnssStatus s) {
    int n = s.getSatelliteCount(), used = 0;
    float cn0Sum = 0;
    JSObject systems = new JSObject();
    int[] inViewBy = new int[8], usedBy = new int[8];
    for (int i = 0; i < n; i++) {
      int c = s.getConstellationType(i);
      int k = (c >= 0 && c < 8) ? c : 0;
      inViewBy[k]++;
      if (s.usedInFix(i)) {
        used++;
        usedBy[k]++;
        cn0Sum += s.getCn0DbHz(i);
      }
    }
    for (int k = 0; k < 8; k++) {
      if (inViewBy[k] == 0) continue;
      JSObject o = new JSObject();
      o.put("inView", inViewBy[k]);
      o.put("used", usedBy[k]);
      systems.put(name(k), o);
    }
    JSObject out = new JSObject();
    out.put("inView", n);
    out.put("used", used);
    out.put("cn0", used > 0 ? Math.round(cn0Sum / used) : 0);
    out.put("systems", systems);
    return out;
  }

  private static String name(int constellation) {
    switch (constellation) {
      case GnssStatus.CONSTELLATION_GPS: return "GPS";
      case GnssStatus.CONSTELLATION_GLONASS: return "GLONASS";
      case GnssStatus.CONSTELLATION_GALILEO: return "Galileo";
      case GnssStatus.CONSTELLATION_BEIDOU: return "BeiDou";
      case GnssStatus.CONSTELLATION_QZSS: return "QZSS";
      case GnssStatus.CONSTELLATION_SBAS: return "SBAS";
      case 7: return "NavIC";                               // CONSTELLATION_IRNSS (API 29)
      default: return "Other";
    }
  }
}
