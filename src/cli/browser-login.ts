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
  npm run browser:login -- --url <login-url>

Opens the project's persistent managed-Chrome profile. Log in manually; login
data remains available to later workflow runs.`);
    return;
  }

  await waitForInteractiveBrowser(
    readHttpUrl(values.url),
    "Log in manually, then close this browser before running a workflow.",
  );
}

main().catch((error: unknown) => {
  console.error(`Managed Chrome login failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
