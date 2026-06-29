// install-companion: optional CLI subcommand that copies the bundled
// rpc.legends Lua module into the user's DFHack install. The MCP server
// itself runs without this — only the legends_* tools require the
// companion script, and each surfaces a structured "missing" hint when
// it isn't present. This CLI is a convenience over manual `cp`.
//
// Usage:
//   npx @ryanbateman/vizier-mcp install-companion [--df=<path>] [--dry-run] [--force]
//
// If --df is omitted, the CLI tries the standard Steam install path for
// the host platform. Non-Steam DF installs must pass --df explicitly.

import {
  existsSync,
  mkdirSync,
  copyFileSync,
  statSync,
  readdirSync,
} from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { homedir, platform } from "os";

interface ParsedArgs {
  df?: string;
  dryRun: boolean;
  force: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { dryRun: false, force: false, help: false };
  for (const arg of argv) {
    if (arg === "--dry-run") out.dryRun = true;
    else if (arg === "--force") out.force = true;
    else if (arg === "--help" || arg === "-h") out.help = true;
    else if (arg.startsWith("--dfhack=")) out.df = arg.slice("--dfhack=".length);
    else if (arg === "--dfhack") {
      throw new Error(
        "use --dfhack=<path> (= form). Space-separated --dfhack <path> is not supported.",
      );
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return out;
}

const HELP = `vizier-mcp install-companion

Copies the bundled rpc.legends Lua module into a DFHack install so the
optional Vizier legends tools (dwarf_biography, living_legends,
describe_site, ...) become reachable. The rest of Vizier works without
this — install only if you want the legends tool family.

Options:
  --dfhack=<path>  Path to the DFHack root (the directory containing
                   the 'hack/' subdirectory). On Steam, DFHack ships as
                   a separate steamapps/common/DFHack/ folder; on a
                   manual install it lives inside the DF install dir.
                   Auto-detected on Linux/macOS/Windows if omitted.
  --dry-run        Print the source + destination paths without writing.
  --force          Overwrite an existing legends.lua without prompting.
  --help, -h       Show this message.

Auto-detection looks for 'hack/lua/' under each of:
  Linux Steam:    ~/.local/share/Steam/steamapps/common/DFHack
                  ~/.local/share/Steam/steamapps/common/Dwarf Fortress
  macOS Steam:    ~/Library/Application Support/Steam/steamapps/common/DFHack
                  ~/Library/Application Support/Steam/steamapps/common/Dwarf Fortress
  Windows Steam:  %PROGRAMFILES(X86)%/Steam/steamapps/common/DFHack
                  %PROGRAMFILES(X86)%/Steam/steamapps/common/Dwarf Fortress
                  and the same under D:/, E:/, F:/Steam and SteamLibrary

After install, restart DFHack (or run the following in the DFHack
console:  :lua package.loaded['rpc.legends']=nil; require('rpc.legends'))
so the module is loaded into the running game.
`;

function steamCandidates(): string[] {
  const home = homedir();
  // On Steam, DFHack ships as its own steamapps/common/DFHack/ folder
  // (the launcher hooks into DF at startup). DFHack is also valid when
  // installed inside the DF directory (manual installs). Try both in
  // both orders — DFHack-root first since the Steam path is canonical.
  const subdirs = ["DFHack", "Dwarf Fortress"];
  switch (platform()) {
    case "linux":
      return subdirs.map((s) =>
        join(home, ".local/share/Steam/steamapps/common", s),
      );
    case "darwin":
      return subdirs.map((s) =>
        join(home, "Library/Application Support/Steam/steamapps/common", s),
      );
    case "win32": {
      const candidates: string[] = [];
      const roots: string[] = [];
      const programFiles86 = process.env["PROGRAMFILES(X86)"];
      const programFiles = process.env["PROGRAMFILES"];
      if (programFiles86) roots.push(join(programFiles86, "Steam"));
      if (programFiles) roots.push(join(programFiles, "Steam"));
      for (const drive of ["D:", "E:", "F:"]) {
        roots.push(join(drive, "Steam"));
        roots.push(join(drive, "SteamLibrary"));
      }
      for (const root of roots) {
        for (const sub of subdirs) {
          candidates.push(join(root, "steamapps", "common", sub));
        }
      }
      return candidates;
    }
    default:
      return [];
  }
}

function detectDfInstall(): string | null {
  // Anchor on hack/lua (always present in a DFHack install). hack/lua/rpc
  // may not exist yet on a fresh DFHack with no rpc.* modules installed —
  // install() creates it.
  for (const candidate of steamCandidates()) {
    if (existsSync(join(candidate, "hack", "lua"))) return candidate;
  }
  return null;
}

// Bundled companion dir: <package>/lua/rpc/. From build/install-companion.js
// that's one directory up plus 'lua/rpc'. Same trick the VERSION read in
// src/index.ts uses to find package.json.
function bundledLuaDir(): string {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return resolve(moduleDir, "../lua/rpc");
}

// Every *.lua file shipped in the bundled lua/rpc/ directory (legends.lua,
// jobs.lua, and any future companion). Sorted for deterministic output.
function bundledLuaFiles(): string[] {
  const dir = bundledLuaDir();
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".lua"))
    .sort();
}

