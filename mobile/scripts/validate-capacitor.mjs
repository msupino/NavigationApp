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
if (config.webDir !== '../docs') fail('webDir must point at ../docs');
if (config.server?.hostname !== 'app.navaid.local') {
  fail('native app hostname must stay app.navaid.local');
}
if (config.server?.androidScheme !== 'https') {
  fail('Android must use an https app origin for secure WebView APIs');
}

const webDir = path.resolve(mobileRoot, config.webDir);
if (webDir !== path.join(repoRoot, 'docs')) fail('webDir resolved outside repo docs');
for (const file of ['index.html', 'app/core.js', 'app/ui.js', 'manifest.json']) {
  if (!fs.existsSync(path.join(webDir, file))) fail(`missing docs/${file}`);
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

const indexHtml = fs.readFileSync(path.join(webDir, 'index.html'), 'utf8');
if (!indexHtml.includes("location.hostname !== 'app.navaid.local'")) {
  fail('docs/index.html must suppress production GA inside the native shell');
}

const uiJs = fs.readFileSync(path.join(webDir, 'app/ui.js'), 'utf8');
if (!uiJs.includes('isNativeCapacitorShell')) {
  fail('docs/app/ui.js must skip PWA service-worker boot in the native shell');
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
}

console.log('Capacitor mobile wrapper ok');
