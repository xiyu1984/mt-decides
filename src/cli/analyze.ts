import { parseArgs } from "node:util";

import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";

import { readWorkflowPromptFile } from "../prompts/loader.js";
import { renderPromptTemplate } from "../prompts/template.js";
import { tomorrowLocalDate } from "../promotion/date.js";
import { writePromotionDecision } from "../promotion/decisions.js";
import { loadPromotionHistory } from "../promotion/history-data.js";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      "data-dir": { type: "string", short: "d", default: "resources/data" },
      "decisions-dir": { type: "string", default: "decisions" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(`Usage:
  npm run analyze -- [options]

Options:
  -d, --data-dir       Runtime LLM history directory (default: resources/data).
      --decisions-dir  Output directory (default: decisions).
  -h, --help           Show this help.

Analyzes history without computer use and writes tomorrow's plan to
<decisions-dir>/YYYY-MM-DD.md.`);
    return;
  }

  const cwd = process.cwd();
  const now = new Date();
  const planDate = tomorrowLocalDate(now);
  const history = await loadPromotionHistory(cwd, values["data-dir"]);
  console.error(`[history] loaded ${history.fileCount} files (${history.spreadsheetCount} spreadsheets, ${history.imageCount} images)`);

  const agentDir = getAgentDir();
  const settingsManager = SettingsManager.create(cwd, agentDir, { projectTrusted: true });
  const resourceLoader = new DefaultResourceLoader({ cwd, agentDir });
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
    noTools: "all",
  });
  if (extensionsResult.errors.length > 0) {
    session.dispose();
    throw new Error(`failed to load Pi extensions:\n${extensionsResult.errors.map(({ path, error }) => `${path}: ${error}`).join("\n")}`);
  }

  let assistantText = "";
  const unsubscribe = session.subscribe((event) => {
    if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
      assistantText += event.assistantMessageEvent.delta;
      process.stdout.write(event.assistantMessageEvent.delta);
    }
  });
  try {
    const prompt = renderPromptTemplate(readWorkflowPromptFile(cwd, "analyze", "general.md"), {
      CURRENT_TIME: now.toISOString(),
      PLAN_DATE: planDate,
      HISTORY_SUMMARY: `${history.fileCount} files (${history.spreadsheetCount} spreadsheets and ${history.imageCount} images)`,
      HISTORY_DATA: history.text,
    });
    await session.prompt(prompt, { images: history.images });
    process.stdout.write("\n");
    const path = await writePromotionDecision(cwd, values["decisions-dir"], planDate, assistantText);
    console.error(`[decision] saved ${path}`);
  } finally {
    unsubscribe();
    session.dispose();
  }
}

main().catch((error: unknown) => {
  console.error(`Analysis failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
