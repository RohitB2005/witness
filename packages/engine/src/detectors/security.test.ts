// DET-SECRETS, DET-DBERROR and DET-AUTHZ pure logic (ADDENDUM A1, A3, A4). Every fake key here is built from
// fragments at runtime, so the repo never holds a full key literal (GitHub push protection).
import { describe, expect, it } from "vitest";
import { authzTargets, fieldNames, sameRecords, shapeHash } from "./authz";
import { dbErrorCandidate, findDbError } from "./dberror";
import { findSecrets, redactSecrets, secretCandidate } from "./secrets";
import type { AuthApiObservation } from "../record/responses";

const j = (...parts: string[]) => parts.join("");
const TAIL = "WITNESSTESTFAKE0000DONOTUSEKEY";
const stripeSecret = j("sk", "_live_", TAIL);
const stripeRestricted = j("rk", "_live_", TAIL);
const stripePublishable = j("pk", "_live_", TAIL);
const openai = j("sk", "-proj-", "Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z");
const anthropic = j("sk", "-ant-", "api03-", "Ab3dEf6hIj9kLm2nOp5qRs8t");
const openrouter = j("sk", "-or-v1-", "0123456789abcdef0123456789abcdef");
const aws = j("AK", "IA", "WITNESSFAKE00000");
const github = j("gh", "p_", "Ab3dEf6hIj9kLm2nOp5qRs8tUv1wXy4z0123");
const slack = j("xo", "xb-", "000000000000-FAKEWITNESSTOKEN");
const google = j("AI", "za", "SyWITNESS-fake_key_0000000000000000");
const pem = j(
  "-----BEGIN ",
  "PRIVATE KEY-----\n",
  "MIIEvgIBADANBgkqhkiG9w0BAQEFAASC",
  "\n-----END ",
  "PRIVATE KEY-----",
);

