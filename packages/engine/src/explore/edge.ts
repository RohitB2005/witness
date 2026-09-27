// Edge inputs (AI_AGENT_SPEC.md §3.3, SPEC FR-6): unusual inputs on each form the Explorer submitted.
//
// 1. Forms are recovered from the happy-path steps: the fills/selects of one form, the steps that led to
//    it, the submit, and a "success signature" (where the submit landed + a new message it showed).
// 2. Variants: a fixed, safe set chosen by field type (XSS canary, apostrophe name, empty required
//    field, double submit, …) plus up to a few context-aware ones from the smart model (temperature 0.4).
// 3. Execution is deterministic (EdgeRunner, no LLM): a fresh context replays the recorded path with the
//    stored locators, fills the happy values except the varied field, submits, and code checks the
//    outcome: universal detectors (5xx, page error), the canary (DET-XSS), fieldRejected / success for
//    reject / accept expectations, and request counts for double submit.
// Also: the login-message comparison (unknown account vs. known account with a wrong password).
import type { Browser } from "playwright";
import { z } from "zod";
import { createContext } from "../browser/context";
import type { SafetyPolicy } from "../browser/policy";
import type { SecretVault } from "../browser/vault";
import { routePattern } from "../crawl/normalise";
import { log, type EventSink } from "../events";
import { newId } from "../ids";
import type { LlmGateway } from "../llm/gateway";
import { withoutLlm } from "../llm/guard";
import { EDGE_INSTRUCTIONS, edgePrompt } from "../llm/prompts/edge";
import type { Check, Locator } from "../oracle/language";
import { describeLocator, toPlaywright } from "../oracle/locate";
import { normaliseText } from "../oracle/parse";
import { parseSnapshot } from "../plan/summary";
import type { EvidenceWriter } from "../record/evidence";
import { PageRecorder, type NetworkEntry } from "../record/recorder";
import type { RunStore } from "../store/run-store";
import type { Action, Candidate, Expectation, Journey, ScanMode, Step } from "../types";
import { checkCandidate } from "./candidates";
import { Executor, toAgentAction } from "./executor";
import type { JourneyRun } from "./explorer";
import { indexSnapshot, messageLocator } from "./locators";
import type { StateRegistry } from "./states";
import type { StorageState } from "../preflight/preflight";

// ---------------------------------------------------------------------------------------------
// Forms

export interface FormField {
  locator: Locator;
  label: string;
  kind: "fill" | "select";
  happy: string;
  inputType: string;
  required: boolean;
}

export interface FormRun {
  journey: Journey;
  session: "anonymous" | "authenticated";
  key: string;
  route: string;
  prefix: Step[];
  fields: FormField[];
  submit: Step;
  success?: Check;
  writeRequest?: { method: string; path: string };
  pageText: string[];
}

const WRITE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Recovers the submitted forms from each journey's recorded steps. */
export async function findForms(
  runs: JourneyRun[],
  store: RunStore,
  runId: string,
): Promise<FormRun[]> {
  const forms: FormRun[] = [];
  const seen = new Set<string>();
  for (const run of runs) {
    const steps = (run.journey.steps ?? []).filter((s) => s.kind === "happy");
    let open: { key: string; first: number; fields: Map<string, FormField> } | undefined;
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i]!;
      const a = s.action;
      if (!s.ok) continue;
      if (a.type === "fill" || a.type === "select") {
        // Password fields are kept (a login variant needs the password to mean anything) but never varied.
        const key = s.target?.formKey ?? `page:${pathOf(s.urlBefore)}`;
        if (!open || open.key !== key) open = { key, first: i, fields: new Map() };
        const locKey = JSON.stringify(a.target);
        open.fields.set(locKey, {
          locator: a.target,
          label: s.target?.name || describeLocator(a.target),
          kind: a.type,
          happy: a.type === "fill" ? a.value : a.option,
          inputType: a.type === "select" ? "select" : (s.target?.inputType ?? "text"),
          required: !!s.target?.required,
        });
        continue;
      }
      const isSubmit =
        (a.type === "click" &&
          (s.target?.isSubmit || (!s.target?.formKey && s.target?.role === "button"))) ||
        (a.type === "press" && a.key === "Enter");
      if (!open || !isSubmit || !open.fields.size) continue;
      if (
        a.type === "click" &&
        s.target?.formKey &&
        s.target.formKey !== open.key &&
        !open.key.startsWith("page:")
      )
        continue;
      const route = routePattern(s.urlBefore);
      const fields = [...open.fields.values()];
      const dedupe = `${route}|${fields
        .map((f) => f.label)
        .sort()
        .join(",")}`;
      const before = run.snapshots.get(s.beforeEvidenceIds[1] ?? "") ?? "";
      const after = run.snapshots.get(s.afterEvidenceIds[1] ?? "") ?? "";
      // A submit the app refused (the Explorer testing bad input on purpose) isn't a happy path to vary.
      if (!seen.has(dedupe) && !refusedSubmit(s, before, after)) {
        seen.add(dedupe);
        forms.push({
          journey: run.journey,
          session: run.session,
          key: open.key,
          route,
          prefix: steps.slice(0, open.first).filter((p) => p.ok && p.action.type !== "check"),
          fields,
          submit: s,
          success: successSignature(
            s,
            before,
            after,
            fields.map((f) => f.happy),
          ),
          writeRequest: await writeRequestOf(store, runId, s.afterEvidenceIds[2]),
          pageText: parseSnapshot(before).text.concat(parseSnapshot(before).headings).slice(0, 30),
        });
      }
      open = undefined;
    }
  }
  return forms;
}

