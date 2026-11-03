# Zusage

A minimal CLI tool to monitor your Z.ai coding plan usage when using Claude Code.

## Overview

This tool connects to the Z.ai quota API and displays your current coding-plan credit consumption: the 5-hour (and weekly, when present) credit windows plus the monthly tool-call window, with progress bars and time until each window resets.

Note: the values shown are **plan credits**, not raw tokens. Z.ai's coding plan is metered in credits per request, so the numbers reflect your plan's credit allowance.

## Features

- Plan level display (lite / pro / max)
- Progress bar and percentage for each quota window
- Used / Remaining / Limit in credits for credit windows, call counts for the monthly tool-call window
- Per-tool call breakdown for the monthly window (search-prime, web-reader, zread, ...)
- Time remaining and next reset date for every window
- `--json` flag for script-friendly output
- Zero dependencies, single file

## Installation

### Via npx (recommended)

No installation needed - just run:

```bash
npx -y zusage@latest
```

### Or install globally

```bash
npm install -g zusage
```

## Usage

Set your `ANTHROPIC_AUTH_TOKEN` environment variable to a coding-plan key. Get it from [https://z.ai/manage-apikey/apikey-list](https://z.ai/manage-apikey/apikey-list) under the **Coding Plan** tab — standard pay-as-you-go API keys don't carry plan quota and won't work here.

```bash
export ANTHROPIC_AUTH_TOKEN="your_token_here"

# Via npx
npx -y zusage@latest

# Script-friendly output
npx -y zusage@latest --json
```

## Example Output

```
==================================================
  📊 Z.AI - CODING PLAN USAGE
==================================================

  Plan: Lite

  ⏳ MONTHLY TOOL CALLS
  Progress: [████░░░░░░░░░░░░░░░░░░░░░░░░░░░] 12%

  📈 Used:        12 calls
  📉 Remaining:   88 calls
  🎯 Limit:       100 calls

  ⏱️  Reset in:    28d 11h 28m
  📅 Next reset:  Wednesday, December 2, 2026 at 1:54 PM

  🛠️  Tool calls:
     • search-prime: 12

  ⏳ 5-HOUR WINDOW
  Progress: [██░░░░░░░░░░░░░░░░░░░░░░░░░░░░░] 6%

  📈 Used:        ≈ 120 credits
  📉 Remaining:   ≈ 1,880 credits
  🎯 Limit:       ≈ 2,000 credits

  ⏱️  Reset in:    3h 23m
  📅 Next reset:  Wednesday, November 4, 2026 at 5:49 AM

  * Derived from published plan allowances — Z.ai may adjust plan sizes

==================================================
```

Values marked with `≈` are derived from Z.ai's published plan credit allowances because the API only reports a percentage for those windows.

## Quota Windows

Z.ai's coding plan meters usage in windows:

- **5-hour window** — a rolling credit allowance that replenishes every 5 hours. This is the main constraint on heavy Claude Code sessions.
- **Weekly window** — a larger weekly credit allowance (shown when your plan has one).
- **Monthly tool calls** — your plan's built-in MCP tool calls (search-prime, web-reader, zread), resetting monthly.

The tool shows when each window resets based on the API data.
