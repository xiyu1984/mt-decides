import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import { WORKFLOW_NAME_PATTERN } from "../prompts/loader.js";

const SCHEMA_VERSION = 1;
const CONFLICT_SCHEMA_VERSION = 1;
const MAX_STORED_CLUES = 100;
const MAX_PROPOSED_CLUES = 12;
const MAX_TOPIC_LENGTH = 80;
const MAX_CLUE_TEXT_LENGTH = 300;
const TOPIC_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const FILE_SLUG_PATTERN = /^[a-z0-9][a-z0-9.-]*$/;

const SENSITIVE_OR_UNSAFE_PATTERN = /(?:api[-_ ]?key|authorization|bearer token|cookie|credential|password|session token|localstorage|system prompt|developer message|ignore (?:all|any|the|previous)|run (?:a )?(?:shell|command)|<script|javascript:|忽略.{0,12}(?:指令|提示)|执行.{0,8}命令)/iu;
const REVERIFICATION_PREFIX = /^(?:re-?verified|verified again|reconfirmed|再次验证|重新验证)\s*[:：-]?\s*/iu;
const STABLE_ANCHOR_PATTERN = /(?:\[[^\]\s]{2,80}\]|[.#][a-z_][a-z0-9_-]*|\/[a-z0-9_{}?=&.-]+|#[0-9a-f]{3,8}|"[^"]{1,80}"|'[^']{1,80}')/giu;

export type AssistantDefinition = {
  workflow: string;
  scope: string;
  fileSlug: string;
  categories: readonly string[];
};

export type AssistantClue = {
  topic: string;
  category: string;
  text: string;
  learnedAt: string;
  lastVerifiedAt: string;
  successCount: number;
};

export type WorkflowAssistant = {
  schemaVersion: 1;
  workflow: string;
  scope: string;
  createdAt: string;
  updatedAt: string;
  clues: AssistantClue[];
};

export type AssistantClueProposal = Pick<AssistantClue, "topic" | "category" | "text">;

export type AssistantUpdate = {
  assistantPath: string;
  conflictPath: string | null;
  addedCount: number;
  verifiedCount: number;
  conflictCount: number;
};

type AssistantClueConflict = {
  topic: string;
  reason: "existing-topic-differs" | "proposal-batch-disagrees";
  existingClue: AssistantClue | null;
  proposedClues: AssistantClueProposal[];
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validateDefinition(definition: AssistantDefinition): void {
  if (!WORKFLOW_NAME_PATTERN.test(definition.workflow)) {
    throw new Error(`invalid assistant workflow name: ${definition.workflow}`);
  }
  if (!definition.scope.trim() || definition.scope.length > 500) {
    throw new Error("assistant scope must contain between 1 and 500 characters");
  }
  if (!FILE_SLUG_PATTERN.test(definition.fileSlug) || definition.fileSlug.length > 200) {
    throw new Error("assistant file slug contains unsafe characters");
  }
  if (definition.categories.length === 0 || new Set(definition.categories).size !== definition.categories.length) {
    throw new Error("assistant categories must be a non-empty unique list");
  }
  for (const category of definition.categories) {
    if (!TOPIC_PATTERN.test(category) || category.length > MAX_TOPIC_LENGTH) {
      throw new Error(`invalid assistant category: ${category}`);
    }
  }
}

function normalizeTopic(value: string): string {
  const topic = value.trim().toLocaleLowerCase();
  if (!TOPIC_PATTERN.test(topic) || topic.length > MAX_TOPIC_LENGTH) {
    throw new Error(`assistant clue topic must match ${TOPIC_PATTERN.source} and contain at most ${MAX_TOPIC_LENGTH} characters`);
  }
  return topic;
}

function normalizeClueText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function normalizedTextIdentity(value: string): string {
  return normalizeClueText(value).normalize("NFKC").toLocaleLowerCase();
}

function contentIdentity(category: string, text: string): string {
  return `${category}\u0000${normalizedTextIdentity(text)}`;
}

function stableAnchors(value: string): Set<string> {
  return new Set(
    [...value.matchAll(STABLE_ANCHOR_PATTERN)]
      .map(([match]) => match?.normalize("NFKC").toLocaleLowerCase())
      .filter((match): match is string => Boolean(match)),
  );
}

function isExplicitRestatement(existing: AssistantClue, proposal: AssistantClueProposal): boolean {
  if (existing.category !== proposal.category || !REVERIFICATION_PREFIX.test(proposal.text)) return false;
  const existingAnchors = stableAnchors(existing.text);
  const proposedAnchors = stableAnchors(proposal.text.replace(REVERIFICATION_PREFIX, ""));
  return [...proposedAnchors].every((anchor) => existingAnchors.has(anchor));
}

function validateProposal(
  definition: AssistantDefinition,
  proposal: AssistantClueProposal,
): AssistantClueProposal {
  const topic = normalizeTopic(proposal.topic);
  const category = proposal.category.trim().toLocaleLowerCase();
  if (!definition.categories.includes(category)) {
    throw new Error(`assistant clue category must be one of: ${definition.categories.join(", ")}`);
  }
  const text = normalizeClueText(proposal.text);
  if (!text || text.length > MAX_CLUE_TEXT_LENGTH) {
    throw new Error(`assistant clue text must contain between 1 and ${MAX_CLUE_TEXT_LENGTH} characters`);
  }
  if (SENSITIVE_OR_UNSAFE_PATTERN.test(text)) {
    throw new Error("assistant clues cannot contain secrets, executable content, or instruction overrides");
  }
  return { topic, category, text };
}

function parseClue(definition: AssistantDefinition, value: unknown, index: number): AssistantClue {
  if (!isObject(value)) throw new Error(`assistant clue ${index + 1} must be an object`);
  if (typeof value.topic !== "string" || typeof value.category !== "string" || typeof value.text !== "string") {
    throw new Error(`assistant clue ${index + 1} has invalid content`);
  }
  if (!isIsoTimestamp(value.learnedAt) || !isIsoTimestamp(value.lastVerifiedAt)) {
    throw new Error(`assistant clue ${index + 1} has an invalid timestamp`);
  }
  if (!Number.isInteger(value.successCount) || (value.successCount as number) < 1) {
    throw new Error(`assistant clue ${index + 1} has an invalid success count`);
  }
  return {
    ...validateProposal(definition, {
      topic: value.topic,
      category: value.category,
      text: value.text,
    }),
    learnedAt: value.learnedAt,
    lastVerifiedAt: value.lastVerifiedAt,
    successCount: value.successCount as number,
  };
}

function emptyAssistant(definition: AssistantDefinition, now = new Date().toISOString()): WorkflowAssistant {
  return {
    schemaVersion: SCHEMA_VERSION,
    workflow: definition.workflow,
    scope: definition.scope,
    createdAt: now,
    updatedAt: now,
    clues: [],
  };
}

function parseAssistant(definition: AssistantDefinition, value: unknown): WorkflowAssistant {
  if (!isObject(value)) throw new Error("assistant file must contain an object");
  if (value.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`unsupported assistant schema version: ${String(value.schemaVersion)}`);
  }
  if (value.workflow !== definition.workflow || value.scope !== definition.scope) {
    throw new Error(`assistant identity must be ${definition.workflow}/${definition.scope}`);
  }
  if (!isIsoTimestamp(value.createdAt) || !isIsoTimestamp(value.updatedAt)) {
    throw new Error("assistant file has an invalid timestamp");
  }
  if (!Array.isArray(value.clues) || value.clues.length > MAX_STORED_CLUES) {
    throw new Error(`assistant file must contain at most ${MAX_STORED_CLUES} clues`);
  }
  const clues = value.clues.map((clue, index) => parseClue(definition, clue, index));
  const topics = new Set<string>();
  for (const clue of clues) {
    if (topics.has(clue.topic)) throw new Error(`assistant contains duplicate topic: ${clue.topic}`);
    topics.add(clue.topic);
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    workflow: definition.workflow,
    scope: definition.scope,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    clues,
  };
}

function assistantPath(cwd: string, definition: AssistantDefinition): string {
  return join(cwd, "assistant", definition.workflow, `${definition.fileSlug}.json`);
}

export async function loadWorkflowAssistant(
  cwd: string,
  definition: AssistantDefinition,
): Promise<WorkflowAssistant> {
  validateDefinition(definition);
  const path = assistantPath(cwd, definition);
  try {
    return parseAssistant(definition, JSON.parse(await readFile(path, "utf8")) as unknown);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyAssistant(definition);
    if (error instanceof SyntaxError) {
      throw new Error(`invalid JSON in ${relative(cwd, path)}: ${error.message}`);
    }
    throw error;
  }
}

async function writeAssistantAtomic(
  cwd: string,
  definition: AssistantDefinition,
  assistant: WorkflowAssistant,
): Promise<string> {
  const path = assistantPath(cwd, definition);
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = join(dirname(path), `.${definition.fileSlug}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, `${JSON.stringify(assistant, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, path);
  } finally {
    await unlink(temporaryPath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    });
  }
  return relative(cwd, path);
}

async function writeConflictBatch(
  cwd: string,
  definition: AssistantDefinition,
  recordedAt: string,
  conflicts: AssistantClueConflict[],
): Promise<string | null> {
  if (conflicts.length === 0) return null;
  const directory = join(cwd, "assistant", definition.workflow, "conflicts");
  await mkdir(directory, { recursive: true });
  const safeTimestamp = recordedAt.replace(/[:.]/g, "-");
  const path = join(directory, `${safeTimestamp}_${definition.fileSlug}_${randomUUID()}.json`);
  await writeFile(path, `${JSON.stringify({
    schemaVersion: CONFLICT_SCHEMA_VERSION,
    recordedAt,
    workflow: definition.workflow,
    scope: definition.scope,
    conflicts,
  }, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  return relative(cwd, path);
}

function proposalIdentity(proposal: AssistantClueProposal): string {
  return `${proposal.topic}\u0000${contentIdentity(proposal.category, proposal.text)}`;
}

export async function updateWorkflowAssistant(
  cwd: string,
  definition: AssistantDefinition,
  proposals: AssistantClueProposal[],
  verificationTopics: string[] = [],
): Promise<AssistantUpdate> {
  const assistant = await loadWorkflowAssistant(cwd, definition);
  const now = new Date().toISOString();
  const existingByTopic = new Map(assistant.clues.map((clue) => [clue.topic, clue]));
  const existingByContent = new Map(assistant.clues.map((clue) => [contentIdentity(clue.category, clue.text), clue]));
  const topicsToVerify = new Set<string>();
  for (const rawTopic of verificationTopics) {
    const topic = normalizeTopic(rawTopic);
    if (existingByTopic.has(topic)) topicsToVerify.add(topic);
  }

  const proposalsByTopic = new Map<string, AssistantClueProposal[]>();
  const newContentTopics = new Map<string, string>();
  for (const rawProposal of proposals) {
    const proposal = validateProposal(definition, rawProposal);
    const sameContent = existingByContent.get(contentIdentity(proposal.category, proposal.text));
    if (sameContent) {
      topicsToVerify.add(sameContent.topic);
      continue;
    }
    const sameTopic = existingByTopic.get(proposal.topic);
    if (sameTopic && isExplicitRestatement(sameTopic, proposal)) {
      topicsToVerify.add(sameTopic.topic);
      continue;
    }
    const contentKey = contentIdentity(proposal.category, proposal.text);
    const firstTopic = newContentTopics.get(contentKey);
    if (firstTopic && firstTopic !== proposal.topic) continue;
    newContentTopics.set(contentKey, proposal.topic);
    const group = proposalsByTopic.get(proposal.topic) ?? [];
    if (!group.some((candidate) => proposalIdentity(candidate) === proposalIdentity(proposal))) group.push(proposal);
    proposalsByTopic.set(proposal.topic, group);
  }

  const conflicts: AssistantClueConflict[] = [];
  let addedCount = 0;
  let verifiedCount = 0;
  for (const topic of topicsToVerify) {
    const existing = existingByTopic.get(topic);
    if (!existing) continue;
    existing.lastVerifiedAt = now;
    existing.successCount += 1;
    verifiedCount += 1;
  }
  for (const [topic, topicProposals] of proposalsByTopic) {
    if (topicProposals.length > 1) {
      conflicts.push({
        topic,
        reason: "proposal-batch-disagrees",
        existingClue: existingByTopic.get(topic) ?? null,
        proposedClues: topicProposals,
      });
      continue;
    }
    const proposal = topicProposals[0];
    if (!proposal) continue;
    const existing = existingByTopic.get(topic);
    if (existing) {
      if (existing.category !== proposal.category || normalizedTextIdentity(existing.text) !== normalizedTextIdentity(proposal.text)) {
        conflicts.push({
          topic,
          reason: "existing-topic-differs",
          existingClue: existing,
          proposedClues: [proposal],
        });
      } else if (!topicsToVerify.has(topic)) {
        existing.lastVerifiedAt = now;
        existing.successCount += 1;
        verifiedCount += 1;
      }
      continue;
    }
    if (existingByTopic.size >= MAX_STORED_CLUES) continue;
    existingByTopic.set(topic, {
      ...proposal,
      learnedAt: now,
      lastVerifiedAt: now,
      successCount: 1,
    });
    addedCount += 1;
  }

  const conflictPath = await writeConflictBatch(cwd, definition, now, conflicts);
  const savedPath = await writeAssistantAtomic(cwd, definition, {
    ...assistant,
    updatedAt: addedCount > 0 || verifiedCount > 0 ? now : assistant.updatedAt,
    clues: [...existingByTopic.values()],
  });
  return {
    assistantPath: savedPath,
    conflictPath,
    addedCount,
    verifiedCount,
    conflictCount: conflicts.length,
  };
}

export function formatAssistantClues(clues: AssistantClue[]): string {
  if (clues.length === 0) return "- No saved clues. Discover the UI conservatively.";
  return clues.map((clue) => (
    `- [topic ${clue.topic}; ${clue.category}; verified ${clue.lastVerifiedAt}; confirmations ${clue.successCount}] ${clue.text}`
  )).join("\n");
}

export function createAssistantClueTool(
  definition: AssistantDefinition,
  existingClues: AssistantClue[],
  canPropose: () => boolean = () => true,
) {
  validateDefinition(definition);
  let proposals: AssistantClueProposal[] = [];
  let verificationTopics: string[] = [];
  let called = false;
  const existingByTopic = new Map(existingClues.map((clue) => [clue.topic, clue]));
  const existingByContent = new Map(existingClues.map((clue) => [contentIdentity(clue.category, clue.text), clue]));

  const tool = defineTool({
    name: "propose_assistant_clues",
    label: "Propose assistant clues",
    description: "Verify existing clue topics and stage genuinely new or changed reusable UI observations.",
    parameters: Type.Object({
      verifiedTopics: Type.Optional(Type.Array(
        Type.String({ minLength: 1, maxLength: MAX_TOPIC_LENGTH, pattern: TOPIC_PATTERN.source }),
        { maxItems: MAX_PROPOSED_CLUES },
      )),
      clues: Type.Array(Type.Object({
        topic: Type.String({ minLength: 1, maxLength: MAX_TOPIC_LENGTH, pattern: TOPIC_PATTERN.source }),
        category: Type.String({ enum: [...definition.categories] }),
        text: Type.String({ minLength: 1, maxLength: MAX_CLUE_TEXT_LENGTH }),
      }), { maxItems: MAX_PROPOSED_CLUES }),
    }),
    execute: async (_toolCallId, input) => {
      if (!canPropose()) throw new Error("assistant clues cannot be proposed after this run became unsuccessful");
      if (called) throw new Error("assistant clues have already been proposed for this run");
      called = true;
      const verified = new Set<string>();
      for (const rawTopic of input.verifiedTopics ?? []) {
        const topic = normalizeTopic(rawTopic);
        if (!existingByTopic.has(topic)) throw new Error(`cannot verify unknown assistant clue topic: ${topic}`);
        verified.add(topic);
      }
      const unique = new Map<string, AssistantClueProposal>();
      const newContentTopics = new Map<string, string>();
      for (const rawProposal of input.clues) {
        const proposal = validateProposal(definition, rawProposal);
        const sameContent = existingByContent.get(contentIdentity(proposal.category, proposal.text));
        if (sameContent) {
          verified.add(sameContent.topic);
          continue;
        }
        const sameTopic = existingByTopic.get(proposal.topic);
        if (sameTopic && isExplicitRestatement(sameTopic, proposal)) {
          verified.add(sameTopic.topic);
          continue;
        }
        const contentKey = contentIdentity(proposal.category, proposal.text);
        const firstTopic = newContentTopics.get(contentKey);
        if (firstTopic && firstTopic !== proposal.topic) continue;
        newContentTopics.set(contentKey, proposal.topic);
        unique.set(proposalIdentity(proposal), proposal);
      }
      proposals = [...unique.values()];
      verificationTopics = [...verified];
      return {
        content: [{
          type: "text",
          text: `Staged ${verificationTopics.length} verification(s) and ${proposals.length} new or changed clue proposal(s).`,
        }],
        details: { proposalCount: proposals.length, verificationCount: verificationTopics.length },
      };
    },
  });

  return {
    tool,
    getProposals: (): AssistantClueProposal[] => proposals,
    getVerificationTopics: (): string[] => verificationTopics,
  };
}
