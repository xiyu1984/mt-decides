export type PromotionRunEvidence = {
  assistantError: string | undefined;
  assistantStopReason: string | undefined;
  assistantRawStopReason: string | undefined;
  assistantProvider: string | undefined;
  assistantModel: string | undefined;
  assistantApi: string | undefined;
  assistantDiagnostics: readonly string[];
  assistantText: string;
  stateChangingToolCount: number;
  reviewMarkedReady: boolean;
};

function failureContext(evidence: PromotionRunEvidence): string {
  const fields = [
    evidence.assistantProvider ? `provider=${evidence.assistantProvider}` : undefined,
    evidence.assistantModel ? `model=${evidence.assistantModel}` : undefined,
    evidence.assistantApi ? `api=${evidence.assistantApi}` : undefined,
    evidence.assistantStopReason ? `stopReason=${evidence.assistantStopReason}` : undefined,
    evidence.assistantRawStopReason ? `rawStopReason=${evidence.assistantRawStopReason}` : undefined,
  ].filter((value): value is string => value !== undefined);
  return fields.length > 0 ? ` (${fields.join(", ")})` : "";
}

function diagnosticDetails(evidence: PromotionRunEvidence): string {
  return evidence.assistantDiagnostics.length > 0
    ? `; diagnostics: ${evidence.assistantDiagnostics.join(" | ")}`
    : "";
}

export function assertPromotionRunReady(evidence: PromotionRunEvidence): void {
  if (evidence.assistantError) {
    throw new Error(
      `LLM request failed${failureContext(evidence)}: ${evidence.assistantError}${diagnosticDetails(evidence)}`,
    );
  }
  if (evidence.assistantStopReason === "error" || evidence.assistantStopReason === "aborted") {
    throw new Error(
      `LLM run stopped with ${evidence.assistantStopReason}${failureContext(evidence)}${diagnosticDetails(evidence)}`,
    );
  }
  if (evidence.assistantStopReason === "length") {
    throw new Error("LLM response was truncated before the promotion workflow completed");
  }
  if (evidence.stateChangingToolCount === 0) {
    throw new Error("promotion workflow performed no browser actions");
  }
  if (!evidence.reviewMarkedReady) {
    throw new Error("promotion workflow did not verify the form as ready for review");
  }
  if (!evidence.assistantText.trim()) {
    throw new Error("promotion workflow returned no final review summary");
  }
}
