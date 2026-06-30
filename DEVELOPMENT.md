# Development

Local setup and the build/test loop:

```bash
git clone https://github.com/ryanbateman/vizier_mcp.git
cd vizier_mcp
npm ci
npm run proto          # regenerate proto JSON from .proto files
npm run build          # full build (proto + tsc)
npm run inspector      # run MCP inspector for debugging
npm test               # run unit tests
```

On startup the server logs its version to stderr — make this the first
diagnostic when a client misbehaves (it reveals stale npx/pinned installs):

```
[vizier-mcp] v0.2.x ready (DFHACK_HOST=… DFHACK_PORT=… DFHACK_RPC_TIMEOUT_MS=…)
```

CI (`.github/workflows/ci.yml`) builds and tests every push/PR on Node 18 and 20.
Dependencies are pinned to exact versions; Dependabot proposes grouped weekly
updates for npm packages and the GitHub Actions used by the workflows.

## Releasing

Releases are published to npm automatically by GitHub Actions using **Trusted
Publishing** (GitHub OIDC — no long-lived npm token in the repo) with **signed
provenance**.

**One-time setup** (npm account owner): on npmjs.com → the package →
**Settings → Trusted Publishers** → add a GitHub Actions publisher:

- Repository: `ryanbateman/vizier_mcp`
- Workflow filename: `publish.yml`
- Environment: `release`

**Cutting a release:**

1. Bump `version` in `package.json`, commit, and push to `master`.
2. Create a GitHub Release with tag `vX.Y.Z` (must match `package.json`).
3. The `publish.yml` workflow runs `npm ci`, build, tests, a version-vs-tag
   guard, then `npm publish` — emitting provenance. Verify with the
   **Provenance** badge on npm and `npm audit signatures`.

You can dry-run the whole pipeline without releasing via the workflow's
**Run workflow** button (`workflow_dispatch`, `dry_run: true`).

## Reading the map (GetBlockList gotchas)

`GetBlockList` underpins the survey/dig tools and has two sharp edges:
- **Coordinates:** `min/max X,Y` are **block** coords (each block = 16×16 tiles), `Z` is a
  z-level, and **max is EXCLUSIVE on every axis**. To cover a tile box inclusively, convert to
  blocks and add +1 to each max (see `blockRange` in `src/tools/survey.ts` / `dig.ts`).
- **Change-driven:** it returns only blocks that changed since the last call on the connection,
  so a second read of the same region comes back partial/empty. Call `ResetMapHashes` first when
  you need the full current state (the survey/dig tools do).

Wide sweeps can crash DFHack — always go through `checkBlockVolume` (`src/block-volume.js`).
