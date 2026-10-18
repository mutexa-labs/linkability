#!/usr/bin/env node
// linkability verify <address...> --threshold <usd> [--coin <coin>] [--lookback <days>] [--planned <file>] [--json]

import { readFileSync } from "node:fs";
import { linkability, type LinkInput, type LinkResult } from "./score";
import { createInfoClient } from "./hyperliquid";
import { verifyAccounts, type VerifyResult } from "./verify";

const USAGE = `Usage:
  linkability verify <address> <address> [...] --threshold <usd> [options]

Scores real Hyperliquid accounts from public data only (positions, fills, transfers).

Options:
  --threshold <usd>   your alert threshold in USD (required)
  --coin <coin>       the market the slices are on (found automatically when the accounts share one)
  --lookback <days>   transfer history to read (default 180)
  --planned <file>    a JSON LinkInput of the planned trade, printed next to the observed score
  --json              print JSON instead of text
`;

export type CliIO = { out: (s: string) => void; err: (s: string) => void };

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

const duration = (ms: number) => {
  const m = Math.round(ms / 60_000);
  return m < 60
    ? `${m}m`
    : m < 1440
      ? `${Math.floor(m / 60)}h ${m % 60}m`
      : `${Math.floor(m / 1440)}d ${Math.floor((m % 1440) / 60)}h`;
};

function lines(title: string, r: LinkResult): string[] {
  const out = [`${title}: ${r.score} (${r.level}) · spec ${r.specVersion}`];
  for (const f of r.factors)
    out.push(`  +${String(f.points).padEnd(3)} ${f.label}${f.fix && f.points > 0 ? `  · ${f.fix}` : ""}`);
  return out;
}

export function formatText(v: VerifyResult, planned?: LinkResult): string {
  const e = v.evidence;
  const out = [`${v.accounts.length} accounts, ${v.coin} ${v.side === 1 ? "long" : "short"}`, ""];
  out.push(...lines("Observed", v.result));
  if (planned) out.push("", ...lines("Planned", planned));
  out.push("", "Evidence");
  out.push(
    e.timing.spreadMs === null
      ? `  openings: ${e.timing.known} of ${v.accounts.length} found in the fill history`
      : `  openings spread over ${duration(e.timing.spreadMs)}${e.timing.gapCv === null ? "" : `, gap variation ${e.timing.gapCv.toFixed(2)}`} → ${e.timing.jitter}`,
  );
  out.push(`  direct transfers between accounts: ${e.directTransfers.length}`);
  out.push(`  shared transfer counterparties: ${e.sharedCounterparties.length}`);
  out.push(
    `  accounts that traded before this position: ${e.reused.length}${e.unknownHistory.length ? ` (${e.unknownHistory.length} unknown)` : ""}`,
  );
  out.push(
    "",
    "Public data only: Hyperliquid clearinghouseState, userFills and userNonFundingLedgerUpdates. A heuristic, not a guarantee.",
  );
  return out.join("\n");
}

export async function main(
  argv: string[],
  io: CliIO = { out: console.log, err: console.error },
  fetchImpl?: typeof fetch,
): Promise<number> {
  const [cmd, ...rest] = argv;
  if (cmd !== "verify" || rest.includes("--help")) {
    (cmd === "verify" || cmd === "--help" || cmd === undefined ? io.out : io.err)(USAGE);
    return cmd === "verify" || cmd === "--help" ? 0 : 1;
  }
  const valued = new Set(["--threshold", "--coin", "--lookback", "--planned"]);
  const addresses = rest.filter((a, i) => !a.startsWith("--") && !valued.has(rest[i - 1] ?? ""));
  const threshold = Number(flag(rest, "threshold"));
  if (!(threshold > 0)) {
    io.err("--threshold <usd> is required: the position size at which you assume trackers flag a wallet.");
    return 1;
  }
  const lookback = flag(rest, "lookback");
  const plannedFile = flag(rest, "planned");
  try {
    const v = await verifyAccounts(addresses, {
      alertThreshold: threshold,
      coin: flag(rest, "coin"),
      lookbackDays: lookback ? Number(lookback) : undefined,
      client: createInfoClient(fetchImpl ? { fetch: fetchImpl } : {}),
    });
    const planned = plannedFile ? linkability(JSON.parse(readFileSync(plannedFile, "utf8")) as LinkInput) : undefined;
    io.out(rest.includes("--json") ? JSON.stringify({ ...v, planned }, null, 2) : formatText(v, planned));
    return 0;
  } catch (e) {
    io.err(e instanceof Error ? e.message : String(e));
    return 1;
  }
}

const invoked = process.argv[1] && /(?:^|[\\/])(?:cli\.(?:js|ts)|linkability)$/.test(process.argv[1]);
if (invoked) main(process.argv.slice(2)).then((code) => process.exit(code));
