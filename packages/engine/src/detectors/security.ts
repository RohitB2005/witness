// Run-level security detectors (ADDENDUM A1, A3, A4). They read what the response observer saw during the
// whole run (crawl, journeys, edge inputs, probes) and run once, after exploring and before verification.
import type { Browser } from "playwright";
import { createContext } from "../browser/context";
import type { SafetyPolicy } from "../browser/policy";
import { routePattern } from "../crawl/normalise";
import type { EvidenceWriter } from "../record/evidence";
import type { ResponseObserver } from "../record/responses";
import type { Candidate, PageState } from "../types";
import { authzCandidate, authzTargets, fetchWithoutLogin, fieldNames, sameRecords } from "./authz";
import { dbErrorCandidate } from "./dberror";
import { toCandidate } from "./registry";
import { secretCandidate } from "./secrets";
import type { CandidateDraft } from "./types";
import { pathOf } from "./util";

export interface SecurityDetectorDeps {
  observer: ResponseObserver;
  browser: Browser;
  policy: SafetyPolicy;
  evidence: EvidenceWriter;
  viewport: { width: number; height: number };
  /** Crawled pages with their snapshots (page text for DET-DBERROR, public routes for DET-AUTHZ). */
  states: PageState[];
  snapshots: Map<string, string>;
  /** Epoch ms: no DET-AUTHZ request starts after this. */
  deadline: number;
}

function place(
  draft: CandidateDraft,
  at: { url: string; route?: string; session: Candidate["session"] },
): Candidate {
  let route = at.route;
  if (route === undefined) {
    try {
      route = routePattern(at.url);
    } catch {
      route = "/";
    }
  }
  const c = toCandidate(draft, {
    id: "",
    url: at.url,
    routePattern: route,
    session: at.session,
    evidenceIds: [],
  });
  delete c.stateId;
  return c;
}

export async function securityCandidates(
  d: SecurityDetectorDeps,
): Promise<{ candidates: Candidate[]; metrics: Record<string, number> }> {
  const { observer } = d;
  for (const s of d.states) {
    const text = d.snapshots.get(s.id);
    if (text)
      await observer.scanPageText({ url: s.url, route: s.routePattern, session: s.session }, text);
  }
  await observer.settle();

  const out: Candidate[] = [];
  for (const hit of observer.secretHits)
    out.push(
      place(secretCandidate(hit), { url: hit.pageUrl || hit.request.url, session: hit.session }),
    );
  for (const hit of observer.dbHits)
    out.push(
      place(dbErrorCandidate(hit), {
        url: hit.pageUrl || hit.request?.url || d.policy.origin,
        route: hit.pageRoute,
        session: hit.session,
      }),
    );

  // DET-AUTHZ: logged-in-only endpoints, requested again from a context with no cookies.
  const publicRoutes = new Set(
    d.states
      .filter((s) => s.session === "anonymous" && ((s.status ?? 200) < 400 || s.appRendered))
      .map((s) => pathOf(s.routePattern)),
  );
  const targets = authzTargets(observer.authApis.values(), observer.anonymousOk, publicRoutes);
  let tried = 0;
  if (targets.length) {
    const context = await createContext(d.browser, {
      policy: d.policy,
      viewport: d.viewport,
      observe: false,
    });
    try {
      for (const api of targets) {
        if (Date.now() > d.deadline) break;
        tried++;
        const anon = await fetchWithoutLogin(context.request, api.url).catch(() => undefined);
        if (!anon || anon.status !== 200 || !sameRecords(api.body, anon.body)) continue;
        const evidenceId = await d.evidence.put("network", {
          kind: "authz-check",
          url: api.url,
          loggedInStatus: 200,
          withoutLoginStatus: anon.status,
          fields: fieldNames(api.body),
          sameRecords: true,
        });
        out.push(
          place(authzCandidate(api, anon, evidenceId), {
            url: api.url,
            route: api.pageRoute || api.pattern,
            session: "anonymous",
          }),
        );
      }
    } finally {
      await context.close().catch(() => undefined);
    }
  }
  return {
    candidates: out,
    metrics: {
      "security.secrets": observer.secretHits.length,
      "security.dbErrors": observer.dbHits.length,
      "security.authzTried": tried,
    },
  };
}
