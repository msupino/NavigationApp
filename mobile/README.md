# NavAid Mobile

This directory contains the native iOS and Android wrapper for NavAid. It uses
Capacitor to package the existing static app from `../docs` without changing the
GitHub Pages deployment.

## First setup

```sh
cd mobile
npm install
npm run sync
```

## Open native projects

```sh
cd mobile
npm run open:ios
npm run open:android
```

## Notes

- `capacitor.config.json` points `webDir` at `../docs`, so the native app bundles
  the same app files that Pages deploys.
- The native app origin is `app.navaid.local`. The web app uses that host to skip
  production Google Analytics and PWA service-worker registration inside the
  native shell.
- Leaflet and live chart tiles are still network resources. A later mobile PR
  should vendor the Leaflet runtime and add a native tile download/store path for
  true offline flight use.
