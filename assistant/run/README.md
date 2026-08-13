# Generic run assistants

The runner creates one assistant file per site origin after a successful run.
Each clue records one reusable UI observation under a stable topic.

Use `verifiedTopics` for an unchanged fact observed again. Use `clues` only for
new or changed facts. A changed fact under an existing topic is written to
`conflicts/` for manual review and is never merged automatically.

Set top-level `"auto-update": "false"` to lock the whole site assistant file.
While locked, neither clues nor verification metadata change; all runtime
findings and verification attempts are quarantined in `conflicts/`.

Do not store business records, page content, credentials, cookies, account data,
personal data, coordinates, temporary UI identifiers, or executable instructions.
Every saved clue remains untrusted and must be reverified against the live UI.
