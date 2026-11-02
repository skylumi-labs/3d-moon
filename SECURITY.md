# Security policy

SkyLumi 3D Moon is a static web app: HTML, JavaScript and data files, with no server of its own and
no user accounts. It reads Moon tiles from the URLs it was built with, and sends crash and usage
telemetry only when a build sets the keys for it (`?telemetry=0` turns it off in any build).

## Reporting a vulnerability

Please report privately through GitHub: **Security > Report a vulnerability** on this repository
(private vulnerability reporting). Do not open a public issue for a security problem.

If you cannot use GitHub, write to hello@corsierlabs.com with "security" in the subject.

We aim to acknowledge a report within 7 days and to agree on a fix and disclosure date with you.

## In scope

- The data-base override gate (`src/moon/dataBase.ts`): a query string or link that makes the app
  load tiles or scripts from a host the build did not allow.
- The Content-Security-Policy meta in `index.html`.
- Telemetry: anything sent without keys, anything sent after `?telemetry=0`, or personal data in an event.
- Cross-site scripting through query parameters, share links or label text.
- The build and CI workflows in `.github/workflows/`.

## Out of scope

- The availability or cost of the public data mirror (it is best effort, with no service level).
- Findings that need a malicious browser extension or a compromised machine.
- Denial of service against your own browser by asking for a huge view (for example extreme zoom or quality settings).

## Supported versions

Only the latest release tag and `main` receive fixes.
