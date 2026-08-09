import { parseArgs } from "node:util";

import { waitForInteractiveBrowser } from "../computer-use/interactive-browser.js";
import { readHttpUrl } from "../computer-use/url.js";

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      url: { type: "string", short: "u" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    console.log(`Usage:
  npm run check -- --url <page-url>

Opens a page in the persistent managed-Chrome profile for manual inspection.
No agent or LLM is started.`);
    return;
  }

  await waitForInteractiveBrowser(
    readHttpUrl(values.url),
    "Inspect the page manually.",
  );
}

main().catch((error: unknown) => {
  console.error(`Page check failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
