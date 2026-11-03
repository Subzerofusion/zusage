#!/usr/bin/env node
/**
 * Simple program to display Z.ai coding plan usage (credits + tool calls)
 */

const BASE_URL = 'https://api.z.ai';
const QUOTA_PATH = '/api/monitor/usage/quota/limit';
const API_TIMEOUT_MS = 15000;

/**
 * Published plan credit allowances (docs.z.ai/devpack/overview).
 * Used ONLY as a fallback when the API omits usage numbers for a credit
 * window — derived values are marked approximate since Z.ai may change
 * plan sizes at any time.
 */
const PLAN_ALLOWANCES = {
  lite: { '5h': 2000, weekly: 10000 },
  pro: { '5h': 12000, weekly: 60000 },
  max: { '5h': 28000, weekly: 140000 },
};

/**
 * Error envelope codes -> friendly messages.
 * The endpoint always answers HTTP 200; success/failure lives in the JSON.
 */
const ERROR_MESSAGES = {
  401: 'Token is invalid or expired — grab a fresh one from https://z.ai/manage-apikey/apikey-list (Coding Plan tab)',
  1001: 'No authentication token was received — set the ANTHROPIC_AUTH_TOKEN environment variable',
  1302: 'Rate limited by Z.ai — wait a moment and try again',
  1303: 'Concurrency limit reached on your account — retry shortly',
};

/**
 * Parses CLI flags
 */
function parseArgs(argv) {
  return { json: argv.slice(2).includes('--json') };
}

/**
 * Coerces a possibly-string API number into a finite number.
 * All limit fields except percentage/nextResetTime are optional.
 */