/** Words of a validation or failure message (generic UI language). */
const ERRORISH =
  /\b(please|required|invalid|error|must|can't|cannot|couldn't|not valid|enter an?|choose an?|select an?|missing|wrong|failed|went wrong|try again)\b/i;

/** Progress text is transient (it's gone a moment later), so it can't be a success signature. */
const TRANSIENT =
  /\b(loading|calculating|processing|saving|sending|submitting|please wait|working)\b|…|\.\.\.$/i;

/** The submit stayed on the same page and showed an error-like message: the app refused it. */
export function refusedSubmit(submit: Step, before: string, after: string): boolean {
  if (pathOf(submit.urlBefore) !== pathOf(submit.urlAfter)) return false;
  const old = new Set(textLines(before));
  return textLines(after).some((l) => !old.has(l) && ERRORISH.test(l));
}

/** Where a successful submit lands (path pattern) plus a message that newly appeared, as a Check. */
export function successSignature(
  submit: Step,
  before: string,
  after: string,
  typed: string[],
): Check | undefined {
  const moved = pathOf(submit.urlBefore) !== pathOf(submit.urlAfter);
  const oldLines = new Set(textLines(before));
  const typedLower = typed.filter((t) => t.length > 2).map((t) => t.toLowerCase());
  const fresh = textLines(after).find(
    (l) =>
      !oldLines.has(l) &&
      l.length >= 3 &&
      l.length <= 80 &&
      !/\d/.test(l) &&
      !ERRORISH.test(l) &&
      !TRANSIENT.test(l) &&
      !typedLower.some((t) => l.toLowerCase().includes(t)),
  );
  const checks: Check[] = [];
  if (moved) checks.push({ type: "urlMatches", pattern: pathRegex(submit.urlAfter) });
  if (fresh) checks.push({ type: "visible", target: { by: "text", text: fresh, exact: true } });
  if (!checks.length) return undefined;
  return checks.length === 1 ? checks[0] : { type: "all", checks };
}

function textLines(snapshot: string): string[] {
  const out: string[] = [];
  for (const line of snapshot.split("\n")) {
    const m =
      /^\s*- (heading|alert|status|paragraph|text|generic|strong)(?: "((?:[^"\\]|\\.)*)")?[^:]*(?::\s*"?(.+?)"?)?$/.exec(
        line,
      );
    if (!m) continue;
    const t = normaliseText((m[3] ?? m[2] ?? "").replace(/\\"/g, '"'));
    if (t) out.push(t);
  }
  return out;
}

