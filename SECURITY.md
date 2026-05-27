# Security Policy

## Supported Versions

Only the latest production deployment (on `main`) receives security
updates. Staging (`dev`) and PR previews are ephemeral.

## Reporting a Vulnerability

If you find a security issue, please open a
[GitHub issue](https://github.com/msupino/NavigationApp/issues/new/choose)
rather than a public discussion.

NavAid is a client-side planning aid with no backend, no user
accounts, and no data collection. Reports typically involve
malicious route files (XSS via imported JSON/KML) or CDN
supply-chain risks.

Do **not** file a public issue if the vulnerability could impact
users of the live site — use
<msupino@gmail.com> instead.
