import { constants as fsConstants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

const START_TIMEOUT_MS = 15_000;
const STOP_TIMEOUT_MS = 5_000;
const CDP_REQUEST_TIMEOUT_MS = 5_000;

export type ManagedChromeTab = {
  targetId: string;
  title: string;
  url: string;
};

export type ManagedChrome = {
  pid: number;
  port: number;
  profileDir: string;
  exited: Promise<void>;
  openTab(url: URL): Promise<ManagedChromeTab>;
  closeTab(targetId: string): Promise<void>;
  closeOwnedTabs(): Promise<void>;
  stop(): Promise<void>;
};

type CdpPageTarget = { id?: unknown; type?: unknown; title?: unknown; url?: unknown };

async function cdpRequest(port: number, path: string, method = "GET"): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    signal: AbortSignal.timeout(CDP_REQUEST_TIMEOUT_MS),
  });
}

function executableCandidates(): string[] {
  const configured = process.env.PI_COMPUTER_USE_CHROME_EXECUTABLE?.trim();
  if (configured) return [resolve(configured)];

  const platformCandidates = process.platform === "darwin"
    ? [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        join(homedir(), "Applications", "Google Chrome.app", "Contents", "MacOS", "Google Chrome"),
      ]
    : process.platform === "win32"
      ? [
          process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe"),
          process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, "Google", "Chrome", "Application", "chrome.exe"),
          process.env["PROGRAMFILES(X86)"] && join(process.env["PROGRAMFILES(X86)"], "Google", "Chrome", "Application", "chrome.exe"),
        ]
      : ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  const pathNames = process.platform === "win32"
    ? ["chrome.exe"]
    : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
  const pathCandidates = (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .flatMap((directory) => pathNames.map((name) => join(directory, name)));
  return [...new Set([...platformCandidates.filter((value): value is string => Boolean(value)), ...pathCandidates])];
}

async function findExecutable(): Promise<string> {
  for (const candidate of executableCandidates()) {
    try {
      await access(candidate, fsConstants.X_OK);
      return candidate;
    } catch {
      // Try the next platform-specific location.
    }
  }
  throw new Error("Google Chrome was not found; set PI_COMPUTER_USE_CHROME_EXECUTABLE to its executable path");
}

async function freePort(): Promise<number> {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => port > 0 ? resolvePort(port) : reject(new Error("could not allocate a CDP port")));
    });
  });
}

async function waitUntilReady(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`managed Chrome exited before CDP became ready (exit ${child.exitCode})`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`, {
        signal: AbortSignal.timeout(500),
      });
      if (response.ok) return;
    } catch {
      // Chrome is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 200));
  }
  throw new Error("managed Chrome did not start; close any browser using the configured profile and try again");
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise((resolveExit) => child.once("exit", () => resolveExit()));
}

export async function startManagedChrome(profileDir: string, url: URL): Promise<ManagedChrome> {
  const executable = await findExecutable();
  const port = await freePort();
  await mkdir(profileDir, { recursive: true });
  const child = spawn(executable, [
    `--remote-debugging-port=${port}`,
    "--remote-debugging-address=127.0.0.1",
    `--user-data-dir=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    url.toString(),
  ], { stdio: "ignore" });
  if (child.pid === undefined) throw new Error("managed Chrome started without a process id");
  const exited = waitForExit(child);

  try {
    await waitUntilReady(port, child);
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }

  let stopped = false;
  const ownedTabIds = new Set<string>();
  const closeTab = async (targetId: string): Promise<void> => {
    if (!ownedTabIds.has(targetId)) {
      throw new Error("refusing to close a Chrome tab not owned by this run");
    }
    const response = await cdpRequest(port, `/json/close/${encodeURIComponent(targetId)}`);
    if (!response.ok && response.status !== 404) {
      throw new Error(`managed Chrome could not close its owned tab (HTTP ${response.status})`);
    }
    ownedTabIds.delete(targetId);
  };

  return {
    pid: child.pid,
    port,
    profileDir,
    exited,
    async openTab(url: URL): Promise<ManagedChromeTab> {
      if (stopped || child.exitCode !== null) throw new Error("managed Chrome is not running");
      if (url.protocol !== "http:" && url.protocol !== "https:") {
        throw new Error("managed Chrome tabs require an HTTP(S) URL");
      }
      const response = await cdpRequest(port, `/json/new?${encodeURIComponent(url.toString())}`, "PUT");
      if (!response.ok) throw new Error(`managed Chrome could not open an owned tab (HTTP ${response.status})`);
      const target = (await response.json()) as CdpPageTarget;
      if (typeof target.id !== "string" || target.type !== "page") {
        throw new Error("managed Chrome returned an invalid tab target");
      }
      ownedTabIds.add(target.id);
      return {
        targetId: target.id,
        title: typeof target.title === "string" ? target.title : "",
        url: url.toString(),
      };
    },
    closeTab,
    async closeOwnedTabs(): Promise<void> {
      const failures: unknown[] = [];
      for (const targetId of [...ownedTabIds]) {
        try {
          await closeTab(targetId);
        } catch (error) {
          failures.push(error);
        }
      }
      if (failures.length > 0) throw new AggregateError(failures, "could not close every owned Chrome tab");
    },
    async stop(): Promise<void> {
      if (stopped || child.exitCode !== null) return;
      stopped = true;
      child.kill("SIGTERM");
      const completed = await Promise.race([
        exited.then(() => true),
        new Promise<false>((resolveTimeout) => setTimeout(() => resolveTimeout(false), STOP_TIMEOUT_MS)),
      ]);
      if (!completed && child.exitCode === null) child.kill("SIGKILL");
      await exited;
    },
  };
}
