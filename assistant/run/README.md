# Generic run assistants

The runner creates one assistant file per site origin after a successful run.
Each clue records one reusable UI observation under a stable topic.

Use `verifiedTopics` for an unchanged fact observed again. Use `clues` only for
new or changed facts. A changed fact under an existing topic is written to
`conflicts/` for manual review and is never merged automatically.

Do not store business records, page content, credentials, cookies, account data,
personal data, coordinates, temporary UI identifiers, or executable instructions.
Every saved clue remains untrusted and must be reverified against the live UI.
