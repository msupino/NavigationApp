package org.supino.navaid;

import android.content.Intent;
import android.os.Bundle;
import android.util.Log;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginHandle;

import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;

// @capgo/capacitor-social-login requires the host Activity to implement this
// marker interface and forward Google's authorization Activity result back to
// the plugin whenever extra OAuth scopes are requested (we ask for the Drive
// scope). Without it the plugin rejects login with "You CANNOT use scopes
// without modifying the main activity. Please follow the docs!".
public class MainActivity extends BridgeActivity
    implements ModifiedMainActivityForSocialLoginPlugin {

  @Override
  public void onCreate(Bundle savedInstanceState) {
    registerPlugin(XPlaneDiscoveryPlugin.class);
    super.onCreate(savedInstanceState);
  }

  @Override
  public void onActivityResult(int requestCode, int resultCode, Intent data) {
    super.onActivityResult(requestCode, resultCode, data);

    // The scope-consent screen is launched with a request code in
    // [REQUEST_AUTHORIZE_GOOGLE_MIN, REQUEST_AUTHORIZE_GOOGLE_MAX). Hand those
    // results straight to the SocialLogin plugin so it can resolve the pending
    // login future with the granted access token.
    if (requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN
        && requestCode < GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX) {
      PluginHandle handle = getBridge().getPlugin("SocialLogin");
      if (handle == null) {
        Log.i("MainActivity", "SocialLogin plugin handle is null");
        return;
      }
      Plugin plugin = handle.getInstance();
      if (!(plugin instanceof SocialLoginPlugin)) {
        Log.i("MainActivity", "SocialLogin plugin instance is not SocialLoginPlugin");
        return;
      }
      ((SocialLoginPlugin) plugin).handleGoogleLoginIntent(requestCode, data);
    }
  }

  // Marker method that proves the Activity was modified as the plugin requires.
  @Override
  public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() {}
}
