import { describe, expect, it } from "vitest";
import { main } from "../src/cli";
import fixture from "./fixtures/verify/btc-3-accounts.json" with { type: "json" };

const responses = fixture.responses as Record<string, unknown>;
const fakeFetch = (async (_url: string, init: { body: string }) => {
  const body = JSON.parse(init.body) as { type: string; user: string };
  return new Response(JSON.stringify(responses[`${body.type}:${body.user}`]), { status: 200 });
}) as unknown as typeof fetch;

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (s: string) => out.push(s), err: (s: string) => err.push(s) }, out, err };
}

describe("linkability CLI", () => {
  it("prints the observed score from public data", async () => {
    const t = io();
    const code = await main(["verify", ...fixture.accounts, "--threshold", "100000"], t.io, fakeFetch);
    expect(code).toBe(0);
    expect(t.out.join("\n")).toMatch(/Observed: \d+ \((Low|Medium|High)\) · spec 1/);
    expect(t.out.join("\n")).toContain(`${fixture.coin} `);
  });

  it("prints JSON", async () => {
    const t = io();
    await main(["verify", ...fixture.accounts, "--threshold", "100000", "--json"], t.io, fakeFetch);
    const j = JSON.parse(t.out.join(""));
    expect(j.result.specVersion).toBe("1");
    expect(j.coin).toBe(fixture.coin);
  });

  it("requires a threshold and prints usage for unknown commands", async () => {
    const t = io();
    expect(await main(["verify", ...fixture.accounts], t.io, fakeFetch)).toBe(1);
    expect(t.err.join("")).toMatch(/--threshold/);
    const u = io();
    expect(await main(["nope"], u.io)).toBe(1);
    expect(u.err.join("")).toMatch(/Usage/);
  });
});
