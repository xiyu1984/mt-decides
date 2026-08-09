# Workflow prompts

Each LLM-backed business workflow owns one directory beneath `prompts/`.
Prompt files are trusted, version-controlled runtime policy and are never changed
by the agent.

```text
prompts/
  run/
    general.md
    sites/
      default.md
  <business-workflow>/
    general.md
```

Use `readWorkflowPromptFile` for bounded loading and `renderPromptTemplate` for
strict `{{PLACEHOLDER}}` expansion. Safety-critical rules must also be enforced
in TypeScript; a prompt is guidance, not a security boundary.

Optional `sites/<site>.md` files contain trusted site-specific policy. They are
selected from a sanitized exact site slug and fall back to `sites/default.md`.
