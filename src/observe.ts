// From public records of real accounts to a LinkInput, so the same score can be computed for what the
// chain actually shows after a trade. Pure: no I/O. The rules are specified in SPEC.md, "Observed input".

import { coefficientOfVariation, type Jitter, type LinkInput } from "./score";

export type ObservedAccount = {
  address: string;
  notional: number; // USD value of the position now
  leverage: number; // position value / margin used
  openedAt: number | null; // ms, the fill that opened the current position from flat; null when not in the history read
  tradedBefore: boolean | null; // any fill before openedAt; null when the history read cannot tell
  counterparties: string[]; // other addresses this account sent funds to or received funds from
};

/** Thresholds of the observed timing classes (SPEC.md, "Timing"). */
export const TIMING = {
  /** All openings within this window count as the same moment. */
  sameMomentMs: 60_000,
  /** Gaps between sorted openings with at least this coefficient of variation count as random ("heavy"). */
  heavyGapCv: 0.6,
  /** Fewer gaps than this cannot tell even spacing from random spacing; classed as "light". */
  minGapsForHeavy: 3,
} as const;

export type TimingEvidence = { jitter: Jitter; known: number; spreadMs: number | null; gapCv: number | null };

/** Classifies the opening times of the slices into off / light / heavy. Unknown times count as "off". */
export function timingClass(openedAt: (number | null)[]): TimingEvidence {
  const times = openedAt.filter((t): t is number => typeof t === "number").sort((a, b) => a - b);
  if (times.length < 2 || times.length < openedAt.length) {
    return { jitter: "off", known: times.length, spreadMs: null, gapCv: null };
  }
  const spreadMs = times[times.length - 1]! - times[0]!;
  if (spreadMs <= TIMING.sameMomentMs) return { jitter: "off", known: times.length, spreadMs, gapCv: null };
  const gaps = times.slice(1).map((t, i) => t - times[i]!);
  if (gaps.length < TIMING.minGapsForHeavy) return { jitter: "light", known: times.length, spreadMs, gapCv: null };
  const gapCv = coefficientOfVariation(gaps);
  return { jitter: gapCv >= TIMING.heavyGapCv ? "heavy" : "light", known: times.length, spreadMs, gapCv };
}

export type ObservedEvidence = {
  timing: TimingEvidence;
  directTransfers: [string, string][]; // pairs of observed accounts that moved funds between each other
  sharedCounterparties: string[]; // addresses outside the set that two or more accounts dealt with
  reused: string[]; // accounts that traded before this position
  unknownHistory: string[]; // accounts whose history read could not tell
};

/** Builds the scorer input from observed accounts. `alertThreshold` is the caller's, in USD. */
export function observedInput(
  accounts: ObservedAccount[],
  alertThreshold: number,
): { input: LinkInput; evidence: ObservedEvidence } {
  const set = new Set(accounts.map((a) => a.address.toLowerCase()));
  const timing = timingClass(accounts.map((a) => a.openedAt));

  const direct = new Map<string, [string, string]>();
  const seenBy = new Map<string, Set<string>>();
  for (const a of accounts) {
    const me = a.address.toLowerCase();
    for (const raw of a.counterparties) {
      const c = raw.toLowerCase();
      if (c === me) continue;
      if (set.has(c)) {
        const pair = [me, c].sort() as [string, string];
        direct.set(pair.join("|"), pair);
      } else {
        const s = seenBy.get(c) ?? new Set<string>();
        s.add(me);
        seenBy.set(c, s);
      }
    }
  }
  const sharedCounterparties = [...seenBy.entries()].filter(([, s]) => s.size > 1).map(([c]) => c);

  const reused = accounts.filter((a) => a.tradedBefore === true).map((a) => a.address.toLowerCase());
  const unknownHistory = accounts.filter((a) => a.tradedBefore === null).map((a) => a.address.toLowerCase());

  return {
    input: {
      slices: accounts.map((a) => a.notional),
      leverages: accounts.map((a) => a.leverage),
      jitter: timing.jitter,
      freshAccounts: accounts.length > 0 && reused.length === 0 && unknownHistory.length === 0,
      privateFunding: direct.size === 0 && sharedCounterparties.length === 0,
      alertThreshold,
    },
    evidence: { timing, directTransfers: [...direct.values()], sharedCounterparties, reused, unknownHistory },
  };
}
