// Preflight (SPEC FR-2): is the target reachable, what headers does it send, is there a login form,
// and — if credentials were given — can we log in? Login failure stops the scan before any AI stage.
import type { Browser, BrowserContext, Page } from "playwright";
import { LIMITS } from "../config/budgets";
import { createContext } from "../browser/context";
import type { SafetyPolicy, WriteAllowance } from "../browser/policy";
import type { SecretVault } from "../browser/vault";
import type { EvidenceWriter } from "../record/evidence";
import { PageRecorder } from "../record/recorder";
import type { CookieFacts } from "../detectors/secheaders";
import type { ScanConfig } from "../types";

export type StorageState = Awaited<ReturnType<BrowserContext["storageState"]>>;

export interface PreflightSuccess {
  ok: true;
  startUrl: string;
  status: number;
  headers: Record<string, string>;
  headersEvidenceId: string;
  cookies: CookieFacts[];
  /** A login form was found on the start page or behind a "Log in" link. */
  loginDetected: boolean;
  loginUrl?: string;
  session?: {
    storageState: StorageState; // in memory only
    loginRequest?: WriteAllowance;
    signal: string;
  };
}

export interface PreflightFailure {
  ok: false;
  message: string;
  screenshotEvidenceId?: string;
}

export type PreflightResult = PreflightSuccess | PreflightFailure;

export interface PreflightDeps {
  browser: Browser;
  config: ScanConfig;
  policy: SafetyPolicy;
  vault: SecretVault;
  evidence: EvidenceWriter;
}

const LOGIN_TEXT = /^\s*(log\s?-?in|sign\s?-?in)\b/i;
const LOGIN_HREF = /\/(login|log-in|signin|sign-in|sign_in|auth\/login)\b/i;
export const LOGOUT_TEXT = /\b(log\s?-?out|sign\s?-?out)\b/i;

