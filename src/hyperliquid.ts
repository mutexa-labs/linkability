// A small read-only client for the Hyperliquid info API and the reductions the verifier needs.
// Only public reads; nothing is signed or sent.

export const HYPERLIQUID_INFO_URL = "https://api.hyperliquid.xyz/info";

/** Hyperliquid returns at most this many fills per userFills call. */
export const FILLS_LIMIT = 2000;

export type InfoClient = (body: Record<string, unknown>) => Promise<unknown>;

export function createInfoClient(opts: { url?: string; fetch?: typeof fetch; timeoutMs?: number } = {}): InfoClient {
  const url = opts.url ?? HYPERLIQUID_INFO_URL;
  const f = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  return async (body) => {
    const r = await f(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) throw new Error(`Hyperliquid info ${String(body.type)} responded ${r.status}`);
    return r.json();
  };
}

export type RawPosition = {
  coin: string;
  szi: string;
  positionValue: string;
  marginUsed: string;
  leverage: { type: "isolated" | "cross"; value: number };
};
export type RawState = { assetPositions: { position: RawPosition }[]; time?: number };
export type RawFill = { coin: string; time: number; dir: string; startPosition: string; sz: string; side: string };
export type RawLedger = { time: number; hash: string; delta: Record<string, unknown> & { type: string } };

const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const addr = (v: unknown) => (typeof v === "string" && ADDRESS.test(v) ? v.toLowerCase() : null);

/** Ledger entry types that move funds between two user addresses. Vault flows are left out on purpose. */
export const FUNDING_TYPES = ["send", "internalTransfer", "subAccountTransfer", "spotTransfer"] as const;

/** Counterparties in transfers between this account and other user addresses (SPEC.md, "Funding"). */
export function counterpartiesOf(self: string, ledger: RawLedger[]): string[] {
  const me = self.toLowerCase();
  const out = new Set<string>();
  for (const r of ledger) {
    if (!(FUNDING_TYPES as readonly string[]).includes(r.delta.type)) continue;
    const from = addr(r.delta.user);
    const to = addr(r.delta.destination);
    if (!from || !to || from === to) continue;
    if (from === me) out.add(to);
    else if (to === me) out.add(from);
  }
  return [...out];
}

/**
 * When the current position on `coin` was opened from flat (or flipped), from the account's fills. Returns
 * `openedAt` (null when the opening fill is older than the history read) and whether the account traded
 * anything before it (null when the history cannot tell).
 */
export function openingOf(
  coin: string,
  side: 1 | -1,
  fills: RawFill[],
): { openedAt: number | null; tradedBefore: boolean | null } {
  const capped = fills.length >= FILLS_LIMIT;
  const sorted = [...fills].sort((a, b) => a.time - b.time);
  let openedAt: number | null = null;
  for (const f of sorted) {
    if (f.coin !== coin) continue;
    const start = Number(f.startPosition);
    const delta = (f.side === "B" ? 1 : -1) * Number(f.sz);
    const after = start + delta;
    // opened from flat, or flipped through zero into the current side
    if ((start === 0 || Math.sign(start) !== Math.sign(after)) && Math.sign(after) === side) openedAt = f.time;
  }
  if (openedAt === null) return { openedAt: null, tradedBefore: null };
  const before = sorted.some((f) => f.time < openedAt!);
  return { openedAt, tradedBefore: before ? true : capped ? null : false };
}
