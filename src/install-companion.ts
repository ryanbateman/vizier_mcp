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

Auto-detection looks for 'hack/lua/rpc/' under each of:
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
  for (const candidate of steamCandidates()) {
    if (existsSync(join(candidate, "hack", "lua", "rpc"))) return candidate;
  }
  return null;
}

interface ResolvedPaths {
  source: string;
  destination: string;
}

function resolvePaths(df: string): ResolvedPaths {
  // Bundled lua file: <package>/lua/rpc/legends.lua. From build/install-companion.js,
  // that's one directory up plus 'lua/rpc/legends.lua'. Same trick the VERSION
  // read in src/index.ts uses to find package.json.
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  const source = resolve(moduleDir, "../lua/rpc/legends.lua");
  const destination = resolve(df, "hack/lua/rpc/legends.lua");
  return { source, destination };
}

function validateDfInstall(df: string): void {
  if (!existsSync(df)) {
    throw new Error(`DF install path does not exist: ${df}`);
  }
  const luaRpc = join(df, "hack", "lua", "rpc");
  if (!existsSync(luaRpc)) {
    throw new Error(
      `not a DFHack-having install: ${df}\n` +
        `  expected ${luaRpc} to exist. Confirm DFHack is installed at this path.`,
    );
  }
  const stats = statSync(luaRpc);
  if (!stats.isDirectory()) {
    throw new Error(`${luaRpc} exists but is not a directory.`);
  }
}

export interface InstallResult {
  source: string;
  destination: string;
  overwrote: boolean;
  dryRun: boolean;
}

export function install(
  df: string,
  options: { dryRun?: boolean; force?: boolean } = {},
): InstallResult {
  validateDfInstall(df);
  const { source, destination } = resolvePaths(df);
  if (!existsSync(source)) {
    throw new Error(
      `bundled companion script not found at ${source}.\n` +
        `  if you're running from source, this is expected — install via npm publish flow.`,
    );
  }
  const overwrote = existsSync(destination);
  if (overwrote && !options.force && !options.dryRun) {
    throw new Error(
      `${destination} already exists.\n` +
        `  pass --force to overwrite, or remove the existing file manually.`,
    );
  }
  if (options.dryRun) {
    return { source, destination, overwrote, dryRun: true };
  }
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  return { source, destination, overwrote, dryRun: false };
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
      console.log(`[dry-run] would copy:`);
      console.log(`  source:      ${result.source}`);
      console.log(`  destination: ${result.destination}`);
      console.log(
        `  overwrite:   ${result.overwrote ? "yes (--force required for real run)" : "no"}`,
      );
      return;
    }
    console.log(
      `Installed ${result.destination}` +
        (result.overwrote ? " (overwrote existing)" : ""),
    );
    console.log(
      `Restart DFHack so the module loads, or in the DFHack console:`,
    );
    console.log(
      `  :lua package.loaded['rpc.legends']=nil; require('rpc.legends')`,
    );
    console.log(
      `Then call legends_setup_check from your MCP client to confirm.`,
    );
  } catch (err) {
    console.error(
      `install-companion: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}
