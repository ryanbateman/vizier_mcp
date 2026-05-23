# Distributing the rpc-legends companion via Steam Workshop

A plan for replacing the manual `cp lua/rpc-legends.lua hack/scripts/rpc/legends.lua`
install step with a one-click Steam Workshop subscription. Written for the
maintainer of Vizier MCP — covers the layout, the dev loop, the publish
flow, and the open questions before this is worth committing to.

## Why bother

The current install path for legends access is honest but ugly: the user
clones the Vizier MCP repo (or downloads a release tarball), navigates to
their DFHack scripts directory, copies one file, sets an env var,
restarts. Three failure modes — wrong path, forgot env var, didn't
restart — each producing a `status: "missing"` response that they then
have to interpret. The diagnostic tool helps, but the installation step
itself is a friction wall.

Steam Workshop collapses that to: **click Subscribe**. DFHack scans
every installed mod's `scripts_modinstalled/` directory and exposes any
scripts there as callable commands, *even when the mod is not active
for the current world*. The companion script becomes available the
moment DFHack starts on a save the user has loaded. Auto-updates on
script bumps come for free.

This doc covers the legends script specifically, but the layout is the
template for any future DFHack companion Vizier MCP grows.

## Mod layout

```
vizier-rpc-legends/
  info.txt
  scripts_modinstalled/
    rpc/
      legends.lua            ← contents of lua/rpc-legends.lua
  README.md                  ← short user-facing doc + link to vizier-mcp
  preview.png                ← Workshop tile image (optional but expected)
```

Two choices for where this lives in the repo:

1. **`mod/` directory at repo root.** Mod source-of-truth. The Lua
   script is the *same file* as `lua/rpc-legends.lua` — either move
   `lua/rpc-legends.lua` under `mod/scripts_modinstalled/rpc/legends.lua`
   and delete the old path, or keep `lua/` as the canonical source and
   add a build script that copies into `mod/` before upload. Recommend
   the move: one source of truth, no drift.

2. **`workshop/` separate from `lua/`.** Keep `lua/rpc-legends.lua` as
   the canonical source, copy into `workshop/scripts_modinstalled/rpc/legends.lua`
   via a build step. More moving parts, less risk of accidentally
   shipping the wrong file structure to non-Workshop users.

Pick (1) unless and until non-Workshop distribution actually needs the
file at the old path. The manual-install instructions just point to
the new path; users who don't use Workshop can still grab the file
from the repo.

## info.txt template

```
[ID:vizier_rpc_legends]
[NUMERIC_VERSION:1]
[DISPLAYED_VERSION:0.1.0]
[EARLIEST_COMPATIBLE_NUMERIC_VERSION:1]
[EARLIEST_COMPATIBLE_DISPLAYED_VERSION:0.1.0]
[AUTHOR:Ryan Bateman]
[NAME:Vizier RPC – Legends bridge]
[DESCRIPTION:DFHack RPC endpoint exposing legends-mode data (historical figures, events, sites, artifacts, written contents, entities) to the Vizier MCP server. Read-only. Install: subscribe, ensure DFHack is present, ensure Vizier MCP has VIZIER_ENABLE_RUN_LUA=1.]
[STEAM_TITLE:Vizier RPC – Legends bridge]
[STEAM_DESCRIPTION:Companion DFHack script for the Vizier MCP server (https://github.com/ryanbateman/vizier_mcp). Exposes read-only legends data over DFHack's RunLua RPC under module name rpc.legends. Required for the legends_setup_check / get_legends_overview / describe_historical_figure tools.]
[STEAM_TAG:dfhack]
[STEAM_TAG:utility]
```

`STEAM_FILE_ID` is **not** in the template above. DF stamps it into the
on-disk `info.txt` on first upload (e.g. `[STEAM_FILE_ID:3219384720]`).
That stamped line must be copied back into the repo before the second
upload — otherwise DF treats the next upload as a brand-new Workshop
item and you end up with duplicates the community can subscribe to in
parallel. Process:

1. First upload: ship `info.txt` without `STEAM_FILE_ID`.
2. After upload completes, look at `mods/mod_upload/vizier-rpc-legends/info.txt`
   on disk — DF has added the line.
3. Copy that exact line into the repo's `info.txt`.
4. Commit it. All subsequent uploads use this as the upstream marker.

Treat `STEAM_FILE_ID` like a published package id: never edit it, never
delete it once set.

## Dev / test loop

DFHack scripts in `scripts_modinstalled/` are loaded by DFHack on
startup. There is no "reload mod" command beyond `dfhack-run reload
<script>` or restarting DFHack itself. Iteration loop:

1. **Edit** `mod/scripts_modinstalled/rpc/legends.lua` in this repo.
2. **Symlink (one-time setup)** to your local DF install so iteration
   doesn't require re-copying:
   ```
   ln -s "$PWD/mod" "$HOME/.local/share/Steam/steamapps/common/Dwarf Fortress/mods/vizier-rpc-legends"
   ```
   (Adjust path for your OS / DF install location.)
3. **In DF:** `Mods → Refresh` (or restart DF). DFHack picks up the
   updated script.
4. **Live-test** from Vizier MCP: call `legends_setup_check`. Expect
   `status: "ready"` with the schema number matching `LEGENDS_SCHEMA`
   in `src/dfhack/rpc-legends.ts`. Then call `get_legends_overview`,
   then `describe_historical_figure` against a known id.
5. **On Lua errors:** DFHack prints them to the gamelog. Either
   `dfhack-run` or check the gamelog overlay. The error also propagates
   back through `RunLua`'s response as a `CR_FAILURE`, which Vizier's
   wrapper currently maps to `ScriptMissingError` — that mapping may
   want refinement once we're actually iterating (a real Lua bug should
   surface as `LegendsError`, not "script missing").

