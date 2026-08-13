import { randomInt } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { parseArgs } from "node:util";

import {
  createAgentSession,
  DefaultResourceLoader,
  defineTool,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

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
import { formatLocalDate, validateDate } from "../promotion/date.js";
import { readPromotionDecision } from "../promotion/decisions.js";
import { assertPromotionRunReady } from "../promotion/review-readiness.js";

const STATE_CHANGING_TOOLS = new Set(["act_ui", "evaluate_browser", "navigate_browser"]);
const WORKFLOW_NAME = "promotion";
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
  startUrl: URL,
  browserMode: string,
  planDate: string,
  decision: string,
  clues: AssistantClue[],
  assistantAutoUpdate: "false" | undefined,
  now = new Date(),
): string {
  const browserInstructions = browserMode === "managed"
    ? `The workflow already launched the start URL in managed Chrome and connected it through CDP. Do not call launch_browser. Call find_roots with app "Browser" and kind "browser_page", select the page whose URL matches the configured site, and reuse that CDP root and its successor states. Remain on browser_page states for the whole workflow: do not select a native Chrome window and do not use desktop coordinates. CDP observation and actions work while Chrome is behind other windows.`
    : `Use the already-open Google Chrome window. Call find_roots with app "Google Chrome" and kind "window", identify the target window conservatively, and reuse that root and its successor states. Do not call launch_browser or navigate_browser.`;
  const definition = assistantDefinition(startUrl);
  const sitePrompt = readOptionalWorkflowPromptFile(
    cwd,
    WORKFLOW_NAME,
    "sites",
    `${definition.fileSlug}.md`,
  ) ?? readWorkflowPromptFile(cwd, WORKFLOW_NAME, "sites", "default.md");
  return renderPromptTemplate(readWorkflowPromptFile(cwd, WORKFLOW_NAME, "general.md"), {
    STARTING_URL: startUrl.toString(),
    SITE_ORIGIN: startUrl.origin,
    BROWSER_MODE: browserMode,
    CURRENT_TIME: now.toISOString(),
    PLAN_DATE: planDate,
    BROWSER_INSTRUCTIONS: browserInstructions,
    SITE_PROMPT: sitePrompt,
    PROMOTION_DECISION: decision,
    ASSISTANT_CLUES: formatAssistantClues(clues, assistantAutoUpdate),
  });
}

