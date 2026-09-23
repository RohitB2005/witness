// Clean-build acceptance criteria (BENCH_SPEC §1): with every flag off, every page and key interactive
// state has zero axe violations, no console errors or uncaught exceptions, no broken links or images,
// every API call under 500 ms, and no horizontal overflow at 375 × 667.
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { expect, fillBooking, login, test } from "./fixtures";

const MOBILE = { width: 375, height: 667 };
const DESKTOP = { width: 1280, height: 800 };

interface Problems {
  consoleErrors: string[];
  pageErrors: string[];
  badResponses: string[];
  slowApis: string[];
}

/** Records console errors, uncaught exceptions, same-origin 4xx/5xx and slow API calls. */
function watch(page: Page): Problems {
  const problems: Problems = { consoleErrors: [], pageErrors: [], badResponses: [], slowApis: [] };
  const started = new Map<object, number>();
  const origin = () =>
    new URL(page.url() === "about:blank" ? "http://localhost" : page.url()).origin;
  page.on(
    "console",
    (m) => m.type() === "error" && problems.consoleErrors.push(`${page.url()}: ${m.text()}`),
  );
  page.on("pageerror", (e) => problems.pageErrors.push(`${page.url()}: ${e.message}`));
  page.on("request", (r) => started.set(r, Date.now()));
  page.on("requestfinished", (r) => {
    const url = new URL(r.url());
    const begin = started.get(r);
    if (url.pathname.startsWith("/api/") && begin !== undefined) {
      const ms = Date.now() - begin;
      if (ms >= 500) problems.slowApis.push(`${r.method()} ${url.pathname} ${ms} ms`);
    }
  });
  page.on("response", (r) => {
    if (new URL(r.url()).origin === origin() && r.status() >= 400) {
      problems.badResponses.push(`${r.request().method()} ${r.url()} → ${r.status()}`);
    }
  });
  return problems;
}

async function expectNoProblems(problems: Problems): Promise<void> {
  expect(problems.pageErrors, "uncaught exceptions").toEqual([]);
  expect(problems.consoleErrors, "console errors").toEqual([]);
  expect(problems.badResponses, "same-origin 4xx/5xx responses").toEqual([]);
  expect(problems.slowApis, "API calls ≥ 500 ms").toEqual([]);
}

async function expectAxeClean(page: Page, label: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).analyze();
  const summary = violations.map(
    (v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
  );
  expect(summary, `axe violations on ${label}`).toEqual([]);
}

async function expectImagesLoad(page: Page): Promise<void> {
  const images = page.locator("img");
  await expect
    .poll(() => images.evaluateAll((els) => els.every((i) => (i as HTMLImageElement).complete)))
    .toBe(true);
  const broken = await images.evaluateAll((els) =>
    els.filter((i) => (i as HTMLImageElement).naturalWidth === 0).map((i) => i.getAttribute("src")),
  );
  expect(broken, "broken images").toEqual([]);
}

async function expectNoOverflow(page: Page, label: string): Promise<void> {
  await page.setViewportSize(MOBILE);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  await page.setViewportSize(DESKTOP);
  expect(overflow, `horizontal overflow at 375 px on ${label}`).toBeLessThanOrEqual(1);
}

async function sameOriginLinks(page: Page): Promise<string[]> {
  const origin = new URL(page.url()).origin;
  const hrefs = await page
    .locator("a[href]")
    .evaluateAll((els) => els.map((a) => (a as HTMLAnchorElement).href));
  return hrefs
    .filter((h) => new URL(h).origin === origin)
    .map((h) => new URL(h).pathname + new URL(h).search);
}

/** Loads a page, waits for it to settle, and checks everything the clean build promises. */
async function auditPage(page: Page, path: string, links: Set<string>): Promise<void> {
  await page.goto(path);
  await page.waitForLoadState("networkidle");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expectAxeClean(page, path);
  await expectImagesLoad(page);
  await expectNoOverflow(page, path);
  for (const link of await sameOriginLinks(page)) links.add(link);
}

