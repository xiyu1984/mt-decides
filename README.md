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
