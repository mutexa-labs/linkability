import { describe, expect, it } from "vitest";
import { counterpartiesOf, openingOf, verifyAccounts, type InfoClient } from "../src/verify-entry";
import fixture from "./fixtures/verify/btc-3-accounts.json" with { type: "json" };

const responses = fixture.responses as Record<string, unknown>;
const fixtureClient: InfoClient = async (body) => {
  const key = `${String(body.type)}:${String(body.user)}`;
  if (!(key in responses)) throw new Error(`no fixture for ${key}`);
  return structuredClone(responses[key]);
};

describe("verifyAccounts on recorded public data", () => {
  it("scores the recorded accounts", async () => {
    const v = await verifyAccounts(fixture.accounts, {
      alertThreshold: 100_000,
      client: fixtureClient,
      now: fixture.now,
    });
    expect(v.coin).toBe(fixture.coin);
    expect(v.accounts).toHaveLength(fixture.accounts.length);
    expect(v.result.specVersion).toBe("1");
    expect(v.input.slices.every((s) => s > 0)).toBe(true);
    expect(v.sources).toEqual(["clearinghouseState", "userFills", "userNonFundingLedgerUpdates"]);
    // snapshot of what this recording shows, so a change in any observation rule is visible in review
    expect({
      input: v.input,
      evidence: v.evidence,
      score: v.result.score,
      factors: v.result.factors.map((f) => f.id),
    }).toMatchSnapshot();
  });

  it("finds the common coin and refuses bad input", async () => {
    const opts = { alertThreshold: 1, client: fixtureClient, now: fixture.now };
    await expect(verifyAccounts([fixture.accounts[0]!], opts)).rejects.toThrow(/two distinct/);
    await expect(verifyAccounts(["0x12", fixture.accounts[0]!], opts)).rejects.toThrow(/0x address/);
    await expect(verifyAccounts(fixture.accounts, { ...opts, alertThreshold: 0 })).rejects.toThrow(/alertThreshold/);
    await expect(verifyAccounts(fixture.accounts, { ...opts, coin: "NOPE" })).rejects.toThrow(/no open NOPE/);
  });
});

describe("reductions", () => {
  const me = "0x00000000000000000000000000000000000000a1";
  const other = "0x00000000000000000000000000000000000000b2";
  const vault = "0x00000000000000000000000000000000000000c3";

  it("keeps transfers between user addresses and leaves out vault flows and deposits", () => {
    const ledger = [
      { time: 1, hash: "h1", delta: { type: "send", user: other, destination: me, amount: "10" } },
      { time: 2, hash: "h2", delta: { type: "vaultDeposit", vault, usdc: "5" } },
      { time: 3, hash: "h3", delta: { type: "deposit", usdc: "100" } },
      { time: 4, hash: "h4", delta: { type: "subAccountTransfer", user: me, destination: other, usdc: "1" } },
    ];
    expect(counterpartiesOf(me, ledger)).toEqual([other]);
  });

  it("finds the fill that opened the current position, including a flip", () => {
    const fills = [
      { coin: "ETH", time: 10, dir: "Open Long", startPosition: "0", sz: "1", side: "B" },
      { coin: "ETH", time: 20, dir: "Long > Short", startPosition: "1", sz: "3", side: "A" },
      { coin: "ETH", time: 30, dir: "Open Short", startPosition: "-2", sz: "1", side: "A" },
    ];
    expect(openingOf("ETH", -1, fills)).toEqual({ openedAt: 20, tradedBefore: true });
    expect(openingOf("ETH", 1, fills.slice(0, 1))).toEqual({ openedAt: 10, tradedBefore: false });
    expect(openingOf("BTC", 1, fills)).toEqual({ openedAt: null, tradedBefore: null });
  });
});
