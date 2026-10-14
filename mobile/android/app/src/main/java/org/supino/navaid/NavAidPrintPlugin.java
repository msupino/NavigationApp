package org.supino.navaid;

import android.content.Context;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.util.Log;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

// Printing in the app. A WebView's window.print() does nothing on Android -- the page has no
// print dialog of its own there -- so the Print buttons hand the job to Android's print system
// (PrintManager), which offers the phone's printers and "Save as PDF".
//
//   printPage()  prints the app's own page as it stands, with its print styles: the flight plan,
//                the nav log, the planning form (the page sets them up and calls window.print,
//                which docs/app/native-print.js routes here).
//   printHtml()  prints a page of its own, given as HTML: the map, one image a sheet
//                (docs/app/io.js openPrintWindow). Loaded in a WebView off screen, then printed.
//
// When the print dialog is done -- printed, saved or cancelled -- a "printFinished" event goes
// back to the page, which stands in for the browser's afterprint.
@CapacitorPlugin(name = "NavAidPrint")
public class NavAidPrintPlugin extends Plugin {
  private static final String TAG = "NavAidPrint";
  // Held while its job runs: a WebView nothing refers to may be collected mid-print.
  private WebView printView;

  @PluginMethod
  public void printPage(PluginCall call) {
    final String name = call.getString("name", "NavAid");
    getActivity().runOnUiThread(() -> {
      try {
        WebView webView = getBridge().getWebView();
        start(name, webView.createPrintDocumentAdapter(name));
        call.resolve();
      } catch (Exception e) {
        Log.w(TAG, "print failed", e);
        call.reject("Could not print", e);
      }
    });
  }

  @PluginMethod
  public void printHtml(PluginCall call) {
    final String html = call.getString("html");
    final String name = call.getString("name", "NavAid");
    if (html == null) { call.reject("No page to print"); return; }
    getActivity().runOnUiThread(() -> {
      try {
        final WebView view = new WebView(getContext());
        // The page's images are files the app wrote to its cache (file:// addresses).
        view.getSettings().setAllowFileAccess(true);
        view.setWebViewClient(new WebViewClient() {
          private boolean started = false;
          @Override
          public void onPageFinished(WebView v, String url) {
            if (started) return;
            started = true;
            start(name, v.createPrintDocumentAdapter(name));
          }
        });
        printView = view;
        view.loadDataWithBaseURL("file:///", html, "text/html", "utf-8", null);
        call.resolve();
      } catch (Exception e) {
        Log.w(TAG, "print failed", e);
        call.reject("Could not print", e);
      }
    });
  }

  private void start(String name, PrintDocumentAdapter inner) {
    PrintManager printManager = (PrintManager) getContext().getSystemService(Context.PRINT_SERVICE);
    if (printManager == null) { finished(); return; }
    printManager.print(name, new Finishing(inner), new PrintAttributes.Builder().build());
  }

  private void finished() {
    printView = null;
    notifyListeners("printFinished", new JSObject());
  }

  // The WebView's own adapter, told apart only by onFinish: the moment the dialog is done.
  private class Finishing extends PrintDocumentAdapter {
    private final PrintDocumentAdapter inner;
    Finishing(PrintDocumentAdapter inner) { this.inner = inner; }

    @Override public void onStart() { inner.onStart(); }

    @Override
    public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes,
                         CancellationSignal cancellationSignal, LayoutResultCallback callback,
                         Bundle extras) {
      inner.onLayout(oldAttributes, newAttributes, cancellationSignal, callback, extras);
    }

    @Override
    public void onWrite(PageRange[] pages, ParcelFileDescriptor destination,
                        CancellationSignal cancellationSignal, WriteResultCallback callback) {
      inner.onWrite(pages, destination, cancellationSignal, callback);
    }

    @Override
    public void onFinish() {
      inner.onFinish();
      finished();
    }
  }
}
