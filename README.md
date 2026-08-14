# Vision Walker Template

A TypeScript starter for browser-based business workflows using the Pi Coding
Agent SDK and [`pi-computer-use`](https://github.com/injaneity/pi-computer-use).

[Use this template](https://github.com/xiyu1984/vision-walker-template/generate)

## Setup

Requirements: Node.js 22+, Google Chrome, an LLM API key, and a graphical desktop
session.

```bash
git clone https://github.com/<your-account>/<your-repository>.git
cd <your-repository>
npm install
cp .env.example .env
```

Configure the provider and model in `.pi/settings.json`, then put the matching
key in `.env`:

```dotenv
LLM_API_KEY=your-api-key
```

You may leave it empty when Pi already has provider credentials. Never commit
`.env`.

On macOS 14+, grant `~/Applications/pi-computer-use.app` both **Accessibility**
and **Screen Recording** permissions under **System Settings → Privacy &
Security**. Windows requires an interactive desktop session; Linux requires a
graphical session with AT-SPI2.

## Use

Log in manually with the isolated, persistent Chrome profile:

```bash
npm run browser:login -- --url "https://example.com/login"
```

Close that browser before running another command. Inspect the authenticated
page without starting an agent:

```bash
npm run check -- --url "https://example.com/dashboard"
```

Run a bounded workflow:

```bash
npm run run -- \
  --url "https://example.com/dashboard" \
  --task "Read the visible account status and summarize it; do not change anything"
```

Create the history-data directory manually and place the exported spreadsheets
and images inside it:

```bash
mkdir -p resources/data
```

The `analyze` command does not create or populate this directory. After adding
the historical files, analyze them without starting a browser:

```bash
npm run analyze
```

The command sends extracted spreadsheet tables and image attachments to the
runtime LLM, then writes tomorrow's plan to `decisions/YYYY-MM-DD.md`.

On the plan date, fill the promotion draft from that decision:

```bash
npm run promotion -- --url "https://example.com/dashboard"
```

`promotion` reads today's decision by default, opens “推广通” → “新建推广”,
keeps the single store selected by default, selects “标准推”, and fills only
that store's settings. It never changes the store selection or activates
“立即创建”. The promotion is bounded to one day: both start and end dates are
set to the decision date. The browser stays open for review until you close
managed Chrome or press Ctrl+C.
Managed mode uses CDP for background-safe accessibility-tree interaction and
bounded DOM fallbacks, so Chrome does not need to remain in front of other
windows.
Use `--date YYYY-MM-DD` to run a different dated decision, or
`--decisions-dir <directory>` with either command to select another plan store.

### Semantic browser tools

The loaded `pi-computer-use` extension registers the project's basic
Accessibility Tree tools directly with PI:

- `observe_ui` with `mode="semantic"` captures the current accessibility tree.
- `search_ui` queries its complete cached state by text, role, or capability.
- `inspect_ui` returns one node's semantic fields, state, geometry, and actions.
- `act_ui` performs checked actions against refs from that state and returns the
  successor state for verification.

Workflow prompts use semantic state for grounding and verification while each
trusted site policy chooses the action-delivery method. They do not reason about
the computer-use extension's internal backend. Native browser windows do not
use DOM evaluation. A delivered action is not successful until its visible
successor state or postcondition is verified.

The Meituan promotion policy uses bounded DOM delivery for its known custom
business controls because repeated runs showed unreliable `act_ui` delivery.
It still uses semantic observations to identify the page, preserve the selected
store, and verify the final result. Promotion workflows finish structural
dialogs and drawers before setting budget and bids, then perform one final
verification.

Runtime logs include bounded tool intent, timing, outcome, and safe error-class
diagnostics. Those diagnostic lines never include form values, page result
text, DOM expressions, or private model reasoning. Capture both streams with
`2>&1` when one combined log is needed; assistant narration (which can summarize
final settings) is written to stdout and diagnostics to stderr.

Browser state is stored in the ignored `var/browser-profiles/default` directory.
Only one process may use it at a time.

## Add a business workflow

Use `src/cli/run.ts` as the example, but give each production workflow its own
CLI, prompt policy, and learned state:

```text
src/cli/<workflow>.ts
prompts/<workflow>/general.md
prompts/<workflow>/sites/default.md
assistant/<workflow>/
assistant/<workflow>/conflicts/
```

Common modules live under `src/computer-use`, `src/config`, `src/prompts`, and
`src/assistant`.

Prompts are trusted, version-controlled policy. Assistant files contain only
untrusted reusable UI observations, which must be reverified on every run.
Conflicting observations are quarantined for manual review. Never store secrets,
personal data, business records, page content, coordinates, or executable
instructions in assistant files.

Add the top-level field `"auto-update": "false"` to lock an entire assistant
file. Runtime findings are then quarantined as conflicts instead of changing
any clue or verification metadata in that file.

## Configuration and checks

`.pi/computer-use.json` controls browser mode, the managed profile, and action
delays. Set `PI_COMPUTER_USE_CHROME_EXECUTABLE` in `.env` when Chrome is installed
in a non-standard location.

```bash
npm run typecheck
npm test
npm run build
```

Stop on login barriers, CAPTCHAs, verification challenges, or access warnings;
never ask the agent to bypass them.
