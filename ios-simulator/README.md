# iOS Simulator Manual migration

Plugin `1.1.4` uses Manifest v3 with `iosSimulator: true` and moves its complete
workflow guidance from the user-level Skill contribution to a bundled Manual.
It declares no plugin tools, network, Node worker, or additional permissions.
The omitted `kind` still normalizes to `chip`; identity, entry, icon, launch
mode, and four-language catalog copy are preserved.

## Minimum Cindy version

`minCindyVersion: 0.1.82` is the **provisional Draft target** requested for this
PR. It prevents older clients from receiving this Manual-only release. Before
the PR is marked ready, v0.1.82 must exist as a formally released stable Cindy
build, contain the Host change below, and pass the production verification
described in this document. If the first qualifying stable release has another
version, update `minCindyVersion` to that actual version instead of publishing
the Draft value.

- [Cindy v0.1.64](https://github.com/makecindy/cindy/releases/tag/v0.1.64) is
  the first stable release with Manifest-v3 support. Its manifest contract
  supports `iosSimulator` and `manual`, but this alone does not make a
  Manual-bearing plugin without tools discoverable.
- As checked on 2026-09-15, the latest stable release is
  [v0.1.79](https://github.com/makecindy/cindy/releases/tag/v0.1.79). Its
  [Ghost integration](https://github.com/makecindy/cindy/blob/abcf92c2b34e99209e505662a3fe4e11868e8aa1/apps/desktop/src/main/mcp-integrations/ghost.ts)
  still gates `visibleChipGhosts` and `readGhostManual` with `ghostHasTools`.
- Cindy [PR #4440](https://github.com/makecindy/cindy/pull/4440) fixed no-tools
  Manual discovery and reading and was merged to `main` on 2026-09-15 as
  `b201f1f663a1199c1e296ee0b6ddca7d465d4e9d`. It keeps `ghost_call` unavailable
  for plugins without tools while allowing roster, `ghost_info`, and
  `ghost_manual` access. A merged commit is not by itself a stable release.

Clients below the declared minimum continue receiving the newest compatible
historical release from the marketplace. That historical release retains the
Skill, so this package does not need a transition copy. This package removes
the `skill` declaration and `skills/` directory and exposes only the Manual on
compatible Hosts.

## Manual layout

`manual.items` is a lightweight top-level index. Read the workflow with
`ghost_manual({ ghost_id: "ios-simulator", path: "ios-simulator" })`.
`manual/ios-simulator/MANUAL.md` directly links to `build-and-run.md` and
`external-fallback.md` with full logical-path calls. These pages contain plain
Markdown without Skill frontmatter. Runtime tool contracts remain in the live
`cindy_ios_simulator` catalog; do not invent `ghost_call` tools for this plugin.
The catalog localization contract has no Manual translation field; existing
zh-CN/en/ja/ko catalog text remains unchanged and the operational Manual is
English.

## Verification gate

Before marking this Draft ready, install the exact packaged `.cindy` on a real
device running stable Cindy v0.1.82 or later and verify all of the following:

- The installed, enabled plugin appears in the roster and `ghost_info`.
- `ghost_manual` reads the entry and both child pages.
- `ghost_call` still rejects this plugin because it declares no tools.
- The Host-owned simulator core workflow remains usable without a user-level
  Skill contribution.

Run the four repository gates, `.tests/ios-simulator.test.mjs`, and
`node scripts/validate-plugin-manifest.mjs ./ios-simulator` from the repository
root. The repository packager uses committed `HEAD`; inspect the resulting
archive before installation. Static checks and Draft packaging do not establish
production operation. Until the stable build and real-device verification are
available, leave the PR's Production Cindy verification checkbox unchecked.