const PUBLIC_PAGES = [
  "/",
  "/services",
  ...["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"].map((id) => `/services/${id}`),
  "/services?q=clean&sort=price-asc",
  "/quote",
  "/book",
  "/book/confirmation?ref=HC-1001",
  "/login",
  "/signup",
  "/faq",
  "/contact",
  "/terms",
  "/privacy",
];

const ACCOUNT_PAGES = ["/", "/bookings", "/profile", "/book"];

test("every public page is clean", async ({ page, request }) => {
  const problems = watch(page);
  const links = new Set<string>();
  for (const path of PUBLIC_PAGES) await auditPage(page, path, links);
  await expectNoProblems(problems);
  for (const link of links) {
    expect(`${link} ${(await request.get(link)).status()}`).toBe(`${link} 200`);
  }
});

test("every logged-in page is clean", async ({ page }) => {
  const problems = watch(page);
  const links = new Set<string>();
  await login(page);
  for (const path of ACCOUNT_PAGES) await auditPage(page, path, links);
  await expectNoProblems(problems);
  for (const link of links) {
    expect(`${link} ${(await page.request.get(link)).status()}`).toBe(`${link} 200`);
  }
});

test("interactive states are clean", async ({ page }) => {
  const problems = watch(page);

  // Quote breakdown
  await page.goto("/quote");
  await expect(page.getByLabel("Service").locator("option")).toHaveCount(9);
  await page.getByLabel("Service").selectOption("s4");
  await page.getByRole("button", { name: "Calculate" }).click();
  await expect(page.getByTestId("quote-total")).toBeVisible();
  await expectAxeClean(page, "quote breakdown");

  // Quote validation (decoy D04)
  await page.getByLabel("Hours").fill("1");
  await page.getByRole("button", { name: "Calculate" }).click();
  await expect(page.getByText("Minimum booking is 2 hours")).toBeVisible();
  await expectAxeClean(page, "quote validation");

  // FAQ fully expanded
  await page.goto("/faq");
  const questions = page.getByRole("main").getByRole("button");
  for (let i = 0; i < 6; i++) await questions.nth(i).click();
  await expectAxeClean(page, "FAQ expanded");

  // Booking form validation errors, then a successful booking with unusual but valid names
  await page.goto("/book");
  await expect(page.getByLabel("Service").locator("option")).toHaveCount(9);
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByText("Please choose a service.")).toBeVisible();
  await expectAxeClean(page, "booking validation");
  await expectNoOverflow(page, "booking validation");
  for (const name of ["Siobhan O'Neill", "Ngāti Whātua 🌿"]) {
    await fillBooking(page, { name });
    await page.getByRole("button", { name: "Confirm booking" }).click();
    await expect(page.getByRole("heading", { name: "Booking confirmed" })).toBeVisible();
  }
  await expectAxeClean(page, "booking confirmed");

  // Search with no results
  await page.goto("/services?q=zzz");
  await expect(page.getByText("No services match")).toBeVisible();
  await expectAxeClean(page, "empty search");

  // Contact form sent
  await page.goto("/contact");
  await page.getByLabel("Name").fill("Aroha Test");
  await page.getByLabel("Email").fill("aroha@example.test");
  await page.getByLabel("Message").fill("Do you clean on Sundays?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Thanks — we'll reply within one working day")).toBeVisible();
  await expectAxeClean(page, "contact sent");

  // Logged-in: cancel dialog open, then profile saved toast
  await login(page);
  await page.goto("/bookings");
  await page.getByRole("button", { name: "Cancel booking HC-1003" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectAxeClean(page, "cancel dialog");
  await page.getByRole("dialog").getByRole("button", { name: "Keep booking" }).click();
  await page.goto("/profile");
  await expect(page.getByLabel("Phone")).not.toHaveValue("");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Profile saved")).toBeVisible();
  await expectAxeClean(page, "profile saved");

  await expectNoProblems(problems);
});

test("a wrong login shows a generic, accessible error", async ({ page }) => {
  // A rejected login is a deliberate 401, so only page errors and axe are checked here.
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/login");
  await page.getByLabel("Email").fill("nobody@example.test");
  await page.getByLabel("Password").fill("wrong-password-1");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("alert")).toHaveText("Email or password is incorrect");
  await expectAxeClean(page, "login error");
  expect(errors).toEqual([]);
});
