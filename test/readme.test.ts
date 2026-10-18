// The README quick start is copied from this file. Keep them in sync.
import { expect, it } from "vitest";
import { linkability } from "../src/index";

it("README quick start", () => {
  const r = linkability({
    slices: [18_000, 26_500, 21_000, 31_000, 23_500], // notional per slice, USD
    leverages: [12, 10, 8.5, 7, 6],
    jitter: "heavy",
    freshAccounts: true,
    privateFunding: false,
    alertThreshold: 30_000, // your own alert threshold
  });
  // r.score 41, r.level "Medium"
  // r.factors: slices.some +8, size.varied +0, leverage.varied +0, timing.heavy +2,
  //            funding.shared +25 ("Fund each slice through a privacy rail."), alert.above +6

  expect(r.score).toBe(41);
  expect(r.level).toBe("Medium");
  expect(r.factors.map((f) => `${f.id} ${f.points}`)).toEqual([
    "slices.some 8",
    "size.varied 0",
    "leverage.varied 0",
    "timing.heavy 2",
    "funding.shared 25",
    "alert.above 6",
  ]);
});
