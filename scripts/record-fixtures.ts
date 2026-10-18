// Records public Hyperliquid responses for the verifier test, with every address and hash replaced by an
// obviously fake one.
//
//   node scripts/record-fixtures.ts [--coin BTC] [--accounts 3] [address ...]
//
// Without addresses, it picks accounts from the public recentTrades feed of the coin that hold an open
// position on it on the same side and have a short fill history (so the fixture stays small). Only the
// fields the verifier reads are kept.

import { writeFileSync } from "node:fs";

const API = "https://api.hyperliquid.xyz/info";
const LOOKBACK_DAYS = 180;
const MAX_FILLS = 1000;

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const coin = arg("coin") ?? "BTC";
const want = Number(arg("accounts") ?? 3);
const given = process.argv
  .slice(2)
  .filter((a) => /^0x[0-9a-fA-F]{40}$/.test(a))
  .map((a) => a.toLowerCase());

async function info<T>(body: Record<string, unknown>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) return (await r.json()) as T;
    if (r.status !== 429 || attempt >= 4) throw new Error(`${String(body.type)}: HTTP ${r.status}`);
    await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
  }
}

type Position = {
  coin: string;
  szi: string;
  positionValue: string;
  marginUsed: string;
  leverage: { type: string; value: number };
};
type State = { assetPositions: { position: Position }[] };
type Fill = { coin: string; time: number; dir: string; startPosition: string; sz: string; side: string };
type Ledger = { time: number; hash: string; delta: Record<string, unknown> & { type: string } };

const now = Date.now();
const startTime = now - LOOKBACK_DAYS * 86_400_000;

let candidates = given;
if (!candidates.length) {
  const trades = await info<{ users: [string, string] }[]>({ type: "recentTrades", coin });
  candidates = [...new Set(trades.flatMap((t) => t.users.map((u) => u.toLowerCase())))];
}

const picked: { user: string; state: State; fills: Fill[]; ledger: Ledger[]; side: number }[] = [];
for (const user of candidates) {
  if (picked.length >= want) break;
  const state = await info<State>({ type: "clearinghouseState", user });
  const p = state.assetPositions.find((x) => x.position.coin === coin)?.position;
  if (!p) continue;
  const side = Math.sign(Number(p.szi));
  if (picked.length && side !== picked[0]!.side) continue;
  const fills = await info<Fill[]>({ type: "userFills", user });
  if (!given.length && fills.length > MAX_FILLS) continue;
  const ledger = await info<Ledger[]>({ type: "userNonFundingLedgerUpdates", user, startTime });
  picked.push({ user, state, fills, ledger, side });
}
if (picked.length < 2) throw new Error(`found ${picked.length} matching accounts; pass addresses`);

// consistent fake replacements: accounts first, then every other address and hash in the order seen
const fakes = new Map<string, string>();
const fakeAddress = (real: string) => {
  const k = real.toLowerCase();
  if (!fakes.has(k)) fakes.set(k, `0x${(fakes.size + 1).toString(16).padStart(4, "0").padStart(40, "f")}`);
  return fakes.get(k)!;
};
let hashes = 0;
const fakeHash = () => `0x${(++hashes).toString(16).padStart(64, "e")}`;
for (const p of picked) fakeAddress(p.user);
const scrub = (v: unknown): unknown => (typeof v === "string" && /^0x[0-9a-fA-F]{40}$/.test(v) ? fakeAddress(v) : v);

const responses: Record<string, unknown> = {};
for (const p of picked) {
  const u = fakeAddress(p.user);
  responses[`clearinghouseState:${u}`] = {
    assetPositions: p.state.assetPositions.map(({ position: x }) => ({
      position: {
        coin: x.coin,
        szi: x.szi,
        positionValue: x.positionValue,
        marginUsed: x.marginUsed,
        leverage: x.leverage,
      },
    })),
  };
  responses[`userFills:${u}`] = p.fills.map((f) => ({
    coin: f.coin,
    time: f.time,
    dir: f.dir,
    startPosition: f.startPosition,
    sz: f.sz,
    side: f.side,
  }));
  responses[`userNonFundingLedgerUpdates:${u}`] = p.ledger.map((l) => ({
    time: l.time,
    hash: fakeHash(),
    delta: Object.fromEntries(
      Object.entries(l.delta)
        .filter(([k]) => ["type", "user", "destination", "usdc", "amount", "usdcValue", "token"].includes(k))
        .map(([k, v]) => [k, scrub(v)]),
    ),
  }));
}

const out = {
  recordedAt: new Date(now).toISOString(),
  now,
  lookbackDays: LOOKBACK_DAYS,
  coin,
  accounts: picked.map((p) => fakeAddress(p.user)),
  note: "Public Hyperliquid info API responses, trimmed to the fields the verifier reads. Every address and hash is replaced by a fake one.",
  responses,
};
const file = new URL(`../test/fixtures/verify/${coin.toLowerCase()}-${picked.length}-accounts.json`, import.meta.url);
writeFileSync(file, JSON.stringify(out, null, 2) + "\n");
console.error(`wrote ${file.pathname}: ${picked.length} accounts, ${fakes.size} fake addresses, ${hashes} fake hashes`);
