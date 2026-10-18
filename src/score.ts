// Linkability score: how easily a set of slices could be clustered back into one position.
// The rules, points and thresholds are specified in SPEC.md. Any change here bumps SPEC_VERSION and
// regenerates vectors/score.json in the same commit.

export const SPEC_VERSION = "1";

export type Jitter = "off" | "light" | "heavy";

export type LinkInput = {
  slices: number[]; // notional per slice, USD
  leverages: number[]; // leverage per slice
  jitter: Jitter; // timing spread of the openings
  freshAccounts: boolean; // no account was used before this position
  privateFunding: boolean; // no slice funded from a wallet visible to the others
  alertThreshold: number; // the caller's alert threshold, USD
};

export type LinkFactorId =
  | "slices.single"
  | "slices.few"
  | "slices.some"
  | "slices.many"
  | "size.identical"
  | "size.similar"
  | "size.varied"
  | "leverage.same"
  | "leverage.varied"
  | "timing.none"
  | "timing.light"
  | "timing.heavy"
  | "accounts.reused"
  | "funding.shared"
  | "alert.above";

export type LinkFactor = { id: LinkFactorId; label: string; points: number; fix?: string };
export type LinkLevel = "Low" | "Medium" | "High";
export type LinkResult = { score: number; level: LinkLevel; factors: LinkFactor[]; specVersion: string };

/** Coefficient of variation (population standard deviation / mean); 0 for an empty or zero-mean list. */
export function coefficientOfVariation(arr: number[]): number {
  if (!arr.length) return 0;
  const m = arr.reduce((a, b) => a + b, 0) / arr.length;
  if (!m) return 0;
  return Math.sqrt(arr.reduce((a, b) => a + (b - m) ** 2, 0) / arr.length) / m;
}

export const levelOf = (score: number): LinkLevel => (score < 30 ? "Low" : score < 60 ? "Medium" : "High");

/** Scores a set of slices. 0 is hard to link, 100 is easy. A heuristic, not a statistical guarantee. */
export function linkability(x: LinkInput): LinkResult {
  const f: LinkFactor[] = [];
  const n = x.slices.length;

  if (n <= 1)
    f.push({
      id: "slices.single",
      label: "One account holds the whole position",
      points: 40,
      fix: "Split into at least 3 slices.",
    });
  else if (n < 4)
    f.push({
      id: "slices.few",
      label: `Only ${n} slices`,
      points: 18,
      fix: "Use 4 or more slices so each looks like an ordinary user.",
    });
  else if (n < 7) f.push({ id: "slices.some", label: `${n} slices`, points: 8 });
  else f.push({ id: "slices.many", label: `${n} slices`, points: 2 });

  if (n > 1) {
    const sizeCv = coefficientOfVariation(x.slices);
    if (sizeCv < 0.05)
      f.push({
        id: "size.identical",
        label: "Slice sizes are identical",
        points: 15,
        fix: "Turn up size variation so slices differ.",
      });
    else if (sizeCv < 0.15)
      f.push({
        id: "size.similar",
        label: "Slice sizes are similar",
        points: 7,
        fix: "More size variation makes slices harder to match.",
      });
    else f.push({ id: "size.varied", label: "Slice sizes vary", points: 0 });

    const levCv = coefficientOfVariation(x.leverages);
    if (levCv < 0.03)
      f.push({
        id: "leverage.same",
        label: "Every slice uses the same leverage",
        points: 8,
        fix: "Widen the band so margin differs per slice.",
      });
    else f.push({ id: "leverage.varied", label: "Leverage differs per slice", points: 0 });
  }

  if (x.jitter === "off")
    f.push({ id: "timing.none", label: "Slices open at the same moment", points: 20, fix: "Turn on timing jitter." });
  else if (x.jitter === "light")
    f.push({
      id: "timing.light",
      label: "Light timing jitter",
      points: 8,
      fix: "Heavy jitter spreads fills further apart.",
    });
  else f.push({ id: "timing.heavy", label: "Heavy timing jitter", points: 2 });

  if (!x.freshAccounts)
    f.push({
      id: "accounts.reused",
      label: "Accounts reused from earlier trades",
      points: 12,
      fix: "Use fresh accounts for this cycle.",
    });
  if (!x.privateFunding)
    f.push({
      id: "funding.shared",
      label: "Slices funded from one visible wallet",
      points: 25,
      fix: "Fund each slice through a privacy rail.",
    });

  const above = x.slices.filter((s) => s > x.alertThreshold).length;
  if (above)
    f.push({
      id: "alert.above",
      label: `${above} slice${above > 1 ? "s" : ""} above your alert threshold`,
      points: Math.min(6 * above, 18),
      fix: "Add slices or lower the total so each stays under it.",
    });

  const score = Math.max(0, Math.min(100, Math.round(f.reduce((a, b) => a + b.points, 0))));
  return { score, level: levelOf(score), factors: f, specVersion: SPEC_VERSION };
}
