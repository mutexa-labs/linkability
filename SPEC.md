# Linkability score specification

**Spec version: 1** (`SPEC_VERSION` in the code, `specVersion` in every result and in `vectors/score.json`).

## Purpose

When one position is split into slices held by separate accounts, an observer who wants to know who holds
what tries to cluster the accounts back together. The linkability score estimates how easy that is from the
features of the slices themselves: how many there are, how alike they look, when they open, whether the
accounts have history, and how they were funded.

The score is a **heuristic**. It weights public signals that analysts use; it is not a statistical model and
it is not a guarantee. A low score means none of the obvious signals are present, not that the slices cannot
be linked.

## Scale and levels

- `score` is an integer from **0** (hard to link) to **100** (easy to link): the sum of the points of every
  factor below, rounded, then clamped to 0..100.
- `level` is **Low** below 30, **Medium** from 30 to 59, **High** from 60.

## Input

| Field | Type | Meaning |
|---|---|---|
| `slices` | `number[]` | Notional per slice, USD |
| `leverages` | `number[]` | Leverage per slice (notional / margin) |
| `jitter` | `"off" \| "light" \| "heavy"` | How spread out the openings are in time |
| `freshAccounts` | `boolean` | No slice account was used before this position |
| `privateFunding` | `boolean` | No slice was funded from a wallet visible to the others |
| `alertThreshold` | `number` | The caller's alert threshold, USD: the position size at which they assume trackers flag a wallet |

`n` is the number of slices. `cv(x)` is the coefficient of variation of a list: population standard deviation
divided by the mean (0 for an empty list or a zero mean).

## Factors

Each result lists its factors in this order. `id` is stable; `label` is display text and may change without a
spec version bump. Factors with 0 points are still listed so the reader sees what was checked.

### Slice count (always one of these)

| id | Condition | Points | Fix |
|---|---|---|---|
| `slices.single` | n ≤ 1 | 40 | Split into at least 3 slices. |
| `slices.few` | 2 ≤ n ≤ 3 | 18 | Use 4 or more slices so each looks like an ordinary user. |
| `slices.some` | 4 ≤ n ≤ 6 | 8 | |
| `slices.many` | n ≥ 7 | 2 | |

### Size spread (only when n > 1)

| id | Condition | Points | Fix |
|---|---|---|---|
| `size.identical` | cv(slices) < 0.05 | 15 | Turn up size variation so slices differ. |
| `size.similar` | 0.05 ≤ cv(slices) < 0.15 | 7 | More size variation makes slices harder to match. |
| `size.varied` | cv(slices) ≥ 0.15 | 0 | |

### Leverage spread (only when n > 1)

| id | Condition | Points | Fix |
|---|---|---|---|
| `leverage.same` | cv(leverages) < 0.03 | 8 | Widen the band so margin differs per slice. |
| `leverage.varied` | cv(leverages) ≥ 0.03 | 0 | |

### Timing (always one of these)

| id | Condition | Points | Fix |
|---|---|---|---|
| `timing.none` | jitter = off | 20 | Turn on timing jitter. |
| `timing.light` | jitter = light | 8 | Heavy jitter spreads fills further apart. |
| `timing.heavy` | jitter = heavy | 2 | |

### Accounts and funding

| id | Condition | Points | Fix |
|---|---|---|---|
| `accounts.reused` | freshAccounts = false | 12 | Use fresh accounts for this cycle. |
| `funding.shared` | privateFunding = false | 25 | Fund each slice through a privacy rail. |

### Alert threshold

| id | Condition | Points | Fix |
|---|---|---|---|
| `alert.above` | k = number of slices with notional **strictly above** alertThreshold, k > 0 | min(6·k, 18) | Add slices or lower the total so each stays under it. |

## Interactions

Every privacy measure lowers or keeps the score when everything else is held: more jitter, fresh accounts,
private funding, a higher threshold, and splitting each slice further with the same spread. One interaction
is deliberate: more size spread lowers the size factor but can push the largest slice above the alert
threshold, which adds `alert.above` points. The test suite checks monotonicity with the threshold out of reach
and the vectors cover the threshold factor on its own.

## Observed input

The verifier builds the same input from what public data shows for a set of real Hyperliquid accounts that
hold the same market on the same side.

| Field | Observed from |
|---|---|
| `slices` | `positionValue` of each account's position (`clearinghouseState`) |
| `leverages` | `positionValue / marginUsed` |
| `jitter` | opening times, see "Timing" |
| `freshAccounts` | every account has fills in the history read, and none before its opening fill; unknown counts as not fresh |
| `privateFunding` | no transfer between two of the accounts and no outside address that two or more accounts sent to or received from |
| `alertThreshold` | the caller's input |

### Timing

The opening time of an account is the time of the fill that opened its current position from flat, or flipped
it into the current side (`userFills`, using `startPosition`, `side` and `sz`). With the sorted opening times:

1. If any account's opening is not in the history read, or fewer than two are known: **off**.
2. If all openings fall within **60 seconds**: **off** (the same moment).
3. If there are fewer than **3 gaps** between openings: **light** (spacing cannot be judged).
4. If the coefficient of variation of the gaps is **0.6 or more**: **heavy** (random spacing); otherwise
   **light** (even spacing).

These thresholds were set against the two schedule shapes of `@mutexa/ladder`'s `buildSchedule`: evenly
spaced with ±40% noise (mean gap variation about 0.3 for ten openings) and uniformly random over the window (about 0.9).
The test suite checks the classification on simulated schedules of both shapes.

### Funding

Counterparties are read from `userNonFundingLedgerUpdates` over a lookback (180 days by default), from entries
of type `send`, `internalTransfer`, `subAccountTransfer` and `spotTransfer` that name two different user
addresses. Vault deposits, withdrawals and distributions are left out (a shared vault is not a shared
wallet), and bridge deposits are left out because the feed does not name their source.

## What the score does not measure

- **Venue-side data.** Venues see their own accounts, IPs and sign-ups. The score only covers what public data
  shows.
- **Network metadata** such as IP addresses or RPC providers, unless the trader routes around them.
- **Off-chain behaviour**: social posts, screenshots, reused labels.
- **Funding on other chains.** The verifier reads Hyperliquid's own ledger. Who sent funds to each account
  before it deposited is not read.
- **Trading patterns over time** beyond the opening times: matching exits, the same set of markets, the same
  active hours. These are signals an analyst can still use.
- **Integrator codes.** Fills routed with an integrator or builder code are visible as such; the cover is the
  set of all users of that code.

## Versioning

Any change to a condition, threshold or point value bumps the spec version, updates `SPEC_VERSION`, and
regenerates `vectors/score.json` in the same commit. Changes to labels or fixes do not. Changes to the observed
input rules (timing thresholds, funding entry types) also bump the spec version, because the same accounts
would score differently.