### Tests that don't need a live game

The `test/rpc-legends.test.ts` suite mocks `callRpc` and covers the
envelope decoder + the error mapping. Add new tests there when adding
new functions to the script — the test only needs to assert the wire
shape, not actually call DFHack.

### Tests that *do* need a live game

There's no harness for this yet. Manual sequence per release:

1. Subscribe (or symlink) the mod.
2. Load a save with at least one historical figure (any fort with a
   founded year).
3. Run `legends_setup_check` → expect ready.
4. Run `get_legends_overview` → expect non-zero counts.
5. Run `describe_historical_figure id:<known_id>` → expect populated
   name + birth year. Look up a known id via Legends mode in the game
   first if needed.

Worth scripting this as a smoke test eventually; for now, document it
in the release checklist.

## Publishing flow

Bay 12 uses Steam's standard Workshop pipeline driven from inside DF.
No SDK, no separate uploader binary, no Bay 12 review. The mod has to
sit in a specific staging directory before upload.

### First-time publish

1. Stage the mod under `<DF install>/mods/mod_upload/vizier-rpc-legends/`.
   (Copy from this repo's `mod/` directory; the symlink approach above
   works for both dev and upload.)
2. Launch DF.
3. Main menu → **Mods → Upload**.
4. Pick the staged mod from the list.
5. Fill in the Workshop description (auto-populated from `STEAM_DESCRIPTION`
   in `info.txt` but you can edit at upload time).
6. Upload `preview.png` if not already in the mod folder.
7. Confirm upload.
8. **Copy the stamped `[STEAM_FILE_ID:…]` line back into the repo's
   info.txt and commit.**

### Subsequent updates

1. Bump `NUMERIC_VERSION` and `DISPLAYED_VERSION` in `info.txt`.
2. If schema-incompatible: bump `EARLIEST_COMPATIBLE_NUMERIC_VERSION` AND
   bump `LEGENDS_SCHEMA` in `src/dfhack/rpc-legends.ts` so the
   diagnostic tool reports `schema_mismatch` for users on an old script.
3. Update `STEAM_CHANGELOG` (optional but nice).
4. Re-upload via DF's Mods → Upload. Because `STEAM_FILE_ID` is set, DF
   pushes an update to the existing Workshop item rather than creating
   a new one.
5. Tag the commit (e.g. `legends-mod-v0.2.0`) so the released Lua source
   has a recoverable git ref.

### Versioning policy

The legends mod and Vizier MCP version separately. Vizier MCP cuts
releases for the TS-side composite tools; the mod cuts releases for the
Lua-side script. Coupling them would force users to re-subscribe / wait
for Vizier MCP releases just to get unrelated MCP-side changes. The
`LEGENDS_SCHEMA` constant is the contract between them — bump it
deliberately when the Lua-side payload shape breaks.

## Open questions / decisions still pending

- **Do we move `lua/rpc-legends.lua` under `mod/`, or build it via a
  copy step?** Recommend: move it. Single source of truth. Update all
  doc references in one commit.
- **Preview image.** Need to draw or pick something. Workshop tiles
  without a preview render as a generic placeholder and look unloved.
  A simple 512×512 banner reading "Vizier RPC: Legends" is enough.
- **Mod ID prefix collision.** `[ID:vizier_rpc_legends]` works for now;
  if Vizier MCP grows more companion scripts, naming convention should
  be `vizier_rpc_<surface>` (e.g. `vizier_rpc_relationships`,
  `vizier_rpc_jobs`). One mod per surface keeps each independently
  subscribable.
- **`legends_setup_check` install copy.** Currently the diagnostic
  prints "copy lua/rpc-legends.lua to hack/scripts/rpc/legends.lua".
  After Workshop ships, change the primary advice to "subscribe to the
  Vizier RPC – Legends bridge mod on Steam Workshop" with a Workshop
  URL, and keep the manual copy as the fallback for non-Steam users
  (Itch.io DF, Classic DF, builds without Workshop access).
- **Detecting which install path is in use.** The diagnostic could in
  principle check whether the script came from `scripts_modinstalled/`
  vs `hack/scripts/`, but DFHack doesn't expose script provenance over
  the wire. Probably not worth chasing.
- **Auto-update behaviour for the Vizier-MCP side.** When the script
  schema bumps, the user needs both the new script (Workshop auto-
  updates this) AND a Vizier MCP version that expects the new schema.
  If the orderings cross (user on old Vizier + new script, or vice
  versa), `legends_setup_check` should detect and explain. The schema
  field is already there — just needs the message text to be helpful.

## Decision

If we go ahead, the work is roughly:

1. `git mv lua/rpc-legends.lua mod/scripts_modinstalled/rpc/legends.lua`
2. Add `mod/info.txt` from the template above (without `STEAM_FILE_ID`).
3. Add a placeholder `mod/preview.png` and `mod/README.md`.
4. Update `UNLOCKING-LEGENDS.md` install section: Workshop primary,
   manual fallback.
5. Update `legends_setup_check`'s `installInstructions` copy in
   `src/tools/legends.ts` to recommend Workshop subscription first.
6. First upload (in DF) on next live-trial session; stamp
   `STEAM_FILE_ID` back into the repo.

Out of scope for this plan: any of the *other* RPC surfaces mentioned
in UNLOCKING-LEGENDS.md (jobs, mood, relationships). Each would be its
own mod by the convention above, ideally added after the legends mod
has lived long enough to surface any rough edges.
