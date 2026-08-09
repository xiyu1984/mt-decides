import { randomInt } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import {
  createAssistantClueTool,
  formatAssistantClues,
  loadWorkflowAssistant,
  updateWorkflowAssistant,
  type AssistantDefinition,
  type AssistantClue,
} from "../assistant/workflow-assistant.js";
import { startManagedChrome, type ManagedChrome } from "../computer-use/managed-chrome.js";
import { readHttpUrl } from "../computer-use/url.js";
import {
  resolveActionPause,
  resolveBrowserMode,
  resolveManagedProfileDir,
} from "../config/computer-use.js";
import { readOptionalWorkflowPromptFile, readWorkflowPromptFile } from "../prompts/loader.js";
import { renderPromptTemplate } from "../prompts/template.js";

const STATE_CHANGING_TOOLS = new Set(["act_ui", "navigate_browser"]);
const WORKFLOW_NAME = "run";
const ASSISTANT_CATEGORIES = ["navigation", "inputs", "outputs", "state", "barriers"] as const;

function resolveComputerUseExtension(): string {
  const require = createRequire(import.meta.url);
  const packageJson = require.resolve("@injaneity/pi-computer-use/package.json");
  return join(dirname(packageJson), "extensions", "computer-use.ts");
}

function assistantDefinition(startUrl: URL): AssistantDefinition {
  const fileSlug = startUrl.host
    .toLocaleLowerCase()
    .replace(/^www\./, "")
    .replace(/[^a-z0-9.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return {
    workflow: WORKFLOW_NAME,
    scope: startUrl.origin,
    fileSlug: fileSlug || "site",
    categories: ASSISTANT_CATEGORIES,
  };
}

function buildPrompt(
  cwd: string,
  task: string,
  startUrl: URL,
  browserMode: string,
  clues: AssistantClue[],
): string {
  const browserInstructions = browserMode === "managed"
    ? `The workflow already launched the start URL in managed Chrome. Call find_roots with app "Browser" and kind "browser_page", select the matching page, and reuse that root and its successor states. Do not call launch_browser.`
    : `Use the already-open Google Chrome window. Call find_roots with app "Google Chrome" and kind "window", identify the target window conservatively, and reuse that root and its successor states. Do not call launch_browser or navigate_browser.`;
  const definition = assistantDefinition(startUrl);
  const sitePrompt = readOptionalWorkflowPromptFile(
    cwd,
    WORKFLOW_NAME,
    "sites",
    `${definition.fileSlug}.md`,
  ) ?? readWorkflowPromptFile(cwd, WORKFLOW_NAME, "sites", "default.md");
  return renderPromptTemplate(readWorkflowPromptFile(cwd, WORKFLOW_NAME, "general.md"), {
    TASK: JSON.stringify(task),
    STARTING_URL: startUrl.toString(),
    SITE_ORIGIN: startUrl.origin,
    BROWSER_MODE: browserMode,
    CURRENT_TIME: new Date().toISOString(),
    BROWSER_INSTRUCTIONS: browserInstructions,
    SITE_PROMPT: sitePrompt,
    ASSISTANT_CLUES: formatAssistantClues(clues),
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      url: { type: "string", short: "u" },
      task: { type: "string", short: "t" },
      "browser-mode": { type: "string", short: "m" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(`Usage:
  npm run run -- --url <start-url> --task <business-task> [options]

Options:
  -u, --url            Initial HTTP(S) page.
  -t, --task           Plain-language workflow to execute.
  -m, --browser-mode   Override configured mode: managed or existing-app.
  -h, --help           Show this help.`);
    return;
  }

  const task = values.task?.trim();
  if (!task) throw new Error("--task is required");
  const cwd = process.cwd();
  const startUrl = readHttpUrl(values.url);
  const browserMode = resolveBrowserMode(cwd, values["browser-mode"]);
  const actionPause = resolveActionPause(cwd);
  const definition = assistantDefinition(startUrl);
  const workflowAssistant = await loadWorkflowAssistant(cwd, definition);
  console.error(`[assistant] loaded ${workflowAssistant.clues.length} clues for ${definition.scope}`);
  let assistantUpdatesAllowed = true;
  const assistantClueTool = createAssistantClueTool(
    definition,
    workflowAssistant.clues,
    () => assistantUpdatesAllowed,
  );
  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    additionalExtensionPaths: [resolveComputerUseExtension()],
    extensionFactories: [
      (pi) => {
        pi.on("tool_call", async (event) => {
          if (!actionPause.enabled || !STATE_CHANGING_TOOLS.has(event.toolName)) return undefined;
          const pauseMs = randomInt(actionPause.minMs, actionPause.maxMs + 1);
          if (pauseMs > 0) {
            console.error(`[safety] waiting ${pauseMs}ms before ${event.toolName}`);
            await sleep(pauseMs);
          }
          return undefined;
        });
      },
    ],
  });
  await resourceLoader.reload();

  const modelRuntime = await ModelRuntime.create();
  const llmApiKey = process.env.LLM_API_KEY?.trim();
  if (llmApiKey) {
    const provider = settingsManager.getDefaultProvider();
    if (!provider) throw new Error("defaultProvider is missing from .pi/settings.json");
    await modelRuntime.setRuntimeApiKey(provider, llmApiKey);
  }

  const { session, extensionsResult } = await createAgentSession({
    cwd,
    agentDir,
    sessionManager: SessionManager.inMemory(),
    settingsManager,
    modelRuntime,
    resourceLoader,
    noTools: "builtin",
    customTools: [assistantClueTool.tool],
  });
  if (extensionsResult.errors.length > 0) {
    session.dispose();
    throw new Error(`failed to load Pi extensions:\n${extensionsResult.errors.map(({ path, error }) => `${path}: ${error}`).join("\n")}`);
  }

  let managedChrome: ManagedChrome | undefined;
  const previousCdpPort = process.env.PI_COMPUTER_USE_CDP_PORT;
  let interrupted = false;
  const onInterrupt = (): void => {
    if (interrupted) process.exit(130);
    interrupted = true;
    assistantUpdatesAllowed = false;
    console.error("\nStopping agent… Press Ctrl+C again to force exit.");
    void session.abort();
  };
  process.on("SIGINT", onInterrupt);
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "tool_execution_start") console.error(`[tool] ${event.toolName}`);
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });

  try {
    if (browserMode === "managed") {
      managedChrome = await startManagedChrome(resolveManagedProfileDir(cwd), startUrl);
      process.env.PI_COMPUTER_USE_CDP_PORT = String(managedChrome.port);
    }
    await session.prompt(buildPrompt(cwd, task, startUrl, browserMode, workflowAssistant.clues));
    process.stdout.write("\n");
    if (interrupted) {
      process.exitCode = 130;
    } else {
      const update = await updateWorkflowAssistant(
        cwd,
        definition,
        assistantClueTool.getProposals(),
        assistantClueTool.getVerificationTopics(),
      );
      console.error(`[assistant] saved ${update.assistantPath} (${update.addedCount} added, ${update.verifiedCount} verified)`);
      if (update.conflictPath) {
        console.error(`[assistant] rejected ${update.conflictCount} conflict(s); review ${update.conflictPath}`);
      }
    }
  } finally {
    process.off("SIGINT", onInterrupt);
    unsubscribe();
    session.dispose();
    if (previousCdpPort === undefined) delete process.env.PI_COMPUTER_USE_CDP_PORT;
    else process.env.PI_COMPUTER_USE_CDP_PORT = previousCdpPort;
    await managedChrome?.stop();
  }
}

main().catch((error: unknown) => {
  console.error(`Workflow failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