export async function preflight(deps: PreflightDeps): Promise<PreflightResult> {
  const { browser, config, policy, evidence } = deps;
  const context = await createContext(browser, { policy, viewport: config.viewport });
  try {
    const page = await context.newPage();
    const recorder = new PageRecorder(page, policy);
    let response;
    try {
      response = await page.goto(config.url, { waitUntil: "domcontentloaded" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (policy.blocked.some((b) => b.reason === "off-origin-navigation")) {
        return {
          ok: false,
          message: `The start page redirected to another site, which is outside the scan's scope (${policy.origin}).`,
        };
      }
      return {
        ok: false,
        message: `Witness couldn't reach ${config.url}. Is the app running? (${firstLine(msg)})`,
      };
    }
    const status = response?.status() ?? 0;
    if (status >= 400 || status === 0) {
      return {
        ok: false,
        message: `The start page ${config.url} returned HTTP ${status}. Check the address and that the app is running.`,
        screenshotEvidenceId: await evidence
          .screenshot(page, { label: "start page" })
          .catch(() => undefined),
      };
    }
    const headers = (await response?.allHeaders()) ?? {};
    await recorder.waitForQuiet(LIMITS.crawlQuietCapMs);
    const headersEvidenceId = await evidence.put("network", {
      kind: "document-headers",
      url: page.url(),
      status,
      headers,
    });

    const loginUrl = await findLoginPage(page);
    const result: PreflightSuccess = {
      ok: true,
      startUrl: page.url(),
      status,
      headers,
      headersEvidenceId,
      cookies: [],
      loginDetected: loginUrl !== undefined,
      loginUrl,
    };

    if (config.credentials) {
      if (!loginUrl) {
        return {
          ok: false,
          message:
            'Credentials were given, but Witness couldn\'t find a login form (no password field on the start page and no "Log in" link).',
          screenshotEvidenceId: await evidence.screenshot(page, { label: "start page" }),
        };
      }
      const login = await logIn(page, recorder, deps, loginUrl);
      if (!login.ok) return login;
      result.session = {
        storageState: await context.storageState(),
        loginRequest: policy.loginRequest,
        signal: login.signal,
      };
    }
    result.cookies = (await context.cookies(config.url)).map((c) => ({
      name: c.name,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: c.sameSite,
    }));
    return result;
  } finally {
    await context.close().catch(() => undefined);
  }
}

/** The login page: the current page if it has a visible password field, else the first "Log in" link. */
async function findLoginPage(page: Page): Promise<string | undefined> {
  if (await hasVisiblePassword(page)) return page.url();
  const links = await page
    .evaluate(() =>
      Array.from(document.querySelectorAll("a[href]")).map((a) => ({
        href: (a as HTMLAnchorElement).href,
        text: ((a as HTMLElement).innerText || a.getAttribute("aria-label") || "").trim(),
      })),
    )
    .catch(() => []);
  const origin = new URL(page.url()).origin;
  const match =
    links.find((l) => LOGIN_TEXT.test(l.text) && sameOrigin(l.href, origin)) ??
    links.find((l) => LOGIN_HREF.test(safePath(l.href)) && sameOrigin(l.href, origin));
  return match?.href;
}

async function logIn(
  page: Page,
  recorder: PageRecorder,
  deps: PreflightDeps,
  loginUrl: string,
): Promise<{ ok: true; signal: string } | PreflightFailure> {
  const { config, policy, vault, evidence } = deps;
  const creds = config.credentials!;
  const fail = async (detail?: string): Promise<PreflightFailure> => ({
    ok: false,
    message: `Couldn't log in with the details provided.${detail ? ` ${detail}` : ""}`,
    screenshotEvidenceId: await evidence
      .screenshot(page, { label: "login" })
      .catch(() => undefined),
  });

  if (page.url() !== loginUrl) {
    await page.goto(loginUrl, { waitUntil: "domcontentloaded" });
    await recorder.waitForQuiet(LIMITS.crawlQuietCapMs);
  }
  const password = page.locator("input[type=password]:visible").first();
  if ((await password.count()) === 0) return fail("The login page has no visible password field.");
  const form = password.locator("xpath=ancestor::form[1]");
  const scope = (await form.count()) > 0 ? form : page.locator("body");
  const username = await findUsernameField(scope);
  if (!username) return fail("Witness couldn't identify the username/email field.");

  const loginPath = new URL(page.url()).pathname;
  await username.fill(creds.username);
  await password.fill(vault.get(creds.passwordRef));
  const submit = scope
    .locator("button[type=submit]:visible, input[type=submit]:visible, button:not([type]):visible")
    .first();
  policy.armLoginWindow();
  try {
    if ((await submit.count()) > 0) await submit.click();
    else await password.press("Enter");
    await page
      .waitForURL((u) => u.pathname !== loginPath, { timeout: 5_000 })
      .catch(() => undefined);
    await recorder.waitForQuiet(LIMITS.crawlQuietCapMs);
  } finally {
    policy.disarmLoginWindow();
  }

  const logout = page
    .getByRole("button", { name: LOGOUT_TEXT })
    .or(page.getByRole("link", { name: LOGOUT_TEXT }));
  if ((await logout.count()) > 0) return { ok: true, signal: "A log-out control is visible." };
  const stillOnForm = await hasVisiblePassword(page);
  const moved = new URL(page.url()).pathname !== loginPath;
  if (!stillOnForm && moved) {
    return { ok: true, signal: `Left the login page for ${new URL(page.url()).pathname}.` };
  }
  if (!stillOnForm && (await page.getByText(creds.username).count()) > 0) {
    return { ok: true, signal: "The account name is visible." };
  }
  return fail();
}

async function findUsernameField(scope: ReturnType<Page["locator"]>) {
  const selectors = [
    "input[autocomplete=username]:visible",
    "input[type=email]:visible",
    "input[name*=email i]:visible",
    "input[name*=user i]:visible",
    "input[name*=login i]:visible",
    "input[id*=email i]:visible",
    "input[id*=user i]:visible",
    "input[type=text]:visible",
    "input:not([type]):visible",
  ];
  for (const s of selectors) {
    const loc = scope.locator(s).first();
    if ((await loc.count()) > 0) return loc;
  }
  return undefined;
}

async function hasVisiblePassword(page: Page): Promise<boolean> {
  return (await page.locator("input[type=password]:visible").count()) > 0;
}

function sameOrigin(href: string, origin: string): boolean {
  try {
    return new URL(href).origin === origin;
  } catch {
    return false;
  }
}

function safePath(href: string): string {
  try {
    return new URL(href).pathname;
  } catch {
    return "";
  }
}

function firstLine(s: string): string {
  return s.split("\n")[0] ?? s;
}
