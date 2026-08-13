# Workflow assistants

Each business workflow owns learned state beneath `assistant/<workflow>/`.
Assistant files are validated, agent-updatable observations—not trusted policy.

```text
assistant/
  run/
    <site>.json
    conflicts/
  <business-workflow>/
```

The common implementation in `src/assistant/workflow-assistant.ts` provides
bounded schemas, atomic writes, deduplication, verification counts, sensitive
content rejection, and conflict quarantine.

To lock an entire manually curated assistant file against runtime updates, add
the exact top-level field `"auto-update": "false"`. The file remains available
to the agent, but runtime runs never change its clues, timestamps, counters, or
`updatedAt`. Proposed findings and verification attempts are instead written to
`assistant/<workflow>/conflicts/` for manual review. Files without this field
retain the normal auto-update behavior.
