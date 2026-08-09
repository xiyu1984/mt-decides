import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

export type BrowserMode = "existing-app" | "managed";

export type ActionPauseConfig = {
  enabled: boolean;
  minMs: number;
  maxMs: number;
};

const DEFAULT_BROWSER_MODE: BrowserMode = "managed";
const DEFAULT_MANAGED_PROFILE_DIR = join("var", "browser-profiles", "default");
const DEFAULT_ACTION_PAUSE: ActionPauseConfig = { enabled: true, minMs: 800, maxMs: 2_000 };
const MAX_ACTION_PAUSE_MS = 60_000;

type ProjectComputerUseConfig = Record<string, unknown>;

function readProjectConfig(cwd: string): ProjectComputerUseConfig {
  const configPath = join(cwd, ".pi", "computer-use.json");
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
    if (code === "ENOENT") return {};
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`cannot read ${configPath}: ${message}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${configPath} must contain a JSON object`);
  }
  return parsed as ProjectComputerUseConfig;
}

function parseBrowserMode(value: unknown, source: string): BrowserMode {
  if (value === "existing-app" || value === "managed") return value;
  throw new Error(`${source} must be existing-app or managed`);
}

export function resolveBrowserMode(cwd: string, override?: string): BrowserMode {
  if (override !== undefined) return parseBrowserMode(override, "--browser-mode");
  const configured = readProjectConfig(cwd).browser_mode;
  if (configured === undefined) return DEFAULT_BROWSER_MODE;
  return parseBrowserMode(configured, ".pi/computer-use.json browser_mode");
}

export function resolveActionPause(cwd: string): ActionPauseConfig {
  const configured = readProjectConfig(cwd).action_pause;
  if (configured === undefined) return { ...DEFAULT_ACTION_PAUSE };
  if (!configured || typeof configured !== "object" || Array.isArray(configured)) {
    throw new Error(".pi/computer-use.json action_pause must be an object");
  }

  const values = configured as Record<string, unknown>;
  const enabled = values.enabled ?? DEFAULT_ACTION_PAUSE.enabled;
  const minMs = values.min_ms ?? DEFAULT_ACTION_PAUSE.minMs;
  const maxMs = values.max_ms ?? DEFAULT_ACTION_PAUSE.maxMs;

  if (typeof enabled !== "boolean") {
    throw new Error(".pi/computer-use.json action_pause.enabled must be a boolean");
  }
  if (!Number.isInteger(minMs) || (minMs as number) < 0 || (minMs as number) > MAX_ACTION_PAUSE_MS) {
    throw new Error(`.pi/computer-use.json action_pause.min_ms must be an integer between 0 and ${MAX_ACTION_PAUSE_MS}`);
  }
  if (!Number.isInteger(maxMs) || (maxMs as number) < 0 || (maxMs as number) > MAX_ACTION_PAUSE_MS) {
    throw new Error(`.pi/computer-use.json action_pause.max_ms must be an integer between 0 and ${MAX_ACTION_PAUSE_MS}`);
  }
  if ((maxMs as number) < (minMs as number)) {
    throw new Error(".pi/computer-use.json action_pause.max_ms must be greater than or equal to min_ms");
  }
  return { enabled, minMs: minMs as number, maxMs: maxMs as number };
}

export function resolveManagedProfileDir(cwd: string): string {
  const configured = readProjectConfig(cwd).managed_profile_dir;
  if (configured !== undefined && (typeof configured !== "string" || !configured.trim())) {
    throw new Error(".pi/computer-use.json managed_profile_dir must be a non-empty path");
  }

  const value = typeof configured === "string" ? configured.trim() : DEFAULT_MANAGED_PROFILE_DIR;
  const profileDir = isAbsolute(value) ? value : resolve(cwd, value);
  const ordinaryProfileRoots = process.platform === "darwin"
    ? [join(homedir(), "Library", "Application Support", "Google", "Chrome")]
    : process.platform === "win32"
      ? [process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google", "Chrome", "User Data")]
          .filter((path): path is string => Boolean(path))
      : [join(homedir(), ".config", "google-chrome"), join(homedir(), ".config", "chromium")];

  for (const ordinaryRoot of ordinaryProfileRoots) {
    const relation = relative(ordinaryRoot, profileDir);
    if (relation === "" || (!relation.startsWith("..") && !isAbsolute(relation))) {
      throw new Error("managed_profile_dir must not be the ordinary Chrome profile or a directory inside it");
    }
  }
  return profileDir;
}
