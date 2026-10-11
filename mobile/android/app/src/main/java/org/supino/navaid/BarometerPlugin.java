package org.supino.navaid;

import android.content.Context;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.SystemClock;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// The phone's own pressure sensor (most phones have one), for the barometric readouts in
// docs/app/device-extras.js: pressure altitude and vertical speed. There is no web API for it.
// Forwards the static pressure in hPa about once a second as a "pressure" event while started.
// In an unpressurised cabin that is close to the outside static pressure; the page says so.
@CapacitorPlugin(name = "Barometer")
public class BarometerPlugin extends Plugin implements SensorEventListener {
  private static final long MIN_INTERVAL_MS = 900;
  private SensorManager sensors;
  private Sensor pressure;
  private boolean running = false;
  private long lastSentAt = 0;

  @Override
  public void load() {
    sensors = (SensorManager) getContext().getSystemService(Context.SENSOR_SERVICE);
    pressure = sensors == null ? null : sensors.getDefaultSensor(Sensor.TYPE_PRESSURE);
  }

  @PluginMethod
  public void isAvailable(PluginCall call) {
    JSObject r = new JSObject();
    r.put("available", pressure != null);
    call.resolve(r);
  }

  @PluginMethod
  public void start(PluginCall call) {
    if (pressure == null) { call.reject("No pressure sensor", "UNAVAILABLE"); return; }
    if (!running) {
      sensors.registerListener(this, pressure, SensorManager.SENSOR_DELAY_NORMAL);
      running = true;
    }
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
    if (running && sensors != null) sensors.unregisterListener(this);
    running = false;
  }

  @Override
  public void onSensorChanged(SensorEvent e) {
    long now = SystemClock.elapsedRealtime();
    if (now - lastSentAt < MIN_INTERVAL_MS || e.values == null || e.values.length == 0) return;
    lastSentAt = now;
    JSObject o = new JSObject();
    o.put("hPa", e.values[0]);
    o.put("t", System.currentTimeMillis());
    notifyListeners("pressure", o);
  }

  @Override
  public void onAccuracyChanged(Sensor sensor, int accuracy) { /* not used */ }
}
