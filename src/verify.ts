// Scores a set of real Hyperliquid accounts from public data only.

import {
  counterpartiesOf,
  createInfoClient,
  openingOf,
  type InfoClient,
  type RawFill,
  type RawLedger,
  type RawState,
} from "./hyperliquid";
import { observedInput, type ObservedAccount, type ObservedEvidence } from "./observe";
import { linkability, type LinkInput, type LinkResult } from "./score";

export type VerifyOptions = {
  alertThreshold: number; // USD, the caller's
  coin?: string; // the market the slices are on; found automatically when every account holds exactly one common coin
  lookbackDays?: number; // ledger lookback for transfers, default 180
  client?: InfoClient;
  now?: number;
};

export type VerifyResult = {
  coin: string;
  side: 1 | -1;
  accounts: ObservedAccount[];
  input: LinkInput;
  evidence: ObservedEvidence;
  result: LinkResult;
  fetchedAt: number;
  sources: string[];
};

export const DEFAULT_LOOKBACK_DAYS = 180;

export async function verifyAccounts(addresses: string[], opts: VerifyOptions): Promise<VerifyResult> {
  const list = [...new Set(addresses.map((a) => a.trim().toLowerCase()))];
  if (list.length < 2) throw new Error("verify needs at least two distinct accounts");
  if (list.some((a) => !/^0x[0-9a-f]{40}$/.test(a))) throw new Error("every account must be a 0x address");
  if (!(opts.alertThreshold > 0)) throw new Error("alertThreshold must be a positive number of USD");
  const info = opts.client ?? createInfoClient();
  const now = opts.now ?? Date.now();
  const startTime = now - (opts.lookbackDays ?? DEFAULT_LOOKBACK_DAYS) * 86_400_000;

  const states = await Promise.all(list.map((user) => info({ type: "clearinghouseState", user }) as Promise<RawState>));
  const open = states.map((s) => new Map(s.assetPositions.map((p) => [p.position.coin, p.position])));

  let coin = opts.coin;
  if (!coin) {
    const common = [...(open[0]?.keys() ?? [])].filter((c) => open.every((m) => m.has(c)));
    if (common.length !== 1) {
      throw new Error(
        common.length
          ? `the accounts share several open markets (${common.join(", ")}); pass --coin`
          : "the accounts have no open market in common",
      );
    }
    coin = common[0]!;
  }
  const positions = open.map((m, i) => {
    const p = m.get(coin!);
    if (!p) throw new Error(`${list[i]} has no open ${coin} position`);
    return p;
  });
  const sides = positions.map((p) => (Number(p.szi) > 0 ? 1 : -1) as 1 | -1);
  if (new Set(sides).size > 1) throw new Error(`the ${coin} positions are not all on the same side`);
  const side = sides[0]!;

  const [fills, ledgers] = await Promise.all([
    Promise.all(list.map((user) => info({ type: "userFills", user }) as Promise<RawFill[]>)),
    Promise.all(
      list.map((user) => info({ type: "userNonFundingLedgerUpdates", user, startTime }) as Promise<RawLedger[]>),
    ),
  ]);

  const accounts: ObservedAccount[] = list.map((address, i) => {
    const p = positions[i]!;
    const value = Number(p.positionValue);
    const margin = Number(p.marginUsed);
    return {
      address,
      notional: value,
      leverage: margin > 0 ? value / margin : 0,
      ...openingOf(coin!, side, fills[i]!),
      counterparties: counterpartiesOf(address, ledgers[i]!),
    };
  });

  const { input, evidence } = observedInput(accounts, opts.alertThreshold);
  return {
    coin,
    side,
    accounts,
    input,
    evidence,
    result: linkability(input),
    fetchedAt: now,
    sources: ["clearinghouseState", "userFills", "userNonFundingLedgerUpdates"],
  };
}