/** ^/path/[^/]+$-style regex for a URL's path; segments containing digits become wildcards. */
export function pathRegex(url: string): string {
  const path = pathOf(url).split("?")[0] ?? "/";
  const segs = path
    .split("/")
    .map((s) => (/\d/.test(s) ? "[^/]+" : s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  return `^${segs.join("/") || "/"}(\\?|$)`;
}

async function writeRequestOf(store: RunStore, runId: string, evidenceId?: string) {
  if (!evidenceId) return undefined;
  const ev = await store.getEvidence(runId, evidenceId).catch(() => undefined);
  const entries = ((ev?.data as { entries?: NetworkEntry[] } | undefined)?.entries ??
    []) as NetworkEntry[];
  const w = entries.find(
    (e) => e.sameOrigin && WRITE.has(e.method.toUpperCase()) && !e.blockedByPolicy,
  );
  return w ? { method: w.method.toUpperCase(), path: w.path } : undefined;
}

// ---------------------------------------------------------------------------------------------
// Variants

export interface Variant {
  id: string;
  field?: FormField;
  value?: string;
  purpose: string;
  expectation: "accept" | "reject" | "none";
  rationale: string;
  kind: "value" | "double-submit";
  source: "fixed" | "ai";
  canary?: string;
}

const TEXTISH = new Set(["text", "search", "textarea", "url", ""]);

/** Fixed, safe variants for a form, split into the always-first tier and the rest (§3.3 table). */
export function fixedVariants(form: FormRun, today: Date): { first: Variant[]; rest: Variant[] } {
  const first: Variant[] = [];
  const rest: Variant[] = [];
  const v = (x: Omit<Variant, "id" | "kind" | "source">): Variant => ({
    id: newId("cd").replace("cd_", "vr_"),
    kind: "value",
    source: "fixed",
    ...x,
  });
  const textFields = form.fields.filter(
    (f) => f.kind === "fill" && TEXTISH.has(f.inputType) && !isSecret(f),
  );
  const nameField = textFields.find((f) => /name/i.test(f.label)) ?? textFields[0];
  if (textFields[0]) {
    const token = Math.random().toString(36).slice(2, 10);
    first.push(
      v({
        field: textFields[0],
        value: `"><i data-witness-canary="${token}"></i>`,
        purpose: "an inert HTML marker (checks the text is escaped)",
        expectation: "none",
        rationale: "Text typed by users must be shown as text, never inserted as HTML.",
        canary: token,
      }),
    );
  }
  if (nameField) {
    const apostrophe = /name/i.test(nameField.label) ? "Siobhan O'Neill" : "O'Neill's test";
    first.push(
      v({
        field: nameField,
        value: apostrophe,
        purpose: "a value with an apostrophe",
        expectation: "accept",
        rationale: "Real names and words contain apostrophes; the form should handle them.",
      }),
    );
  }
  if (form.writeRequest) {
    first.push({
      id: newId("cd").replace("cd_", "vr_"),
      kind: "double-submit",
      source: "fixed",
      purpose: "a double click on submit",
      expectation: "reject",
      rationale: "Submitting a form twice in quick succession should create one record, not two.",
    });
  }
  for (const f of form.fields) {
    if (f.kind !== "fill" || f.inputType === "password") continue;
    if (f.required) {
      rest.push(
        v({
          field: f,
          value: "",
          purpose: "an empty required field",
          expectation: "reject",
          rationale: "A required field left empty should be refused.",
        }),
      );
    }
    if (f.inputType === "email") {
      rest.push(
        v({
          field: f,
          value: "not-an-email",
          purpose: "an invalid email address",
          expectation: "reject",
          rationale: "An email field should refuse text that isn't an email address.",
        }),
      );
      rest.push(
        v({
          field: f,
          value: "a@b",
          purpose: "a minimal email address",
          expectation: "none",
          rationale: "Boundary email format.",
        }),
      );
      const at = f.happy.indexOf("@");
      if (at > 0 && !f.happy.includes("{{")) {
        rest.push(
          v({
            field: f,
            value: `${f.happy.slice(0, at)}+witness${f.happy.slice(at)}`,
            purpose: "an email with a + alias",
            expectation: "accept",
            rationale: "Plus-addressed emails are valid.",
          }),
        );
      }
    }
    if (TEXTISH.has(f.inputType)) {
      if (f.required)
        rest.push(
          v({
            field: f,
            value: "   ",
            purpose: "only spaces in a required field",
            expectation: "reject",
            rationale: "Whitespace isn't a real value for a required field.",
          }),
        );
      rest.push(
        v({
          field: f,
          value: "Ngāti Whātua 🌿",
          purpose: "letters with macrons and an emoji",
          expectation: "accept",
          rationale: "Unicode text should be accepted and shown correctly.",
        }),
      );
      rest.push(
        v({
          field: f,
          value: `  ${f.happy.includes("{{") ? "text" : f.happy}  `,
          purpose: "leading and trailing spaces",
          expectation: "none",
          rationale: "Surrounding spaces should be handled.",
        }),
      );
      rest.push(
        v({
          field: f,
          value: "x".repeat(256),
          purpose: "a 256-character value",
          expectation: "none",
          rationale: "Long input shouldn't crash anything.",
        }),
      );
    }
    if (f.inputType === "number") {
      for (const [value, purpose] of [
        ["0", "zero"],
        ["-1", "a negative number"],
        ["1000000000", "a very large number"],
        ["1.5", "a decimal"],
      ] as const) {
        rest.push(
          v({ field: f, value, purpose, expectation: "none", rationale: "Numeric boundary." }),
        );
      }
    }
    if (f.inputType === "date") {
      const d = (days: number) => localDate(new Date(today.getTime() + days * 86_400_000));
      rest.push(
        v({
          field: f,
          value: d(-1),
          purpose: "yesterday's date",
          expectation: "none",
          rationale: "Date boundary.",
        }),
      );
      rest.push(
        v({
          field: f,
          value: d(5 * 365),
          purpose: "a date five years ahead",
          expectation: "none",
          rationale: "Date boundary.",
        }),
      );
      rest.push(
        v({
          field: f,
          value: d(0),
          purpose: "today's date",
          expectation: "none",
          rationale: "Date boundary.",
        }),
      );
    }
  }
  // A login detail (the account's username/email) can't be swapped for another value and still be
  // "accepted": the account wouldn't match. Such variants still run, for crashes only.
  for (const v of [...first, ...rest]) if (v.field && isSecret(v.field)) v.expectation = "none";
  return { first, rest };
}

/** The happy value is a login detail from the vault ({{secret:…}}), or the field is a password. */
export function isSecret(f: FormField): boolean {
  return f.inputType === "password" || /\{\{secret:/.test(f.happy);
}

const AiVariantsSchema = z.object({
  variants: z
    .array(
      z.object({
        field: z.string().min(1),
        value: z.string().max(300),
        purpose: z.string().min(3).max(160),
        expectation: z.enum(["accept", "reject"]),
        rationale: z.string().min(3).max(300),
      }),
    )
    .max(12),
});

export async function aiVariants(
  gateway: LlmGateway,
  form: FormRun,
  today: Date,
): Promise<{ variants: Variant[]; proposed: number; error?: string }> {
  const fields = form.fields
    .filter((f) => f.inputType !== "password")
    .map((f) => ({
      name: f.label,
      type: f.inputType,
      required: f.required,
      happyValue: /\{\{secret:/.test(f.happy) ? "(login detail)" : JSON.stringify(f.happy),
    }));
  const res = await gateway.structured({
    role: "edge",
    tier: "smart",
    instructions: EDGE_INSTRUCTIONS,
    prompt: edgePrompt({
      route: form.route,
      goal: form.journey.goal,
      fields,
      pageText: form.pageText,
      today: localDate(today),
    }),
    schema: AiVariantsSchema,
    schemaName: "edgeInputs",
    temperature: 0.4,
  });
  if (!res.ok) return { variants: [], proposed: 0, error: res.error };
  const out: Variant[] = [];
  for (const p of res.value.variants) {
    const field = form.fields.find((f) => f.label === p.field);
    // Never a secret value, and never a guess at another account's login details (P2: variants that
    // swapped the account's email for an unknown one could only ever "fail").
    if (!field || isSecret(field) || /\{\{secret:/.test(p.value)) continue;
    out.push({
      id: newId("cd").replace("cd_", "vr_"),
      field,
      value: p.value,
      purpose: p.purpose,
      expectation: p.expectation,
      rationale: p.rationale,
      kind: "value",
      source: "ai",
    });
  }
  return { variants: out, proposed: res.value.variants.length };
}

/** Always-first fixed variants, then AI ones, then the rest of the fixed set, capped. */
export function orderVariants(
  fixed: { first: Variant[]; rest: Variant[] },
  ai: Variant[],
  cap: number,
  aiSlots: number,
): Variant[] {
  const out = [...fixed.first.slice(0, cap)];
  out.push(...ai.slice(0, Math.max(0, Math.min(aiSlots, cap - out.length))));
  for (const v of fixed.rest) if (out.length < cap) out.push(v);
  for (const v of ai.slice(aiSlots)) if (out.length < cap) out.push(v);
  return out;
}

// ---------------------------------------------------------------------------------------------
// Running

export interface EdgeDeps {
  browser: Browser;
  policy: SafetyPolicy;
  evidence: EvidenceWriter;
  store: RunStore;
  runId: string;
  gateway?: LlmGateway;
  vault: SecretVault;
  sink: EventSink;
  mode: ScanMode;
  viewport: { width: number; height: number };
  mobileViewport: { width: number; height: number };
  credentials?: { username: string; passwordRef: string };
  session?: StorageState;
  states: StateRegistry;
  deadline: number;
  variantsPerForm: number;
  aiSlots: number;
  maxForms: number;
  loginUrl?: string;
  concurrency?: number;
  today?: Date;
}

export interface EdgeMetrics {
  formsFound: number;
  formsTested: number;
  formsSkippedProduction: number;
  variantsRun: number;
  variantsSkippedTime: number;
  variantsUnreachable: number;
  aiProposed: number;
  aiUsed: number;
  candidates: number;
  loginPairRun: number;
  fieldsDiscovered: number;
}

export interface EdgeResult {
  candidates: Candidate[];
  /** Expectations and steps to attach to journeys (by journey id). */
  expectations: Expectation[];
  steps: Step[];
  /** A synthetic journey holding the login-message comparison, when it ran. */
  loginJourney?: Journey;
  metrics: EdgeMetrics;
}

export async function runEdgeInputs(runs: JourneyRun[], deps: EdgeDeps): Promise<EdgeResult> {
  const metrics: EdgeMetrics = {
    formsFound: 0,
    formsTested: 0,
    formsSkippedProduction: 0,
    variantsRun: 0,
    variantsSkippedTime: 0,
    variantsUnreachable: 0,
    aiProposed: 0,
    aiUsed: 0,
    candidates: 0,
    loginPairRun: 0,
    fieldsDiscovered: 0,
  };
  const result: EdgeResult = { candidates: [], expectations: [], steps: [], metrics };
  const today = deps.today ?? new Date();
  const allForms = await findForms(runs, deps.store, deps.runId);
  metrics.formsFound = allForms.length;
  const wanted = new Set(
    runs.flatMap((r) => (r.journey.edgeTargets ?? []).map((t) => t.formRoute.split("?")[0])),
  );
  const forms = [...allForms]
    .sort(
      (a, b) =>
        Number(wanted.has(b.route.split("?")[0])) - Number(wanted.has(a.route.split("?")[0])),
    )
    .slice(0, deps.maxForms);

  // Plan every form's variants first (LLM calls), then run them all without the LLM.
  const planned: { form: FormRun; variants: Variant[] }[] = [];
  for (const form of forms) {
    // In production mode a write-submitting form can't be submitted (blocked): nothing to observe.
    if (deps.mode === "production" && form.writeRequest) {
      metrics.formsSkippedProduction++;
      continue;
    }
    // The Explorer only typed into some fields; the app may have pre-filled others (e.g. a logged-in
    // user's name). Open the form once and add every field it has, with its current value.
    if (Date.now() < deps.deadline - 30_000) {
      const found = await withoutLlm("the form probe", () => probeFormFields(form, deps)).catch(
        () => [] as FormField[],
      );
      for (const f of found) if (!form.fields.some((k) => k.label === f.label)) form.fields.push(f);
      metrics.fieldsDiscovered += found.filter((f) => form.fields.includes(f)).length;
    }
    const fixed = fixedVariants(form, today);
    let ai: Variant[] = [];
    // Only ask for AI variants while there's time left to run them (a generator call takes ~8 s).
    if (deps.gateway && !deps.gateway.budgetExhausted && Date.now() < deps.deadline - 40_000) {
      const r = await aiVariants(deps.gateway, form, today);
      metrics.aiProposed += r.proposed;
      if (r.error)
        log(deps.sink, "warn", `Edge-input generator failed for ${form.route}: ${r.error}`);
      ai = r.variants;
    }
    const variants = orderVariants(fixed, ai, deps.variantsPerForm, deps.aiSlots);
    metrics.aiUsed += variants.filter((v) => v.source === "ai").length;
    planned.push({ form, variants });
    metrics.formsTested++;
  }

  await withoutLlm("the edge-input runner", async () => {
    const queue = planned.flatMap(({ form, variants }) =>
      variants.map((variant) => ({ form, variant })),
    );
    // The login-message comparison is Witness's own fixed check and takes seconds: it runs alongside the
    // variants (its own browser, anonymous) so a short edge phase can't squeeze it out (P3).
    const loginPair =
      deps.loginUrl && deps.credentials && Date.now() < deps.deadline
        ? runLoginPair(deps).catch((err: unknown) => {
            log(
              deps.sink,
              "warn",
              `Login-message comparison failed to run: ${String(err).split("\n")[0]}`,
            );
            return undefined;
          })
        : Promise.resolve(undefined);
    const workers = Array.from({ length: Math.max(1, deps.concurrency ?? 2) }, async () => {
      for (let job = queue.shift(); job; job = queue.shift()) {
        if (Date.now() > deps.deadline) {
          metrics.variantsSkippedTime++;
          continue;
        }
        const out = await runVariant(job.form, job.variant, deps).catch((err: unknown) => {
          log(
            deps.sink,
            "warn",
            `Edge input on ${job.form.route} failed to run: ${String(err).split("\n")[0]}`,
          );
          return undefined;
        });
        if (!out) continue;
        if (out.unreachable) metrics.variantsUnreachable++;
        else metrics.variantsRun++;
        result.candidates.push(...out.candidates);
        result.steps.push(...out.steps);
        if (out.expectation) result.expectations.push(out.expectation);
      }
    });
    await Promise.all(workers);
    const pair = await loginPair;
    if (pair) {
      metrics.loginPairRun = 1;
      result.loginJourney = pair.journey;
      result.candidates.push(...pair.candidates);
    }
  });
  metrics.candidates = result.candidates.length;
  for (const c of result.candidates) {
    deps.sink({
      t: "candidate",
      candidate: { id: c.id, category: c.category, summary: c.summary, route: c.route },
    });
  }
  return result;
}

/**
 * Replays the path to a form and lists all its editable fields (text-like inputs, textareas, selects),
 * with a stable label/placeholder/name locator each and the current value as the "happy" value.
 */
async function probeFormFields(form: FormRun, deps: EdgeDeps): Promise<FormField[]> {
  const context = await createContext(deps.browser, {
    policy: deps.policy,
    viewport: deps.viewport,
    storageState: form.session === "authenticated" ? deps.session : undefined,
  });
  try {
    const page = await context.newPage();
    const recorder = new PageRecorder(page, deps.policy);
    const ex = new Executor({
      page,
      recorder,
      evidence: deps.evidence,
      vault: deps.vault,
      policy: deps.policy,
      mode: deps.mode,
      journeyId: form.journey.id,
      kind: "edge",
      session: form.session,
      states: deps.states,
      viewport: deps.viewport,
      mobileViewport: deps.mobileViewport,
      credentials: deps.credentials,
      detectors: "off",
    });
    const prefix = form.prefix.length
      ? form.prefix
      : [{ action: { type: "goto", path: pathOf(form.submit.urlBefore) } as Action }];
    for (const s of prefix) {
      const a = toAgentAction(s.action);
      if (a && !(await ex.act(a)).ok) return [];
    }
    const anchor = toPlaywright(page, form.fields[0]!.locator).first();
    if ((await anchor.count()) === 0) return [];
    const raw = await anchor.evaluate((el) => {
      const scope =
        el.closest("form") ?? el.parentElement?.parentElement?.parentElement ?? document.body;
      const out: {
        label?: string;
        placeholder?: string;
        name?: string;
        tag: string;
        type: string;
        required: boolean;
        value: string;
      }[] = [];
      const skip = [
        "hidden",
        "password",
        "submit",
        "button",
        "reset",
        "checkbox",
        "radio",
        "file",
        "image",
      ];
      for (const node of Array.from(scope.querySelectorAll("input, textarea, select"))) {
        const f = node as HTMLInputElement;
        const tag = f.tagName.toLowerCase();
        const type = tag === "input" ? f.type : tag;
        if (skip.includes(type) || f.disabled || f.readOnly) continue;
        if (!(f as HTMLElement).offsetParent) continue;
        const label =
          (f.labels?.[0]?.innerText ?? "").replace(/\s+/g, " ").trim() ||
          f.getAttribute("aria-label") ||
          undefined;
        const value =
          tag === "select"
            ? ((f as unknown as HTMLSelectElement).selectedOptions[0]?.text ?? "")
            : f.value;
        out.push({
          label,
          placeholder: f.getAttribute("placeholder") ?? undefined,
          name: f.getAttribute("name") ?? undefined,
          tag,
          type,
          required: f.required || f.getAttribute("aria-required") === "true",
          value,
        });
      }
      return out;
    });
    const fields: FormField[] = [];
    for (const r of raw) {
      const candidates: Locator[] = [
        ...(r.label ? [{ by: "label", text: r.label, exact: true } as const] : []),
        ...(r.placeholder ? [{ by: "placeholder", text: r.placeholder } as const] : []),
        ...(r.name && /^[\w-]+$/.test(r.name)
          ? [{ by: "css", selector: `[name="${r.name}"]` } as const]
          : []),
      ];
      let locator: Locator | undefined;
      for (const c of candidates) {
        if (
          (await toPlaywright(page, c)
            .count()
            .catch(() => 0)) === 1
        ) {
          locator = c;
          break;
        }
      }
      if (!locator) continue;
      fields.push({
        locator,
        label: r.label ?? r.placeholder ?? r.name ?? describeLocator(locator),
        kind: r.tag === "select" ? "select" : "fill",
        happy: r.value,
        inputType: r.type,
        required: r.required,
      });
    }
    return fields;
  } finally {
    await context.close().catch(() => undefined);
  }
}

async function runVariant(
  form: FormRun,
  variant: Variant,
  deps: EdgeDeps,
): Promise<{
  candidates: Candidate[];
  steps: Step[];
  expectation?: Expectation;
  unreachable?: boolean;
}> {
  const context = await createContext(deps.browser, {
    policy: deps.policy,
    viewport: deps.viewport,
    storageState: form.session === "authenticated" ? deps.session : undefined,
  });
  try {
    const page = await context.newPage();
    const recorder = new PageRecorder(page, deps.policy);
    const ex = new Executor({
      page,
      recorder,
      evidence: deps.evidence,
      vault: deps.vault,
      policy: deps.policy,
      mode: deps.mode,
      journeyId: form.journey.id,
      kind: "edge",
      session: form.session,
      states: deps.states,
      viewport: deps.viewport,
      mobileViewport: deps.mobileViewport,
      credentials: deps.credentials,
      detectors: "log",
    });
    const candidates: Candidate[] = [];
    // Reach the form the way the happy path did.
    const prefix = form.prefix.length
      ? form.prefix
      : [{ action: { type: "goto", path: pathOf(form.submit.urlBefore) } as Action }];
    for (const s of prefix) {
      const a = toAgentAction(s.action);
      if (!a) continue;
      const r = await ex.act(a);
      if (!r.ok) return { candidates: [], steps: ex.steps, unreachable: true };
    }
    for (const f of form.fields) {
      const value = variant.field === f ? (variant.value ?? "") : f.happy;
      const r = await ex.act(
        f.kind === "select"
          ? { type: "select", target: f.locator, option: value }
          : { type: "fill", target: f.locator, value },
      );
      if (!r.ok) return { candidates: [], steps: ex.steps, unreachable: true };
    }
    const submitAction = toAgentAction(form.submit.action)!;
    const submitted = await ex.act(
      variant.kind === "double-submit" && submitAction.type === "click"
        ? { ...submitAction, clickCount: 2 }
        : submitAction,
    );
    const crashed = submitted.candidates.some(
      (c) =>
        c.source.kind === "detector" &&
        (c.source.id === "DET-HTTP5XX" || c.source.id === "DET-PAGEERROR"),
    );
    for (const c of submitted.candidates) {
      candidates.push({
        ...c,
        detail: {
          ...c.detail,
          actual: `${c.detail.actual} It happened after submitting the form with ${variant.purpose}${variant.field ? ` in "${variant.field.label}"` : ""}.`,
        },
      });
    }

    // DET-XSS: the inert canary element exists in the DOM → the text was inserted as HTML.
    if (
      variant.canary &&
      (await page
        .locator(`[data-witness-canary="${variant.canary}"]`)
        .count()
        .catch(() => 0)) > 0
    ) {
      const cur = ex.current;
      const route = routePattern(page.url());
      const evidenceId = await deps.evidence.put("dom_probe", {
        kind: "xss-canary",
        url: page.url(),
        field: variant.field?.label,
        selector: `[data-witness-canary="${variant.canary}"]`,
        found: true,
      });
      candidates.push({
        id: newId("cd"),
        kind: "bug",
        source: { kind: "detector", id: "DET-XSS" },
        category: "security",
        route,
        url: page.url(),
        stateId: cur?.state.id,
        session: form.session,
        viewport: "desktop",
        journeyId: form.journey.id,
        stepIds: ex.steps.map((s) => s.id),
        evidenceIds: [
          evidenceId,
          ...(cur ? [cur.capture.evidence.screenshot, cur.capture.evidence.snapshot] : []),
        ],
        signature: {
          kind: "detector",
          detectorId: "DET-XSS",
          key: `${form.route}|${variant.field?.label ?? ""}`,
        },
        check: {
          type: "notPresent",
          target: { by: "css", selector: `[data-witness-canary="${variant.canary}"]` },
        },
        groupKey: xssGroupKey(form.route, variant.field?.label ?? ""),
        signals: {},
        detail: {
          title: `Text typed into "${variant.field?.label}" is inserted into the page as HTML (XSS risk)`,
          impact: "An attacker could make the page run their own code in other people's browsers.",
          expected: `Text typed into "${variant.field?.label}" is shown as plain text.`,
          actual: `An inert marker element typed into "${variant.field?.label}" on ${form.route} appeared as a real element on ${route} after submitting.`,
          whyFlagged:
            "DET-XSS: an inert canary element typed into a field was rendered as HTML (it's never a script).",
        },
        summary: `Unescaped input from "${variant.field?.label}"`,
      });
    }

    // The variant's own expectation.
    let check: Check | undefined;
    let statement = "";
    if (variant.kind === "double-submit" && form.writeRequest) {
      check = {
        type: "maxRequests",
        method: form.writeRequest.method,
        pathPattern: pathRegex(form.writeRequest.path),
        max: 1,
      };
      statement = `Double-clicking submit on ${form.route} creates one record, not two`;
    } else if (variant.field && variant.expectation === "reject") {
      check = { type: "fieldRejected", field: variant.field.locator };
      statement = `The form on ${form.route} refuses ${variant.purpose} in "${variant.field.label}"`;
    } else if (variant.field && variant.expectation === "accept" && form.success && !crashed) {
      check = form.success;
      statement = `The form on ${form.route} accepts ${variant.purpose} in "${variant.field.label}"`;
    }
    let expectation: Expectation | undefined;
    if (check) {
      expectation = {
        id: newId("ex"),
        journeyId: form.journey.id,
        statement,
        check,
        grounding: { kind: "convention", rationale: variant.rationale },
        impact: variant.kind === "double-submit" ? "data-loss" : "wrong-info",
        category: variant.kind === "double-submit" ? "functional" : "validation",
        origin: "edge",
        ...(variant.source === "ai" ? { aiGuessed: true } : {}),
      };
      const r = await ex.check(check, {
        expectationId: expectation.id,
        statement,
        successCheck: form.success,
      });
      if (r.result.status === "fail") {
        const cur = ex.current;
        candidates.push(
          checkCandidate({
            exp: expectation,
            result: r.result,
            successCheck: form.success,
            url: page.url(),
            state: cur?.state,
            session: form.session,
            journeyId: form.journey.id,
            stepIds: ex.steps.map((s) => s.id),
            evidenceIds: [r.evidenceId, ...(cur ? [cur.capture.evidence.screenshot] : [])],
          }),
        );
      }
    }
    return { candidates, steps: ex.steps, expectation };
  } finally {
    await context.close().catch(() => undefined);
  }
}

/**
 * Unknown account vs. known account with a wrong password: if the two error messages differ, the login
 * form tells an attacker which accounts exist (convention grounding). One failed attempt per account, in
 * one browser, recorded as one replayable sequence: capture the unknown account's message, then compare the
 * known account's message with it (`equalsCaptured`), so a replay or an exported test compares the live
 * messages instead of a message recorded from the buggy build.
 */
async function runLoginPair(
  deps: EdgeDeps,
): Promise<{ journey: Journey; candidates: Candidate[] } | undefined> {
  const journeyId = newId("jr");
  const loginPath = pathOf(deps.loginUrl!);
  const context = await createContext(deps.browser, {
    policy: deps.policy,
    viewport: deps.viewport,
  });
  try {
    const page = await context.newPage();
    const recorder = new PageRecorder(page, deps.policy);
    const ex = new Executor({
      page,
      recorder,
      evidence: deps.evidence,
      vault: deps.vault,
      policy: deps.policy,
      mode: deps.mode,
      journeyId,
      kind: "edge",
      session: "anonymous",
      states: deps.states,
      viewport: deps.viewport,
      mobileViewport: deps.mobileViewport,
      credentials: deps.credentials,
      detectors: "log",
    });
    /** One failed login; returns the first message that appeared (not the typed account name). */
    const attempt = async (username: string): Promise<string | undefined> => {
      if (!(await ex.act({ type: "goto", path: loginPath })).ok) return undefined;
      const index = indexSnapshot(ex.current?.capture.snapshot ?? "");
      const boxes = [...index.entries()].filter(([, n]) => n.role === "textbox");
      const pw = boxes.find(([, n]) => /pass/i.test(n.name));
      const user =
        boxes.find(([, n]) => /(e-?mail|user|login|account)/i.test(n.name) && n !== pw?.[1]) ??
        boxes.find((b) => b !== pw);
      const submit = [...index.entries()].find(
        ([, n]) => n.role === "button" && /(log ?in|sign ?in|submit|continue)/i.test(n.name),
      );
      if (!pw || !user || !submit) return undefined;
      const before = ex.current?.capture.snapshot ?? "";
      // The executor re-resolves refs against a fresh snapshot, so refs from `index` stay valid here.
      if (!(await ex.act({ type: "fill", target: { ref: user[0] }, value: username })).ok)
        return undefined;
      if (
        !(await ex.act({ type: "fill", target: { ref: pw[0] }, value: "Wrong-passw0rd-witness" }))
          .ok
      )
        return undefined;
      if (!(await ex.act({ type: "click", target: { ref: submit[0] } })).ok) return undefined;
      const after = ex.current?.capture.snapshot ?? "";
      const old = new Set(textLines(before));
      const shown =
        username === "{{secret:username}}" ? (deps.credentials?.username ?? "") : username;
      return textLines(after).find(
        (l) => !old.has(l) && !(shown && l.toLowerCase().includes(shown.toLowerCase())),
      );
    };

    const a = await attempt(
      `witness.nobody.${Math.random().toString(36).slice(2, 8)}@example.invalid`,
    );
    if (!a) return undefined;
    const locA = await messageLocator(page, a);
    if (!locA) return undefined;
    const name = "unknownAccountMessage";
    const captured = await ex.check({ type: "capture", name, value: { text: locA } });
    if (captured.result.status !== "pass") return undefined;
    const b = await attempt("{{secret:username}}");
    if (!b) return undefined;
    const locB = (await messageLocator(page, b)) ?? locA;

    const journey: Journey = {
      id: journeyId,
      title: "Login error messages (edge inputs)",
      goal: "Compare the login error for an unknown account with the error for a known account and a wrong password.",
      priority: "secondary",
      automatic: true,
      startRoute: loginPath,
      suggestedSteps: [],
      expectations: [],
      status: "completed",
      steps: ex.steps,
    };
    const exp: Expectation = {
      id: newId("ex"),
      journeyId,
      statement: "A failed login shows the same message whether or not the account exists",
      check: { type: "equalsCaptured", name, value: { text: locB } },
      grounding: {
        kind: "convention",
        rationale:
          "Different messages for unknown and known accounts let anyone find out which email addresses have accounts.",
      },
      impact: "wrong-info",
      category: "validation",
      origin: "edge",
    };
    journey.expectations.push(exp);
    const r = await ex.check(exp.check, { expectationId: exp.id, statement: exp.statement });
    journey.steps = ex.steps;
    if (r.result.status !== "fail") return { journey, candidates: [] };
    const cand = checkCandidate({
      exp,
      result: r.result,
      url: page.url(),
      state: ex.current?.state,
      session: "anonymous",
      journeyId,
      stepIds: ex.steps.map((s) => s.id),
      evidenceIds: [r.evidenceId, ...(ex.current ? [ex.current.capture.evidence.screenshot] : [])],
    });
    cand.category = "security";
    cand.detail = {
      ...cand.detail,
      title: "Login errors reveal whether an account exists",
      impact:
        "Anyone can find out which email addresses have an account, which helps targeted attacks.",
      expected: "The same message for an unknown account and for a wrong password.",
      actual: `Unknown account: "${a}". Known account, wrong password: "${b}".`,
    };
    return { journey, candidates: [cand] };
  } catch {
    return undefined;
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** One XSS problem per page path and field, whoever found it (edge inputs or the reflected probe). */
export function xssGroupKey(route: string, field: string): string {
  return `xss|${route.split("?")[0]}|${field.toLowerCase()}`;
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.pathname}${u.search}`;
  } catch {
    return url;
  }
}

/** YYYY-MM-DD in local time (what a date field expects; UTC can be a day off). */
function localDate(d: Date): string {
  return d.toLocaleDateString("en-CA");
}
