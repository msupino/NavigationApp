# Security Policy

## Supported Versions

Only the latest production deployment (on `main`) receives security
updates. Staging (`dev`) is not a supported release. Pull requests are
validated from a locally served build artifact and are not publicly deployed.

## Reporting a Vulnerability

If you find a security issue, please open a
[GitHub issue](https://github.com/msupino/NavigationApp/issues/new/choose)
rather than a public discussion.

NavAid is a client-side planning aid with no application backend or user
accounts. Depending on the features a user enables, the browser can contact
third-party map, weather, imagery, tuning-config, and AI services; an optional
AI provider key is stored locally in that browser. Reports typically involve
malicious route files (XSS via imported JSON/KML), credential exposure, or CDN
supply-chain risks.

Do **not** file a public issue if the vulnerability could impact
users of the live site — use
<msupino@gmail.com> instead.
