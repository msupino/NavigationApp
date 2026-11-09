package org.supino.navaid;

import android.net.Uri;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.wearable.PutDataMapRequest;
import com.google.android.gms.wearable.PutDataRequest;
import com.google.android.gms.wearable.Wearable;

import java.nio.charset.StandardCharsets;

// The live picture for a paired Wear OS watch. docs/app/wear.js builds the figures (next waypoint,
// bearing, distance, ETE/ETA, leg timer, GS, altitude) as one JSON document; this puts it on the
// Wearable Data Layer as a single latest-state DataItem, /navaid/nav, which the NavAid watch app
// (mobile/android/wear) shows. One item rather than a message stream: a watch that connects late,
// or wakes, gets the current picture at once. The watch and phone apps share the applicationId and
// the signing key -- the Data Layer connects nothing else.
@CapacitorPlugin(name = "WearBridge")
public class WearBridgePlugin extends Plugin {
  private static final String TAG = "WearBridge";
  static final String PATH = "/navaid/nav";

  @PluginMethod
  public void nodes(PluginCall call) {
    Wearable.getNodeClient(getContext()).getConnectedNodes()
      .addOnSuccessListener(list -> {
        JSObject o = new JSObject();
        o.put("count", list == null ? 0 : list.size());
        call.resolve(o);
      })
      // No Play services, or no Wear OS app on the phone: simply no watch.
      .addOnFailureListener(e -> {
        JSObject o = new JSObject();
        o.put("count", 0);
        call.resolve(o);
      });
  }

  @PluginMethod
  public void publish(PluginCall call) {
    String json = call.getString("json");
    if (json == null || json.length() > 4096) { call.reject("A JSON document up to 4 kB is required"); return; }
    PutDataMapRequest req = PutDataMapRequest.create(PATH);
    req.getDataMap().putByteArray("json", json.getBytes(StandardCharsets.UTF_8));
    // A value that changes on every send, so the Data Layer never folds two identical
    // documents into "no change" and the watch's age stays honest.
    req.getDataMap().putLong("sentAt", System.currentTimeMillis());
    PutDataRequest put = req.asPutDataRequest().setUrgent();
    Wearable.getDataClient(getContext()).putDataItem(put)
      .addOnSuccessListener(item -> call.resolve())
      .addOnFailureListener(e -> {
        Log.w(TAG, "publish failed", e);
        call.reject("Could not reach the watch: " + e.getMessage());
      });
  }

  @PluginMethod
  public void clear(PluginCall call) {
    Uri uri = new Uri.Builder().scheme("wear").path(PATH).build();
    Wearable.getDataClient(getContext()).deleteDataItems(uri)
      .addOnSuccessListener(n -> call.resolve())
      .addOnFailureListener(e -> call.resolve());
  }
}