function jwt(payload: object): string {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "HS256", typ: "JWT" })}.${b(payload)}.${"signaturefake0000"}`;
}

describe("findSecrets", () => {
  it.each([
    ["Stripe secret key", `const k = "${stripeSecret}";`],
    ["Stripe secret key", `key=${stripeRestricted}`],
    ["OpenAI API key", `OPENAI="${openai}"`],
    ["Anthropic API key", `"${anthropic}"`],
    ["OpenRouter API key", `"${openrouter}"`],
    ["AWS access key ID", `aws: "${aws}"`],
    ["GitHub token", `token ${github}`],
    ["Slack token", `"${slack}"`],
    ["private key", pem],
    ["Supabase service-role key", `"${jwt({ role: "service_role", iss: "supabase" })}"`],
    ["Google API key", `maps: "${google}"`],
  ])("finds a %s", (label, text) => {
    const found = findSecrets(text);
    expect(found.map((f) => f.label)).toEqual([label]);
  });

  it.each([
    ["a Stripe publishable key", `"${stripePublishable}"`],
    ["a Supabase anon key", `"${jwt({ role: "anon", iss: "supabase" })}"`],
    ["a Firebase web config", `{ apiKey: "${google}", authDomain: "demo.firebaseapp.com" }`],
    ["words with dashes", `class="task-list-item-container-wrapper-outer-thing"`],
    ["a CSS variable", `--sk-spinner-circle-bounce-delay-animation: 1s`],
  ])("ignores %s (public by design, or not a key)", (_what, text) => {
    expect(findSecrets(text)).toEqual([]);
  });

  it("reports the key redacted to its first and last 4 characters, and never whole", () => {
    const [m] = findSecrets(`x=${stripeSecret}`);
    expect(m!.redacted).toBe(`${stripeSecret.slice(0, 4)}…${stripeSecret.slice(-4)}`);
    expect(JSON.stringify(m)).not.toContain(stripeSecret);
    expect(m!.hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("Anthropic and OpenRouter keys aren't also reported as OpenAI keys", () => {
    expect(findSecrets(`${anthropic} ${openrouter}`).map((f) => f.patternId)).toEqual([
      "anthropic",
      "openrouter",
    ]);
  });
});

describe("redactSecrets", () => {
  it("redacts every key in a text and leaves the rest", () => {
    const text = `a ${stripeSecret} b ${openai} c ${stripePublishable}`;
    const out = redactSecrets(text);
    expect(out).not.toContain(stripeSecret);
    expect(out).not.toContain(openai);
    expect(out).toContain(stripePublishable); // public by design
    expect(out.startsWith("a sk_l…")).toBe(true);
  });

  it("redacts a private key block", () => {
    expect(redactSecrets(`k=${pem};`)).toBe("k=-----BEGIN PRIVATE KEY----- [redacted];");
  });

  it("is a no-op on ordinary text", () => {
    const text = "Total (incl. 15% tax): $135.00 — sku-1234";
    expect(redactSecrets(text)).toBe(text);
  });
});

describe("secretCandidate", () => {
  it("never carries the key, and names it without the words a publishable-key claim uses", () => {
    const [match] = findSecrets(stripeSecret);
    const draft = secretCandidate({
      match: match!,
      request: { method: "GET", url: "http://a.test/app.js", path: "/app.js", status: 200 },
      evidenceId: "ev_1",
    });
    expect(JSON.stringify(draft)).not.toContain(stripeSecret);
    expect(draft.detail.title).toBe("Stripe secret key exposed to the browser");
    expect(draft.severityHint).toBe("critical");
    expect(JSON.stringify(draft.detail)).not.toMatch(/publishable|pk_l/i);
  });

  it("a Google key is for review, not a confirmed bug", () => {
    const [match] = findSecrets(google);
    const draft = secretCandidate({
      match: match!,
      request: { method: "GET", url: "http://a.test/", path: "/", status: 200 },
      evidenceId: "ev_1",
    });
    expect(draft.review).toMatch(/restricted/);
    expect(draft.severityHint).toBe("low");
  });
});

describe("findDbError", () => {
  it.each([
    ["MySQL", "You have an error in your SQL syntax; check the manual"],
    ["PostgreSQL", 'ERROR: syntax error at or near "\'"'],
    ["SQLite", '{"error":"SQLITE_ERROR: near \\"\'\\": syntax error"}'],
    ["SQLite", 'near "\'": syntax error'],
    ["SQL Server", "Unclosed quotation mark after the character string ''."],
    ["Oracle", "ORA-01756: quoted string not properly terminated"],
    ["ORM", "SequelizeDatabaseError: relation does not exist"],
  ])("recognises %s", (db, text) => {
    expect(findDbError(text)?.db).toBe(db);
  });

  it.each([
    "Please enter a valid email address.",
    "Our SQL course starts in May: learn syntax, joins and more.",
    "Order ORA-12 is ready", // not ORA-#####
  ])("ignores ordinary text: %s", (text) => {
    expect(findDbError(text)).toBeUndefined();
  });

  it("a DB error in a 5xx response groups with DET-HTTP5XX for the same request", () => {
    const match = findDbError("SQLITE_ERROR: boom")!;
    const draft = dbErrorCandidate({
      match,
      request: {
        method: "GET",
        url: "http://a.test/api/items?q=x",
        path: "/api/items?q=x",
        status: 500,
      },
      evidenceId: "ev_1",
    });
    expect(draft.groupKey).toBe("http5xx|GET /api/items"); // DET-HTTP5XX's key for the same request
    expect(draft.category).toBe("security");
    expect(draft.detail.title).toMatch(/possible SQL injection/);
  });
});

describe("DET-AUTHZ", () => {
  const booking = { booking: { ref: "R-1", name: "Ana", phone: "021", address: "1 St", hours: 2 } };

  it("same records: same shape and most values equal", () => {
    expect(sameRecords(booking, structuredClone(booking))).toBe(true);
    expect(sameRecords(booking, { error: "Please log in" })).toBe(false);
    expect(sameRecords({ items: [] }, { items: [] })).toBe(false); // empty data isn't private data
    expect(
      sameRecords(booking, {
        booking: { ref: "R-2", name: "Bo", phone: "022", address: "2 St", hours: 3 },
      }),
    ).toBe(false);
  });

  it("the shape hash ignores values and list lengths", () => {
    expect(shapeHash({ a: [{ b: 1 }, { b: 2 }] })).toBe(shapeHash({ a: [{ b: 9 }] }));
    expect(shapeHash({ a: 1 })).not.toBe(shapeHash({ b: 1 }));
  });

  it("field names only, never values", () => {
    expect(fieldNames(booking)).toEqual(["ref", "name", "phone", "address", "hours"]);
  });

  const api = (over: Partial<AuthApiObservation>): AuthApiObservation => ({
    url: "http://a.test/api/x",
    path: "/api/x",
    pattern: "/api/x",
    pageUrl: "http://a.test/account",
    pageRoute: "/account",
    body: { total: 12 },
    ...over,
  });

  it("targets logged-in-only endpoints from private pages, or with contact details", () => {
    const targets = authzTargets(
      [
        api({ pattern: "/api/private", pageRoute: "/account" }),
        api({ pattern: "/api/public", pageRoute: "/account" }),
        api({ pattern: "/api/calc", pageRoute: "/calculator" }),
        api({
          pattern: "/api/contact-from-public-page",
          pageRoute: "/calculator",
          body: { email: "a@b.c" },
        }),
      ],
      new Set(["/api/public"]),
      new Set(["/calculator", "/"]),
    );
    expect(targets.map((t) => t.pattern)).toEqual([
      "/api/private",
      "/api/contact-from-public-page",
    ]);
  });
});
