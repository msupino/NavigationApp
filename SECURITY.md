# Security Policy

## Supported Versions

Only the latest production deployment (on `main`) receives security
updates. Staging (`dev`) is not a supported release. Pull requests are
validated from a locally served build artifact and are not publicly deployed.

## Reporting a Vulnerability

If you find a security issue, report it privately to <marco@supino.org> first.
Do not include exploitable details, credentials, or live-user impact in a public issue or
discussion. After the issue is contained, the maintainer may open a sanitized public issue
for non-sensitive follow-up work.

NavAid is a client-side planning aid with no application backend or user
accounts. Depending on the features a user enables, the browser can contact
third-party map, weather, imagery, tuning-config, and AI services; an optional
AI provider key is stored locally in that browser. Reports typically involve
malicious route files (XSS via imported JSON/KML), credential exposure, or CDN
supply-chain risks.
