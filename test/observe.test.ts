import { describe, expect, it } from "vitest";
import { observedInput, timingClass, TIMING, type ObservedAccount } from "../src/index";

function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// Opening times shaped like the schedules @mutexa/ladder's buildSchedule produces over a window W:
// light = evenly spaced with ±40% of a step of noise, heavy = uniformly random over the window.
const lightTimes = (n: number, W: number, r: () => number) => {
  const step = W / (n - 1);
  return Array.from({ length: n }, (_, i) => Math.min(W, Math.max(0, i * step + (r() * 2 - 1) * 0.4 * step)));
};
const heavyTimes = (n: number, W: number, r: () => number) => Array.from({ length: n }, () => r() * W);

describe("timingClass", () => {
  it("treats openings within a minute, or unknown openings, as the same moment", () => {
    expect(timingClass([0, 30_000, TIMING.sameMomentMs]).jitter).toBe("off");
    expect(timingClass([0, 3_600_000, null]).jitter).toBe("off");
    expect(timingClass([1]).jitter).toBe("off");
  });

  it("calls two or three openings spread out light, since spacing cannot be judged", () => {
    expect(timingClass([0, 3_600_000]).jitter).toBe("light");
    expect(timingClass([0, 100_000, 3_600_000]).jitter).toBe("light");
  });

  it("separates even spacing from random spacing on simulated schedules", () => {
    const r = seeded(42);
    const W = 3_600_000;
    let light = 0;
    let heavy = 0;
    const runs = 300;
    for (let i = 0; i < runs; i++) {
      const n = 6 + Math.floor(r() * 10);
      if (timingClass(lightTimes(n, W, r)).jitter === "light") light++;
      if (timingClass(heavyTimes(n, W, r)).jitter === "heavy") heavy++;
    }
    // a heuristic: most schedules are recognised, not all
    expect(light / runs).toBeGreaterThan(0.95);
    expect(heavy / runs).toBeGreaterThan(0.8);
  });
});

const acct = (address: string, extra: Partial<ObservedAccount> = {}): ObservedAccount => ({
  address,
  notional: 10_000,
  leverage: 5,
  openedAt: 0,
  tradedBefore: false,
  counterparties: [],
  ...extra,
});
const A = "0x00000000000000000000000000000000000000a1";
const B = "0x00000000000000000000000000000000000000b2";
const C = "0x00000000000000000000000000000000000000c3";
const X = "0x00000000000000000000000000000000000000d4";

describe("observedInput", () => {
  it("flags a direct transfer between two accounts as shared funding", () => {
    const { input, evidence } = observedInput([acct(A, { counterparties: [B] }), acct(B), acct(C)], 50_000);
    expect(input.privateFunding).toBe(false);
    expect(evidence.directTransfers).toEqual([[A, B]]);
  });

  it("flags a counterparty two accounts both dealt with", () => {
    const { input, evidence } = observedInput(
      [acct(A, { counterparties: [X] }), acct(B, { counterparties: [X.toUpperCase().replace("0X", "0x")] }), acct(C)],
      50_000,
    );
    expect(input.privateFunding).toBe(false);
    expect(evidence.sharedCounterparties).toEqual([X]);
  });

  it("treats unknown history as not fresh and a clean set as private and fresh", () => {
    expect(observedInput([acct(A), acct(B, { tradedBefore: null })], 1).input.freshAccounts).toBe(false);
    expect(observedInput([acct(A), acct(B, { tradedBefore: true })], 1).evidence.reused).toEqual([B]);
    const clean = observedInput([acct(A, { counterparties: [X] }), acct(B), acct(C)], 50_000).input;
    expect(clean).toMatchObject({ freshAccounts: true, privateFunding: true, jitter: "off", alertThreshold: 50_000 });
    expect(clean.slices).toEqual([10_000, 10_000, 10_000]);
  });
});
