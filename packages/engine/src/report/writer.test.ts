// Reporter (AI_AGENT_SPEC.md §3.6): the fact check refuses invented numbers, quotes and paths; a bad entry
// gets one retry, then the deterministic template stays. The template is always kept for the scorer (D53).
import { describe, expect, it } from "vitest";
import { testGateway } from "../../test/mock-llm";
import type { Finding } from "../types";
import { factCheck, factSheet, writeFindings } from "./writer";

function finding(id: string): Finding {
  return {
    id,
    fingerprint: "fp_0000000000000000",
    kind: "bug",
    tier: "confirmed",
    tierReason: "r",
    severity: "high",
    category: "functional",
    source: { kind: "detector", id: "DET-TOTALS" },
    route: "/quote",
    title: "The amounts on /quote don't add up to the Total",
    impact: "People could be charged, or shown, the wrong amount.",
    expected: "Total equals Subtotal $135.00 + GST (15%) $20.25 = 155.25.",
    actual: "Total shows $178.54, which is 23.29 away from 155.25.",
    whyFlagged: "DET-TOTALS",
    steps: ["Go to /quote", 'Click the "Calculate" button'],
    evidenceIds: [],
    instances: [],
    candidateIds: [],
    replay: { attempts: 2, reproduced: 2 },
    signals: {},
  };
}

const good = (id: string) => ({
  id,
  title: "The quote total is wrong",
  impact: "Customers are shown a higher price than they should pay.",
  expected: "The total should be 155.25 (the subtotal plus GST).",
  actual: "The total shows $178.54.",
  likelyCause: "The tax may be added twice.",
});

describe("factCheck", () => {
  const sheet = factSheet(finding("fd_1"));
  it("accepts wording that only uses the facts", () => {
    expect(factCheck(good("fd_1"), sheet)).toEqual([]);
  });
  it("refuses an invented number, quote or path", () => {
    expect(factCheck({ ...good("fd_1"), actual: "The total shows $180.00." }, sheet)[0]).toContain(
      "180.00",
    );
    expect(
      factCheck({ ...good("fd_1"), title: 'The "Pay now" total is wrong' }, sheet)[0],
    ).toContain("Pay now");
    expect(
      factCheck({ ...good("fd_1"), actual: "On /checkout the total is $178.54" }, sheet)[0],
    ).toContain("/checkout");
  });
});

describe("writeFindings", () => {
  it("applies checked wording, keeps the template, labels the cause a hypothesis", async () => {
    const t = await testGateway([{ json: { findings: [good("fd_1")] } }]);
    const f = finding("fd_1");
    const m = await writeFindings(t.gateway, [f], Date.now() + 30_000);
    expect(m).toEqual({ written: 1, factCheckFailures: 0, templateFallbacks: 0 });
    expect(f.title).toBe("The quote total is wrong");
    expect(f.template?.title).toBe("The amounts on /quote don't add up to the Total");
    expect(f.likelyCause).toEqual({ text: "The tax may be added twice.", isHypothesis: true });
    expect(f.wording).toBe("writer");
  });
  it("retries a failed fact check once, then keeps the template", async () => {
    const bad = { ...good("fd_2"), actual: "The total shows $999.99." };
    const t = await testGateway([{ json: { findings: [bad] } }, { json: { findings: [bad] } }]);
    const f = finding("fd_2");
    const m = await writeFindings(t.gateway, [f], Date.now() + 30_000);
    expect(m).toEqual({ written: 0, factCheckFailures: 2, templateFallbacks: 1 });
    expect(f.title).toBe("The amounts on /quote don't add up to the Total");
    expect(f.wording).toBeUndefined();
    expect(t.smart.prompts[1]).toContain("999.99");
  });
});
