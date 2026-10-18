# @mutexa/linkability

How easily can a set of position slices be clustered back into one position? This repo has three parts:

- **[`SPEC.md`](SPEC.md)** — what the linkability score measures, every factor with its stable id, condition,
  points and suggested fix, how observed accounts are turned into the same input, and what the score cannot see.
- **`linkability(input)`** — the scorer, 0 (hard to link) to 100 (easy to link), with a `specVersion` in every
  result.
- **`linkability verify`** — a CLI that scores real Hyperliquid accounts from public data only, so you can see
  what the chain actually shows after a trade.

Golden vectors in [`vectors/score.json`](vectors/score.json) let any other implementation check itself.

The score is a heuristic estimate, not a statistical guarantee. See "What the score does not measure" in the
spec.

## Install

```sh
pnpm add github:mutexa-labs/linkability#v0.1.0
```

Node 22 or later. ESM only. The scorer (`@mutexa/linkability`) has no dependencies and does no I/O. The
verifier (`@mutexa/linkability/verify`) uses `fetch` against the public Hyperliquid info API.

## Quick start

From [`test/readme.test.ts`](test/readme.test.ts):

```ts
import { linkability } from "@mutexa/linkability";

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
```

### Verify real accounts

```sh
npx linkability verify 0xAccountA 0xAccountB 0xAccountC --threshold 30000
npx linkability verify 0xAccountA 0xAccountB --threshold 30000 --coin ETH --json
npx linkability verify 0xAccountA 0xAccountB --threshold 30000 --planned plan.json
```

It reads, for each account, `clearinghouseState` (size and leverage), `userFills` (when the current position
opened, and whether the account traded before) and `userNonFundingLedgerUpdates` (transfers between user
addresses over the last 180 days), builds the input as `SPEC.md` describes, and prints the observed score with
its evidence. `--planned` takes a JSON `LinkInput` of the planned trade and prints its score next to the
observed one. `--threshold` is required; there is no default.

Nothing is sent anywhere except those public reads. Run it only on accounts you control or have a reason to
check.

From code:

```ts
import { verifyAccounts } from "@mutexa/linkability/verify";
const v = await verifyAccounts(["0x…", "0x…"], { alertThreshold: 30_000 });
console.log(v.result.score, v.evidence);
```

## API

| Export | What it does |
|---|---|
| `linkability(input: LinkInput): LinkResult` | `{ score, level, factors: { id, label, points, fix? }[], specVersion }` |
| `SPEC_VERSION` | `"1"` |
| `coefficientOfVariation(list)`, `levelOf(score)` | The helpers the spec uses |
| `observedInput(accounts, alertThreshold)` | Observed accounts → `{ input, evidence }` (pure) |
| `timingClass(openedAt[])` | Opening times → `off` / `light` / `heavy` with the spread and gap variation |
| `TIMING` | The timing thresholds from the spec |
| `verifyAccounts(addresses, opts)` (`/verify`) | Reads public data and returns `{ coin, side, accounts, input, evidence, result, fetchedAt, sources }` |
| `createInfoClient({ url?, fetch? })` (`/verify`) | The small Hyperliquid info client the verifier uses; inject `fetch` for tests |
| `counterpartiesOf`, `openingOf` (`/verify`) | The two reductions from raw ledger entries and fills |

### Factor ids

`slices.single` · `slices.few` · `slices.some` · `slices.many` · `size.identical` · `size.similar` ·
`size.varied` · `leverage.same` · `leverage.varied` · `timing.none` · `timing.light` · `timing.heavy` ·
`accounts.reused` · `funding.shared` · `alert.above`. Points and conditions are in the spec.

## Tests

- **Vectors:** 20 cases in `vectors/score.json` covering every factor and both level boundaries. Expected values
  were produced by the Mutexa app's own scorer, an independent copy of the same rules.
- **Monotonicity:** more jitter, fresh accounts, private funding, a higher threshold and further splitting
  never raise the score; more size and leverage spread never raise it below the alert threshold.
- **Timing classes** on simulated even and random schedules.
- **Verifier and CLI** against public Hyperliquid responses recorded with `scripts/record-fixtures.ts`, with
  every address and hash replaced by a fake one.

## How Mutexa uses it

The Mutexa app shows this score on every plan, computed on the device from the plan's slices, jitter, account
and funding choices and your alert threshold. The verifier is the post-trade check: the same score from what
public data shows. Plans come from [`@mutexa/ladder`](https://github.com/mutexa-labs/liquidation-ladder).

## Limitations

- **A heuristic.** Points weight signals; they are not probabilities.
- **What splitting does not hide** (whitepaper §5.2): venues still see their own accounts; clustering by timing
  is still possible, and jitter makes it harder, not impossible; very large positions still move markets;
  splitting and privacy rails cost extra; fills routed with an integrator code are marked as Mutexa fills, so
  the cover is the set of all Mutexa users.
- **Verifier scope.** Hyperliquid only. At most the latest 2000 fills per account are read; an opening older
  than that counts as unknown, and unknown history counts as not fresh. Funding on other chains (who sent funds
  to each account before it deposited) is not read.

Not in this release: Arbitrum-side funding analysis for Hyperliquid Bridge2 deposits, pair-level signals such as
matching exits or the same active hours, venues other than Hyperliquid.

## Stability

0.x: any change in points, thresholds or observed-input rules bumps the spec version and is a minor version with a
changelog entry.

## License

MIT © 2026 Mutexa
