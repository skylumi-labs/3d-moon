# Contributing

Thanks for helping. This file is the whole process: how to build, what to run before a pull request,
and how we review.

Questions and ideas go to **Discussions**; bugs go to **Issues**. We triage both **once a week**, so
expect a first answer within about seven days.

## Quick start

You need Node 22 (`.nvmrc`) and npm.

```bash
nvm use
npm ci
npm run dev           # http://localhost:5190/moon/ with the built-in 4k maps, fully offline
npm run dev:hosted    # the same, streaming terrain, imagery and Apollo patches from the public mirror
```

The public mirror is best effort, with no service level. Settings for both live in `.env.example`.

## Before you open a pull request

Run the same gates CI runs, in this order, and make sure each passes:

```bash
npm ci
npm run typecheck     # tsc over src/, vite.config.ts and audit/
npm test              # every scripts/*.test.mts; needs no tile data
npm run build         # typecheck, vite build and the dist guard (what CI runs)
npm run lint          # eslint over scripts/ and audit/ (src/ is gated by typecheck)
```

`TEST_TIER=fast npm test` skips the few slow data tests; pull requests run that tier in CI and `main`
runs everything. A test that skips prints why. If you change how a function behaves, change its test
in the same commit.

## Sign your commits (DCO)

Every commit carries a [Developer Certificate of Origin](https://developercertificate.org/) sign-off.
By adding a `Signed-off-by` line to a commit you certify that you wrote it, or otherwise have the
right to submit it, under the project's licence (AGPL-3.0-only):

```bash
git commit -s -m "Fix the terminator flicker at low Sun"
```

The DCO certifies where the code came from and that you may submit it under the project's open source
licence. The CLA below separately grants Corsier Labs additional rights. Both are required; neither
replaces the other.

Use your real name and an address you can be reached at. The DCO check fails a pull request with an
unsigned commit; `git rebase --signoff main` fixes a branch you have already pushed.

## What we look for in review

- **Honest labels.** A label, caption or credit must not claim more than the data under it supports.
  If something is modelled rather than measured, the screen says so. Estimates are called estimates.
- **Data needs its paper trail.** A pull request that adds or changes a data source names the
  product id, the terms (with a link), the exact credit line, and adds a row to `DATA-LICENSES.md`.
  Data files themselves do not go in git; they are hosted and streamed.
- **Rendering changes come with a measurement on a real GPU.** Say which GPU and browser. A software
  renderer (SwiftShader, llvmpipe) is fine for checking framing, never for smoothness or timing, and one
  sample is not a measurement.
- **Small pull requests.** One change per pull request, with a description of what you saw before and
  after. We squash-merge.

## Contributor licence agreement (CLA)

Read [`CLA.md`](CLA.md) (version 1.1), then tick the CLA box in the description of each pull request you
open: `I have read CLA.md (version 1.1) and agree to it for this contribution`. Only the pull request
author may tick it; the `cla` check fails if anyone else adds the tick, and it ignores a tick inside a
comment or code block. The check stays red until the box is ticked; ticking it re-runs the check. You
accept for that repository's pull request only, and a revised version needs a new acceptance.
You keep the copyright in your work: the CLA is a licence, not an assignment. It lets Corsier Labs, LLC also
release your contribution under other terms, which is how the project funds itself (commercial licences and
the SkyLumi apps) while the accepted version of your work stays available under AGPL-3.0-only. Code reaches
us as a pull request; every commit in it must be yours or covered by its author's own acceptance. If your
employer may own rights in the work, it must agree too. Disclose third-party material in the description.
The repository owner and the maintainers named in the `cla` workflow are exempt, as are Dependabot pull
requests that contain only Dependabot commits. Organisation membership alone is not an exemption.

## Licence

Your contribution is licensed to everyone under the GNU Affero General Public License, version 3 only
(`LICENSE`), and to Corsier Labs, LLC under `CLA.md`. Data keeps its own terms (`DATA-LICENSES.md`).
The SkyLumi name and logo are covered by `TRADEMARKS.md`.
