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

CI (`.github/workflows/ci.yml`) builds and tests every push/PR.
Dependencies are pinned to exact versions; Dependabot proposes grouped weekly
updates for npm packages and the GitHub Actions used by the workflows.

## Companion modules (`rpc.*` Lua)

Some game state isn't reachable over the typed RemoteFortressReader socket —
legends/history, the job queue, and any *write* to `df.global.*`. For those,
Vizier ships small Lua **companion modules** under `lua/rpc/` (e.g.
`legends.lua`) that run *inside* DFHack and are called over its `RunLua` RPC.
DFHack only permits `RunLua` against modules named `rpc.*` / `*.rpc` / `*-rpc`,
so the file `lua/rpc/<name>.lua` declares `mkmodule('rpc.<name>')` and is reached
as module id `rpc.<name>`. `install-companion` copies them into
`<DFHack>/hack/lua/rpc/`.

Each companion is paired with a TS wrapper `src/dfhack/rpc-<name>.ts` built on
`callRpcModule()`, plus a tool file that exposes a `<name>_setup_check`
diagnostic and the tools themselves.

### Conventions (follow these or things break subtly)

- **Every exported Lua function must return a single JSON string** of the shape
  `{ ok = true, data = ... }` or `{ ok = false, error = "..." }`. DFHack's RunLua
  dispatch reads the return via `lua_tostring`; a table return stringifies to
  `nil` and is dropped. Use the local `ok()` / `err()` helpers.
- **Always return an envelope — never let a function raise.** A raised error
  comes back as a bare `CR_FAILURE`, which the client can't distinguish from
  "module not installed" (`callRpcModule` maps it to the *missing-companion*
  error). So wrap risky bodies in `pcall` and convert failures to `err(...)`;
  for multi-step functions, wrap the whole body (see `teleport_unit` in
  `units.lua` and `get_biography` in `legends.lua`). If a tool mysteriously
  reports "companion missing" when it *is* installed, this is almost always the
  cause.
- **Wrap every mutation in `dfhack.with_suspend`** so a write from the RPC
  thread can't race the game loop.
- **Bump the `schema` in `ping()` when you change a companion's surface**, and
  bump the matching `<NAME>_SCHEMA` in `rpc-<name>.ts`. `companion-schema.test.ts`
  fails if the two drift apart.

### Dev loop for companions (the cache gotcha)

DFHack `require()`s a module **once** and caches it. Editing `lua/rpc/<name>.lua`
and re-running `install-companion` updates the file on disk but the running game
keeps the old copy in memory. To pick up changes, reload in the DFHack console:

```
:lua for _,m in ipairs({'rpc.legends','rpc.jobs','rpc.units'}) do package.loaded[m]=nil end
```

(or restart DFHack). The next call re-`require`s fresh. A brand-new module loads
on first call without a reload — only *edits* to an already-loaded module need it.

### Testing companions against a live DFHack

The unit suite mocks the socket, so companion `*.lua` has **no** automated
coverage — a real bug there (e.g. calling a function that doesn't exist in this
DFHack build) only shows up live. After editing any companion, run:

```bash
npm run build && npm run smoke
```

`scripts/smoke-companions.mjs` pings every companion this checkout ships against
a running DFHack (`DFHACK_HOST`/`DFHACK_PORT`) and reports each one's schema, or
notes that DFHack isn't running and exits 0. For a tighter loop on a single new
function, call it directly via `callRpc("RunLua", { module, function, arguments })`
in a throwaway script and print the raw envelope.

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