function toNumber(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

/**
 * Fetches the quota envelope from Z.ai API
 */
async function fetchQuota(token) {
  let response;
  try {
    response = await fetch(`${BASE_URL}${QUOTA_PATH}`, {
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'authorization': `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch (error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      throw new Error(`Request timed out after ${API_TIMEOUT_MS / 1000}s — check your network or proxy`);
    }
    throw new Error(`Network error while contacting ${BASE_URL} — ${error.message}`);
  }

  // Defensive: the endpoint is documented to always return HTTP 200
  if (!response.ok) {
    throw new Error(`Unexpected HTTP status ${response.status} from the quota API`);
  }

  try {
    return await response.json();
  } catch {
    throw new Error('API returned a non-JSON response — try again later');
  }
}

/**
 * Builds an Error with a friendly message for an error envelope
 */
function makeApiError(code, msg) {
  const friendly = ERROR_MESSAGES[code];
  const detail = msg ? ` (${msg})` : '';
  const error = new Error(
    friendly ? `${friendly}${detail}` : `API error ${code ?? 'unknown'}${detail || ' — unknown error'}`,
  );
  error.code = code;
  return error;
}

/**
 * Validates the API envelope ({ code, msg, success, data }) before any
 * data access — the HTTP status is always 200, even on failure
 */
function parseEnvelope(payload) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Unexpected API response format');
  }
  if (payload.success === false) {
    throw makeApiError(toNumber(payload.code), payload.msg);
  }
  if (payload.success !== true && !(payload.data && Array.isArray(payload.data.limits))) {
    throw makeApiError(toNumber(payload.code), payload.msg);
  }
  return payload;
}

/**
 * Maps a limit entry's (unit, number) to a human label.
 * unit codes: 3 = hours, 5 = month, 6 = week
 */
function getWindowLabel(limit) {
  if (limit.type === 'TIME_LIMIT' && limit.unit === 5) return 'monthly tool calls';
  if (limit.unit === 3) {
    return limit.number === 5 ? '5-hour window' : `${limit.number ?? '?'}-hour window`;
  }
  if (limit.unit === 6) return 'weekly window';
  if (limit.unit === 5) return 'monthly window';
  return 'usage window';
}

/**
 * Looks up the published plan allowance for a credit window
 */
function getFallbackAllowance(level, limit) {
  const plan = PLAN_ALLOWANCES[String(level ?? '').toLowerCase()];
  if (!plan) return undefined;
  if (limit.unit === 3 && limit.number === 5) return plan['5h'];
  if (limit.unit === 6) return plan.weekly;
  return undefined;
}

/**
 * Normalizes one raw limit entry into a display-ready object.
 * `usage` = total allowance, `currentValue` = used, `remaining` =
 * allowance - used, `percentage` = percent used, `nextResetTime` = epoch ms.
 * Returns undefined when there is nothing usable to show.
 */
function normalizeLimit(raw, level) {
  if (!raw || typeof raw !== 'object') return undefined;

  const limit = {
    type: typeof raw.type === 'string' ? raw.type : 'UNKNOWN',
    unit: toNumber(raw.unit),
    number: toNumber(raw.number),
  };
  limit.kind = limit.type === 'TIME_LIMIT' ? 'time' : 'credit';
  limit.label = getWindowLabel(limit);
  limit.percentage = toNumber(raw.percentage);
  limit.nextResetTime = toNumber(raw.nextResetTime);
  limit.usageDetails = Array.isArray(raw.usageDetails)
    ? raw.usageDetails
        .map((detail) => ({
          modelCode: String(detail?.modelCode ?? 'unknown'),
          usage: toNumber(detail?.usage) ?? 0,
        }))
    : undefined;

  const allowance = toNumber(raw.usage);
  const used = toNumber(raw.currentValue);
  const remaining = toNumber(raw.remaining);

  if (allowance !== undefined && used !== undefined) {
    limit.limit = allowance;
    limit.used = used;
    limit.remaining = remaining ?? Math.max(0, allowance - used);
    limit.approximate = false;
    if (limit.percentage === undefined) {
      limit.percentage = allowance > 0 ? (used / allowance) * 100 : 0;
    }
  } else if (limit.percentage !== undefined && limit.kind === 'credit') {
    const fallback = getFallbackAllowance(level, limit);
    if (fallback !== undefined) {
      limit.limit = fallback;
      limit.used = Math.round((fallback * limit.percentage) / 100);
      limit.remaining = Math.max(0, fallback - limit.used);
      limit.approximate = true;
    }
  }

  if (limit.percentage === undefined && limit.used === undefined) return undefined;
  return limit;
}

/**
 * Builds the display-ready summary from a success envelope
 */
function buildSummary(payload) {
  const data = payload?.data ?? {};
  const level = typeof data.level === 'string' && data.level !== '' ? data.level : undefined;
  const limitsRaw = Array.isArray(data.limits) ? data.limits : [];
  const limits = limitsRaw
    .map((raw) => normalizeLimit(raw, level))
    .filter((limit) => limit !== undefined);
  return { level, limits };
}

/**
 * Formats a number with thousand separators
 */
function formatNumber(num) {
  if (!Number.isFinite(num)) return '—';
  return new Intl.NumberFormat('en-US').format(num);
}

/**
 * Formats a timestamp into a readable date
 */
function formatDate(timestamp) {
  return new Date(timestamp).toLocaleString('en-US', {
    dateStyle: 'full',
    timeStyle: 'short',
  });
}

/**
 * Calculates time remaining until reset (clamped at 0 — a stale
 * nextResetTime in the past shows "0m", not a negative value)
 */
function getTimeRemaining(nextResetTime) {
  const remaining = Math.max(0, nextResetTime - Date.now());
  const totalMinutes = Math.floor(remaining / (1000 * 60));
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;

  if (days > 0) {
    return `${days}d ${hours}h ${minutes}m`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

/**
 * Renders the ASCII progress bar (filled portion clamped to the bar)
 */
function renderBar(percentage, barLength = 30) {
  const clamped = Math.min(100, Math.max(0, percentage));
  const filled = Math.round((clamped / 100) * barLength);
  const empty = barLength - filled;
  return '█'.repeat(filled) + '░'.repeat(empty);
}

/**
 * Displays one quota window
 */
function displayWindow(limit) {
  const unit = limit.kind === 'time' ? 'calls' : 'credits';
  const tilde = limit.approximate ? '≈ ' : '';

  console.log(`\n  ⏳ ${limit.label.toUpperCase()}`);
  const percentage = Math.round(limit.percentage);
  console.log(`  Progress: [${renderBar(percentage)}] ${percentage}%`);

  if (limit.used !== undefined) {
    console.log(`\n  📈 Used:        ${tilde}${formatNumber(limit.used)} ${unit}`);
    console.log(`  📉 Remaining:   ${tilde}${formatNumber(limit.remaining)} ${unit}`);
    console.log(`  🎯 Limit:       ${tilde}${formatNumber(limit.limit)} ${unit}`);
  } else {
    console.log('\n  (usage totals unavailable — percentage only)');
  }

  if (limit.nextResetTime !== undefined) {
    console.log(`\n  ⏱️  Reset in:    ${getTimeRemaining(limit.nextResetTime)}`);
    console.log(`  📅 Next reset:  ${formatDate(limit.nextResetTime)}`);
  }

  if (limit.usageDetails !== undefined) {
    const activeTools = limit.usageDetails.filter((detail) => detail.usage > 0);
    if (activeTools.length > 0) {
      console.log('\n  🛠️  Tool calls:');
      for (const detail of activeTools) {
        console.log(`     • ${detail.modelCode}: ${formatNumber(detail.usage)}`);
      }
    } else {
      console.log('\n  🛠️  Tool calls: none this period');
    }
  }

  if (limit.approximate) {
    console.log('\n  * Derived from published plan allowances — Z.ai may adjust plan sizes');
  }
}

/**
 * Displays the full usage summary
 */
function displayUsage(summary) {
  console.log('\n' + '='.repeat(50));
  console.log('  📊 Z.AI - CODING PLAN USAGE');
  console.log('='.repeat(50));

  if (summary.level) {
    const level = summary.level.charAt(0).toUpperCase() + summary.level.slice(1);
    console.log(`\n  Plan: ${level}`);
  }

  for (const limit of summary.limits) {
    displayWindow(limit);
  }

  console.log('\n' + '='.repeat(50) + '\n');
}

// Entry point
async function main() {
  const { json } = parseArgs(process.argv);

  const token = process.env.ANTHROPIC_AUTH_TOKEN;
  if (!token) {
    console.error('❌ Error: ANTHROPIC_AUTH_TOKEN environment variable is not set');
    process.exit(1);
  }

  try {
    const payload = parseEnvelope(await fetchQuota(token));
    const summary = buildSummary(payload);

    if (summary.limits.length === 0) {
      throw new Error('No quota windows found in the API response');
    }

    if (json) {
      console.log(JSON.stringify(summary, null, 2));
    } else {
      displayUsage(summary);
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