function validateDfInstall(df: string): void {
  if (!existsSync(df)) {
    throw new Error(`DF install path does not exist: ${df}`);
  }
  // hack/lua is the stable anchor; hack/lua/rpc is created on install if it
  // doesn't exist yet (fresh DFHack with no rpc.* modules).
  const luaDir = join(df, "hack", "lua");
  if (!existsSync(luaDir)) {
    throw new Error(
      `not a DFHack-having install: ${df}\n` +
        `  expected ${luaDir} to exist. Confirm DFHack is installed at this path.`,
    );
  }
  const stats = statSync(luaDir);
  if (!stats.isDirectory()) {
    throw new Error(`${luaDir} exists but is not a directory.`);
  }
}

export interface InstalledFile {
  name: string;
  source: string;
  destination: string;
  overwrote: boolean;
}

export interface InstallResult {
  files: InstalledFile[];
  dryRun: boolean;
}

export function install(
  df: string,
  options: { dryRun?: boolean; force?: boolean } = {},
): InstallResult {
  validateDfInstall(df);
  const srcDir = bundledLuaDir();
  const names = bundledLuaFiles();
  if (names.length === 0) {
    throw new Error(
      `no bundled companion scripts found under ${srcDir}.\n` +
        `  if you're running from source, this is expected — install via npm publish flow.`,
    );
  }

  const destDir = resolve(df, "hack/lua/rpc");
  const files: InstalledFile[] = names.map((name) => ({
    name,
    source: join(srcDir, name),
    destination: join(destDir, name),
    overwrote: existsSync(join(destDir, name)),
  }));

  // Refuse the whole operation if any target exists and --force wasn't given,
  // so a partial install can't leave a mix of old and new companions.
  const existing = files.filter((f) => f.overwrote);
  if (existing.length > 0 && !options.force && !options.dryRun) {
    throw new Error(
      `${existing.map((f) => f.destination).join(", ")} already exists.\n` +
        `  pass --force to overwrite, or remove the existing file(s) manually.`,
    );
  }

  if (options.dryRun) {
    return { files, dryRun: true };
  }

  mkdirSync(destDir, { recursive: true });
  for (const f of files) copyFileSync(f.source, f.destination);
  return { files, dryRun: false };
}

export async function run(argv: string[]): Promise<void> {
  let args: ParsedArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(
      `install-companion: ${err instanceof Error ? err.message : String(err)}`,
    );
    console.error(`\n${HELP}`);
    process.exit(2);
    return;
  }

  if (args.help) {
    console.log(HELP);
    return;
  }

  let df = args.df;
  if (!df) {
    const detected = detectDfInstall();
    if (!detected) {
      console.error(
        "install-companion: could not auto-detect a DFHack install.\n" +
          "  Pass --df=<path> to point at your Dwarf Fortress directory.\n" +
          "  See --help for the paths auto-detection looks at.",
      );
      process.exit(1);
      return;
    }
    df = detected;
  }

  try {
    const result = install(df, { dryRun: args.dryRun, force: args.force });
    if (result.dryRun) {
      console.log(`[dry-run] would copy ${result.files.length} companion file(s):`);
      for (const f of result.files) {
        console.log(`  ${f.source}`);
        console.log(`    -> ${f.destination}` + (f.overwrote ? " (exists; --force required)" : ""));
      }
      return;
    }
    for (const f of result.files) {
      console.log(
        `Installed ${f.destination}` + (f.overwrote ? " (overwrote existing)" : ""),
      );
    }
    const modules = result.files.map((f) => `rpc.${f.name.replace(/\.lua$/, "")}`);
    console.log(
      `Restart DFHack so the modules load, or in the DFHack console:`,
    );
    for (const m of modules) {
      console.log(`  :lua package.loaded['${m}']=nil; require('${m}')`);
    }
    console.log(
      `Then call legends_setup_check / jobs_setup_check from your MCP client to confirm.`,
    );
  } catch (err) {
    console.error(
      `install-companion: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}
