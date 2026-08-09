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