async function waitForReview(managedChrome: ManagedChrome | undefined): Promise<void> {
  await new Promise<void>((resolveWait) => {
    let completed = false;
    const finish = (): void => {
      if (completed) return;
      completed = true;
      process.off("SIGINT", finish);
      process.off("SIGTERM", finish);
      resolveWait();
    };
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
    void managedChrome?.exited.then(finish);
  });
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      url: { type: "string", short: "u" },
      date: { type: "string" },
      "decisions-dir": { type: "string", default: "decisions" },
      "browser-mode": { type: "string", short: "m" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(`Usage:
  npm run promotion -- --url <start-url> [options]

Options:
  -u, --url            Initial HTTP(S) page.
      --date           Decision date, YYYY-MM-DD (default: today).
      --decisions-dir  Decision directory (default: decisions).
  -m, --browser-mode   Override configured mode: managed or existing-app.
  -h, --help           Show this help.

The workflow fills today's standard-promotion settings and stops before
"立即创建". Close managed Chrome or press Ctrl+C after reviewing the form.`);
    return;
  }

  const cwd = process.cwd();
  const startUrl = readHttpUrl(values.url);
  const browserMode = resolveBrowserMode(cwd, values["browser-mode"]);
  const actionPause = resolveActionPause(cwd);
  const planDate = values.date === undefined ? formatLocalDate(new Date()) : validateDate(values.date);
  const decision = await readPromotionDecision(cwd, values["decisions-dir"], planDate);
  console.error(`[decision] loaded ${planDate} from ${values["decisions-dir"]}`);

  const definition = assistantDefinition(startUrl);
  const workflowAssistant = await loadWorkflowAssistant(cwd, definition);
  console.error(`[assistant] loaded ${workflowAssistant.clues.length} clues for ${definition.scope}`);
  let assistantUpdatesAllowed = true;
  const assistantClueTool = createAssistantClueTool(
    definition,
    workflowAssistant.clues,
    () => assistantUpdatesAllowed,
    workflowAssistant["auto-update"],
  );
  let stateChangingToolCount = 0;
  let reviewMarkedReady = false;
  const reviewReadyTool = defineTool({
    name: "mark_promotion_ready_for_review",
    label: "Mark promotion ready for review",
    description: "Mark the draft ready only after all settings have been filled and reverified and 立即创建 has not been activated.",
    parameters: Type.Object({
      settingsSummary: Type.String({ minLength: 1, maxLength: 4_000 }),
    }),
    execute: async (_toolCallId, input) => {
      if (reviewMarkedReady) throw new Error("promotion has already been marked ready for review");
      if (stateChangingToolCount === 0) {
        throw new Error("cannot mark the promotion ready before performing browser actions");
      }
      reviewMarkedReady = true;
      return {
        content: [{
          type: "text",
          text: "Promotion draft marked ready for human review. Keep the form open and do not activate 立即创建.",
        }],
        details: { settingsSummary: input.settingsSummary },
      };
    },
  });
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
    customTools: [assistantClueTool.tool, reviewReadyTool],
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
  process.on("SIGTERM", onInterrupt);
  let assistantError: string | undefined;
  let assistantText = "";
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "tool_execution_start") {
      console.error(`[tool] ${event.toolName}`);
    }
    if (
      event.type === "tool_execution_end"
      && STATE_CHANGING_TOOLS.has(event.toolName)
      && !event.isError
    ) {
      stateChangingToolCount += 1;
    }
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      assistantText += event.assistantMessageEvent.delta;
      process.stdout.write(event.assistantMessageEvent.delta);
    }
    if (event.type === "message_update" && event.assistantMessageEvent.type === "error") {
      assistantError = event.assistantMessageEvent.error.errorMessage
        ?? `provider stopped with ${event.assistantMessageEvent.reason}`;
      console.error(`[llm] ${assistantError}`);
    }
    if (event.type === "message_update" && event.assistantMessageEvent.type === "done") {
      assistantError = undefined;
    }
  });

  try {
    if (browserMode === "managed") {
      managedChrome = await startManagedChrome(resolveManagedProfileDir(cwd), startUrl);
      process.env.PI_COMPUTER_USE_CDP_PORT = String(managedChrome.port);
    }
    await session.prompt(buildPrompt(
      cwd,
      startUrl,
      browserMode,
      planDate,
      decision,
      workflowAssistant.clues,
      workflowAssistant["auto-update"],
    ));
    process.stdout.write("\n");
    if (interrupted) {
      process.exitCode = 130;
      return;
    }

    const lastAssistant = [...session.messages]
      .reverse()
      .find((message) => message.role === "assistant");
    const finalAssistant = lastAssistant?.role === "assistant" ? lastAssistant : undefined;
    const assistantDiagnostics = (finalAssistant?.diagnostics ?? []).map((diagnostic) => {
      const code = diagnostic.error?.code === undefined ? "" : ` code=${diagnostic.error.code}`;
      const message = diagnostic.error?.message ? ` ${diagnostic.error.message}` : "";
      return `${diagnostic.type}${code}${message}`;
    });
    assertPromotionRunReady({
      assistantError: finalAssistant?.errorMessage ?? assistantError,
      assistantStopReason: finalAssistant?.stopReason,
      assistantRawStopReason: finalAssistant?.rawStopReason,
      assistantProvider: finalAssistant?.provider,
      assistantModel: finalAssistant?.model,
      assistantApi: finalAssistant?.api,
      assistantDiagnostics,
      assistantText,
      stateChangingToolCount,
      reviewMarkedReady,
    });

    assistantUpdatesAllowed = false;
    const update = await updateWorkflowAssistant(
      cwd,
      definition,
      assistantClueTool.getProposals(),
      assistantClueTool.getVerificationTopics(),
    );
    if (update.locked) {
      console.error(`[assistant] kept locked ${update.assistantPath} unchanged (${update.conflictCount} conflict(s))`);
    } else {
      console.error(`[assistant] saved ${update.assistantPath} (${update.addedCount} added, ${update.verifiedCount} verified)`);
    }
    if (update.conflictPath) {
      console.error(`[assistant] rejected ${update.conflictCount} conflict(s); review ${update.conflictPath}`);
    }

    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
    console.error('[review] Settings are complete and "立即创建" was not clicked. Review the open form, then close Chrome or press Ctrl+C to quit.');
    await waitForReview(managedChrome);
  } finally {
    process.off("SIGINT", onInterrupt);
    process.off("SIGTERM", onInterrupt);
    unsubscribe();
    session.dispose();
    if (previousCdpPort === undefined) delete process.env.PI_COMPUTER_USE_CDP_PORT;
    else process.env.PI_COMPUTER_USE_CDP_PORT = previousCdpPort;
    await managedChrome?.stop();
  }
}

main().catch((error: unknown) => {
  console.error(`Promotion failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
