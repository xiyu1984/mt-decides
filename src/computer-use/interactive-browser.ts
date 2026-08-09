import { startManagedChrome } from "./managed-chrome.js";
import { resolveManagedProfileDir } from "../config/computer-use.js";

export async function waitForInteractiveBrowser(url: URL, purpose: string): Promise<void> {
  const browser = await startManagedChrome(resolveManagedProfileDir(process.cwd()), url);
  console.log(`Opened: ${url.toString()}`);
  console.log(`Managed Chrome profile: ${browser.profileDir}`);
  console.log(`${purpose} Press Ctrl+C or close the managed Chrome window when done.`);

  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    void browser.stop();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await browser.exited;
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await browser.stop();
  }
}
