// @ts-check
// Reported on 1.29 on a Mac: typing no longer showed in text fields. 1.29 was the first build to
// hide iOS's keyboard bars by swapping the class of WebKit's content view and emptying its
// shortcuts bar -- the view a Mac's typing goes through. On a Mac the app leaves it alone.
const { test, expect } = require('./_setup');
const fs = require('fs');
const path = require('path');

test('the iOS app hides the keyboard bars on iPhone and iPad, never on a Mac', () => {
  const swift = fs.readFileSync(path.join(__dirname, '../mobile/ios/App/App/AppDelegate.swift'), 'utf8');
  const load = swift.slice(swift.indexOf('override func capacitorDidLoad()'));
  const guard = load.indexOf('if !ProcessInfo.processInfo.isiOSAppOnMac {');
  expect(guard).toBeGreaterThan(-1);
  // Both calls sit inside that guard, before anything else in capacitorDidLoad.
  expect(load.indexOf('NavAidKeyboardBars.hide(in: webView)')).toBeGreaterThan(guard);
  expect(load.indexOf('NavAidKeyboardBars.keepHidden(in: webView)')).toBeGreaterThan(guard);
  expect(load.indexOf('NavAidKeyboardBars.keepHidden(in: webView)')).toBeLessThan(load.indexOf('\n        }'));
});
