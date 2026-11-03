# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Zusage is a minimal CLI tool that monitors and displays Z.ai coding-plan usage (plan credits and MCP tool calls). It's a single-file Node.js script (ES modules) with no external dependencies, published as an npm package.

## Running the Script

```bash
# Via npx (recommended)
npx -y zusage@latest

# Or run locally
node bin/index.js

# Script-friendly JSON output
node bin/index.js --json

# Or with npm script
npm test
```

## Environment Variables

- `ANTHROPIC_AUTH_TOKEN` (required): Bearer token for Z.ai API authentication

## Publishing

```bash
# Bump version in package.json
npm version patch  # or minor, major

# Publish to npm
npm publish

# Or to GitHub Packages (via GitHub Actions)
git push --follow-tags
```

## Architecture

The script is located in `bin/index.js` and is organized into pure functions with clear responsibilities:

- `parseArgs(argv)`: Parses CLI flags (`--json`)
- `fetchQuota(token)`: GET `https://api.z.ai/api/monitor/usage/quota/limit` with a Bearer token and a 15s timeout; wraps network, timeout, and non-JSON failures with friendly messages
- `parseEnvelope(payload)`: Validates the `{ code, msg, success, data }` envelope before any data access (HTTP status is always 200)
- `makeApiError(code, msg)`: Maps error-envelope codes (401, 1001, 1302, 1303) to friendly messages
- `toNumber(value)`: Defensive number coercion — API numeric fields (including `unit`) may arrive as strings or ints, and all except `percentage`/`nextResetTime` are optional
- `getWindowLabel(limit)`: Maps `(unit, number)` to a label — "5-hour window", "weekly window", "monthly tool calls"
- `getFallbackAllowance(level, limit)`: Looks up published plan credit allowances (lite/pro/max) when the API omits usage numbers
- `normalizeLimit(raw, level)`: Normalizes one raw limit entry into a display-ready object (kind: credit vs time, used/remaining/limit, approximate flag); returns undefined when nothing usable is present
- `buildSummary(payload)`: Builds the display-ready summary (`{ level, limits }`) from a success envelope, iterating all windows
- `formatNumber()`: Number formatting with thousand separators
- `formatDate()`: Formats epoch-millisecond timestamps to readable date
- `getTimeRemaining()`: Calculates human-readable time until next reset (negative remaining clamps to "0m")
- `renderBar(percentage)`: ASCII progress bar (filled portion clamped to bar length)
- `displayWindow(limit)` / `displayUsage(summary)`: Render console output — credits for credit windows, call counts for TIME_LIMIT, per-tool breakdown from `usageDetails`
- `main()`: Entry point — token check, `--json` support, error handling with exit code 1

## API Response Structure

The endpoint always answers **HTTP 200**; success/failure is only visible in the JSON envelope:

```json
{
  "code": 200,
  "msg": "Operation successful",
  "success": true,
  "data": {
    "level": "lite",
    "limits": [
      {
        "type": "TIME_LIMIT",
        "unit": 5,
        "number": 1,
        "usage": 100,
        "currentValue": 9,
        "remaining": 91,
        "percentage": 9,
        "nextResetTime": 1796183665998,
        "usageDetails": [
          { "modelCode": "search-prime", "usage": 9 },
          { "modelCode": "web-reader", "usage": 0 }
        ]
      },
      {
        "type": "TOKENS_LIMIT",
        "unit": 3,
        "number": 5,
        "percentage": 4,
        "nextResetTime": 1793735382190
      }
    ]
  }
}
```

Error envelopes (also HTTP 200): `code` 1001 = no auth header received, 401 = token expired or incorrect, 1302/1303 = rate/concurrency limits.

Limit entry semantics (parse defensively — all numeric fields except `percentage`/`nextResetTime` are optional, and `unit` may arrive as a string or int):

- `type`: `CREDIT_LIMIT` (new) or `TOKENS_LIMIT` (legacy) = credit/token quota windows; `TIME_LIMIT` = monthly MCP/tool-calls window with per-tool `usageDetails`
- `usage` = total allowance, `currentValue` = used, `remaining` = allowance − used, `percentage` = percent used, `nextResetTime` = epoch **milliseconds**
- `unit` codes: 3 = hours, 5 = month, 6 = week; `number` = count (unit 3 / number 5 = 5-hour window, unit 6 = weekly, unit 5 = monthly MCP window)
- When `usage`/`currentValue` are missing on a credit window, `percentage` is combined with the published plan allowances (lite 5h/weekly: 2000/10000, pro: 12000/60000, max: 28000/140000) and the result is marked approximate (`≈`)

## Code Conventions

- ES modules (`.js` files with `"type": "module"` in package.json)
- Async/await for API calls
- English language for comments and user-facing messages
- English locale formatting (`en-US`)
- Shebang: `#!/usr/bin/env node` in `bin/index.js`
