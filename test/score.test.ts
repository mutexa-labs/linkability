import { describe, expect, it } from "vitest";
import { linkability, SPEC_VERSION, type Jitter, type LinkInput } from "../src/index";
import vectors from "../vectors/score.json" with { type: "json" };

describe("vectors/score.json", () => {
  it("matches the spec version", () => {
    expect(vectors.specVersion).toBe(SPEC_VERSION);
    expect(vectors.cases.length).toBeGreaterThanOrEqual(20);
  });

  it.each(vectors.cases.map((c) => [c.id, c] as const))("%s", (_, c) => {
    const r = linkability(c.input as LinkInput);
    expect(r.score).toBe(c.expected.score);
    expect(r.level).toBe(c.expected.level);
    expect(r.factors.map((f) => f.id)).toEqual(c.expected.factorIds);
    expect(r.factors.map((f) => f.points)).toEqual(c.expected.points);
    expect(r.specVersion).toBe(SPEC_VERSION);
  });
});

function seeded(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
const jitters: Jitter[] = ["off", "light", "heavy"];

function randomInput(r: () => number): LinkInput {
  const n = 1 + Math.floor(r() * 10);
  return {
    slices: Array.from({ length: n }, () => 1000 + r() * 100_000),
    leverages: Array.from({ length: n }, () => 1 + r() * 30),
    jitter: jitters[Math.floor(r() * 3)]!,
    freshAccounts: r() > 0.5,
    privateFunding: r() > 0.5,
    alertThreshold: 5000 + r() * 100_000,
  };
}

const RUNS = 500;
const score = (x: LinkInput) => linkability(x).score;

describe("monotonicity: privacy measures never raise the score", () => {
  it("more jitter", () => {
    const r = seeded(1);
    for (let i = 0; i < RUNS; i++) {
      const x = randomInput(r);
      const [off, light, heavy] = jitters.map((jitter) => score({ ...x, jitter }));
      expect(light).toBeLessThanOrEqual(off!);
      expect(heavy).toBeLessThanOrEqual(light!);
    }
  });

  it("private funding and fresh accounts", () => {
    const r = seeded(2);
    for (let i = 0; i < RUNS; i++) {
      const x = randomInput(r);
      expect(score({ ...x, privateFunding: true })).toBeLessThanOrEqual(score({ ...x, privateFunding: false }));
      expect(score({ ...x, freshAccounts: true })).toBeLessThanOrEqual(score({ ...x, freshAccounts: false }));
    }
  });

  it("more slices of the same total, with the same spread of sizes and leverage", () => {
    const r = seeded(3);
    for (let i = 0; i < RUNS; i++) {
      const x = randomInput(r);
      // splitting every slice in two keeps the coefficient of variation and halves each size
      const split: LinkInput = {
        ...x,
        slices: x.slices.flatMap((s) => [s / 2, s / 2]),
        leverages: x.leverages.flatMap((l) => [l, l]),
      };
      if (x.slices.length === 1) continue; // one slice has no size or leverage factor to compare
      expect(score(split)).toBeLessThanOrEqual(score(x));
    }
  });

  // Spread is monotone on its own factors. It can still raise the total by pushing the largest slice over the
  // alert threshold (SPEC.md, "Interactions"), so the threshold is set out of reach here.
  it("more size spread and more leverage spread, below the alert threshold", () => {
    const r = seeded(4);
    for (let i = 0; i < RUNS; i++) {
      const n = 2 + Math.floor(r() * 8);
      const mean = 10_000 + r() * 50_000;
      const base: LinkInput = {
        ...randomInput(r),
        slices: Array(n).fill(mean),
        leverages: Array(n).fill(10),
        alertThreshold: mean * 10,
      };
      const spread = (k: number) => Array.from({ length: n }, (_, j) => mean * (1 + k * (j / (n - 1) - 0.5)));
      let prev = score(base);
      for (const k of [0.05, 0.2, 0.4, 0.8]) {
        const s = score({ ...base, slices: spread(k), leverages: spread(k).map((v) => (v / mean) * 10) });
        expect(s).toBeLessThanOrEqual(prev);
        prev = s;
      }
    }
  });

  it("a higher alert threshold", () => {
    const r = seeded(5);
    for (let i = 0; i < RUNS; i++) {
      const x = randomInput(r);
      expect(score({ ...x, alertThreshold: x.alertThreshold * 2 })).toBeLessThanOrEqual(score(x));
    }
  });
});

describe("range and levels", () => {
  it("stays within 0..100 and maps levels at 30 and 60", () => {
    const r = seeded(6);
    for (let i = 0; i < RUNS; i++) {
      const res = linkability(randomInput(r));
      expect(res.score).toBeGreaterThanOrEqual(0);
      expect(res.score).toBeLessThanOrEqual(100);
      expect(res.level).toBe(res.score < 30 ? "Low" : res.score < 60 ? "Medium" : "High");
    }
  });

  it("gives every factor with points a fix, except the lowest-point ones", () => {
    const r = seeded(7);
    for (let i = 0; i < RUNS; i++) {
      for (const f of linkability(randomInput(r)).factors) {
        if (f.points > 8 || f.id === "timing.light" || f.id === "size.similar") expect(f.fix).toBeTruthy();
      }
    }
  });
});
