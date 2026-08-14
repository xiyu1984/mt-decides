type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : undefined;
}

function finiteInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

function textContent(result: unknown): string {
  const content = record(result)?.content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => record(part))
    .filter((part) => part?.type === "text" && typeof part.text === "string")
    .map((part) => part!.text as string)
    .join("\n");
}

function errorClass(result: unknown): string | undefined {
  const details = record(record(result)?.details);
  const execution = record(details?.execution);
  const structuredCode = record(execution?.error)?.code ?? record(details?.error)?.code;
  if (typeof structuredCode === "string" && /^[a-z0-9_-]{1,80}$/i.test(structuredCode)) {
    return structuredCode;
  }

  const message = textContent(result).toLocaleLowerCase();
  if (/stale|latest state|different window/.test(message)) return "stale-state";
  if (/postcondition|condition.*not.*satisf/.test(message)) return "postcondition-failed";
  if (/timed? out|timeout/.test(message)) return "timeout";
  if (/no longer available|unavailable|no current controlled/.test(message)) return "target-unavailable";
  if (/requires|must |invalid|does not support/.test(message)) return "invalid-input";
  return undefined;
}

export function formatToolStart(toolName: string, args: unknown): string {
  const input = record(args);
  const fields = [`[tool] ${toolName}`];

  if (toolName === "act_ui" && Array.isArray(input?.actions)) {
    const actionTypes = input.actions
      .map((action) => record(action)?.action)
      .filter((action): action is string => typeof action === "string");
    fields.push(`actions=${input.actions.length}`);
    if (actionTypes.length > 0) fields.push(`types=${actionTypes.join(",")}`);
  } else if (toolName === "observe_ui" && typeof input?.mode === "string") {
    fields.push(`mode=${input.mode}`);
  } else if (toolName === "search_ui") {
    const filters = ["text", "role", "capability"].filter((key) => input?.[key] !== undefined);
    if (filters.length > 0) fields.push(`filters=${filters.join(",")}`);
  } else if (toolName === "evaluate_browser" && typeof input?.expression === "string") {
    fields.push(`expressionChars=${input.expression.length}`);
  }

  return fields.join(" ");
}

export function formatToolCompletion(
  toolName: string,
  result: unknown,
  isError: boolean,
  elapsedMs: number,
): string {
  const details = record(record(result)?.details);
  const execution = record(details?.execution);
  const outcome = execution?.outcome;
  const fields = [
    `[tool-result] ${toolName}`,
    isError ? "error" : outcome === "didnt" ? "not-applied" : "ok",
    `${Math.max(0, Math.round(elapsedMs))}ms`,
  ];

  if (outcome === "worked" || outcome === "didnt" || outcome === "unknown") {
    fields.push(`outcome=${outcome}`);
  }
  const actionCount = finiteInteger(execution?.actionCount);
  if (actionCount !== undefined) fields.push(`actions=${actionCount}`);
  if (Array.isArray(details?.changes)) fields.push(`changes=${details.changes.length}`);
  const verification = record(execution?.verification)?.status;
  if (verification === "verified" || verification === "preexisting" || verification === "failed") {
    fields.push(`verification=${verification}`);
  }
  if (isError) fields.push(`reason=${errorClass(result) ?? "unknown"}`);

  return fields.join(" ");
}
