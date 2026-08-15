import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(scriptDir, '..');
const repoRoot = path.resolve(mobileRoot, '..');
const configPath = path.join(mobileRoot, 'capacitor.config.json');
const packagePath = path.join(mobileRoot, 'package.json');

function fail(message) {
  throw new Error(`Capacitor validation failed: ${message}`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

const config = readJson(configPath);
const pkg = readJson(packagePath);

if (config.appId !== 'org.supino.navaid') fail('unexpected appId');
if (config.appName !== 'NavAid') fail('unexpected appName');
// Remote-URL shell: the WebView loads production, so the installed app
// self-updates with every web deploy. webDir is only a packaged stub.
if (config.webDir !== 'shell') fail('webDir must point at the mobile/shell stub');
if (config.server?.url !== 'https://navaid.supino.org') {
  fail('native shell must load the production site (self-updating app)');
}
if (config.server?.androidScheme !== 'https') {
  fail('Android must use an https app origin for secure WebView APIs');
}

// The background-geolocation package supplies Android's foreground service. Its current
// Swift package pins Capacitor 7 and cannot coexist with the Capacitor 8 social-login
// package, while NavAid does not claim iOS background tracking yet. Keep it installed for
// Android but exclude it from the iOS plugin graph explicitly.
const expectedIosPlugins = [
  '@capacitor-community/text-to-speech',
  '@capacitor/local-notifications',
  '@capgo/capacitor-social-login',
];
if (JSON.stringify(config.ios?.includePlugins) !== JSON.stringify(expectedIosPlugins)) {
  fail('iOS plugin allowlist must exclude Android-only background geolocation');
}

const webDir = path.resolve(mobileRoot, config.webDir);
if (webDir !== path.join(mobileRoot, 'shell')) fail('webDir resolved outside mobile/shell');
if (!fs.existsSync(path.join(webDir, 'index.html'))) fail('missing mobile/shell/index.html');
// The real app still ships from docs/ — sanity-check it exists for the web deploy.
for (const file of ['index.html', 'app/core.js', 'app/ui.js', 'manifest.json']) {
  if (!fs.existsSync(path.join(repoRoot, 'docs', file))) fail(`missing docs/${file}`);
}

for (const dep of ['@capacitor/core', '@capacitor/android', '@capacitor/ios']) {
  if (!pkg.dependencies?.[dep]) fail(`missing dependency ${dep}`);
}
if (!pkg.devDependencies?.['@capacitor/cli']) fail('missing @capacitor/cli');

const rootPackage = readJson(path.join(repoRoot, 'package.json'));
const rootDeps = {
  ...rootPackage.dependencies,
  ...rootPackage.devDependencies,
};
for (const dep of ['@capacitor/core', '@capacitor/android', '@capacitor/ios', '@capacitor/cli']) {
  if (rootDeps[dep]) fail(`${dep} must stay isolated in mobile/package.json`);
}

const indexHtml = fs.readFileSync(path.join(repoRoot, 'docs', 'index.html'), 'utf8');
// GA was removed from the whole app (production has no mutable analytics runtime at all --
// see tests/ga-blocked.spec.js, which asserts its absence). This used to check that GA was
// gated behind the native-shell detection instead; that markup is gone along with GA itself,
// so the only invariant left to hold here is that it stays gone.
if (/googletagmanager|google-analytics|\bgtag\s*\(/.test(indexHtml)) {
  fail('docs/index.html must not reintroduce a Google Analytics / GTM runtime');
}

const uiJs = fs.readFileSync(path.join(repoRoot, 'docs', 'app/ui.js'), 'utf8');
if (!uiJs.includes('isNativeCapacitorShell')) {
  fail('docs/app/ui.js must keep the native-shell detection helper');
}

const androidGradle = path.join(mobileRoot, 'android/app/build.gradle');
if (fs.existsSync(androidGradle)) {
  const text = fs.readFileSync(androidGradle, 'utf8');
  if (!text.includes('namespace = "org.supino.navaid"')) fail('Android namespace drifted');
  if (!text.includes('applicationId "org.supino.navaid"')) fail('Android applicationId drifted');
}

const androidStrings = path.join(mobileRoot, 'android/app/src/main/res/values/strings.xml');
if (fs.existsSync(androidStrings)) {
  const text = fs.readFileSync(androidStrings, 'utf8');
  if (!text.includes('<string name="app_name">NavAid</string>')) fail('Android app name drifted');
}

const androidTest = path.join(mobileRoot, 'android/app/src/androidTest/java/org/supino/navaid/ExampleInstrumentedTest.java');
if (fs.existsSync(androidTest)) {
  const text = fs.readFileSync(androidTest, 'utf8');
  if (text.includes('com.getcapacitor') || !text.includes('org.supino.navaid')) {
    fail('Android test package drifted');
  }
}

const iosProject = path.join(mobileRoot, 'ios/App/App.xcodeproj/project.pbxproj');
if (fs.existsSync(iosProject)) {
  const text = fs.readFileSync(iosProject, 'utf8');
  if (!text.includes('PRODUCT_BUNDLE_IDENTIFIER = org.supino.navaid;')) {
    fail('iOS bundle identifier drifted');
  }
}

const iosInfo = path.join(mobileRoot, 'ios/App/App/Info.plist');
if (fs.existsSync(iosInfo)) {
  const text = fs.readFileSync(iosInfo, 'utf8');
  if (!text.includes('<key>CFBundleDisplayName</key>') || !text.includes('<string>NavAid</string>')) {
    fail('iOS display name drifted');
  }
  if (!/<key>NSAllowsLocalNetworking<\/key>\s*<true\/>/.test(text) ||
      !/<key>NSLocalNetworkUsageDescription<\/key>\s*<string>[^<]+<\/string>/.test(text)) {
    fail('iOS local simulator bridge access is not declared');
  }
  if (text.includes('<key>NSAllowsArbitraryLoads</key>')) {
    fail('iOS must not disable App Transport Security globally');
  }
}

console.log('Capacitor mobile wrapper ok');
