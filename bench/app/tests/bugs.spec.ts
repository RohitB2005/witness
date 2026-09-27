// One test per seeded bug. Each asserts the CLEAN behaviour, so it passes with its flag off (project
// "clean") and fails with only its flag on (project "flagged", see fixtures.ts). Tags link to bugs.yaml.
import AxeBuilder from "@axe-core/playwright";
import { DEMO, expect, fillBooking, isoDate, login, parseMoney, test } from "./fixtures";

test("quote total is subtotal plus 15% GST", { tag: "@B01" }, async ({ page }) => {
  await page.goto("/quote");
  await expect(page.getByLabel("Service").locator("option")).toHaveCount(9);
  await page.getByLabel("Service").selectOption("s1");
  await page.getByLabel("Hours").fill("3");
  await page.getByRole("button", { name: "Calculate" }).click();
  await expect(page.getByTestId("quote-total")).toBeVisible();
  const subtotal = parseMoney(await page.getByTestId("quote-subtotal").innerText());
  const gst = parseMoney(await page.getByTestId("quote-gst").innerText());
  const total = parseMoney(await page.getByTestId("quote-total").innerText());
  expect(subtotal).toBe(135);
  expect(gst).toBeCloseTo(subtotal * 0.15, 2);
  expect(total).toBeCloseTo(subtotal * 1.15, 2);
});

test("price sort low-to-high orders prices numerically", { tag: "@B02" }, async ({ page }) => {
  await page.goto("/services");
  await expect(page.getByTestId("service-card")).toHaveCount(8);
  await page.getByLabel("Sort by").selectOption({ label: "Price: low to high" });
  await expect(page).toHaveURL(/sort=price-asc/);
  await expect
    .poll(async () => {
      const prices = (await page.getByTestId("service-price").allInnerTexts()).map(parseMoney);
      return prices.every((p, i) => i === 0 || prices[i - 1]! <= p);
    })
    .toBe(true);
  await expect(page.getByTestId("service-name").first()).toHaveText("Carpet shampoo");
});

test("service search ignores letter case", { tag: "@B03" }, async ({ page }) => {
  await page.goto("/services");
  await page.getByLabel("Search services").fill("window");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("heading", { name: "Results for “window”" })).toBeVisible();
  await expect(page.getByTestId("service-name")).toHaveText(["Window cleaning"]);
});

test("booking rejects a date in the past", { tag: "@B04" }, async ({ page, request }) => {
  await fillBooking(page, { date: isoDate(-1) });
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByText("Please choose a future date")).toBeVisible();
  await expect(page).toHaveURL(/\/book$/);

  const res = await request.post("/api/bookings", {
    data: {
      serviceId: "s1",
      date: isoDate(-1),
      time: "10:00",
      hours: 3,
      name: "Past Date",
      email: "past@example.test",
      phone: "021 000 0000",
      address: "1 Test Street",
    },
  });
  expect(res.status()).toBe(400);
});

test("a name with an apostrophe can book", { tag: "@B05" }, async ({ page }) => {
  await fillBooking(page, { name: "Siobhan O'Brien" });
  await page.getByRole("button", { name: "Confirm booking" }).click();
  await expect(page.getByRole("heading", { name: "Booking confirmed" })).toBeVisible();
});

test("cancelling a booking removes exactly that booking", { tag: "@B06" }, async ({ page }) => {
  await login(page);
  await page.goto("/bookings");
  await expect(page.getByTestId("booking-row")).toHaveCount(3);
  await page.getByRole("button", { name: "Cancel booking HC-1001" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Yes, cancel" }).click();
  await expect(page.getByTestId("booking-row")).toHaveCount(2);
  await expect(page.getByTestId("booking-list")).not.toContainText("HC-1001");
  await expect(page.getByTestId("booking-list")).toContainText("HC-1002");
  await expect(page.getByTestId("booking-list")).toContainText("HC-1003");
});

test("nav badge updates immediately after cancelling", { tag: "@B07" }, async ({ page }) => {
  await login(page);
  await page.goto("/bookings");
  const badge = page.getByTestId("bookings-badge");
  await expect(badge).toHaveText(/\b3$/);
  await page.getByRole("button", { name: "Cancel booking HC-1002" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Yes, cancel" }).click();
  await expect(page.getByTestId("booking-row")).toHaveCount(2);
  await expect(badge).toHaveText(/\b2$/);
});

test("profile changes persist after reload", { tag: "@B08" }, async ({ page }) => {
  await login(page);
  await page.goto("/profile");
  const phone = page.getByLabel("Phone");
  await expect(phone).toHaveValue(DEMO.phone);
  await phone.fill("021 555 0199");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Profile saved")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Phone")).toHaveValue("021 555 0199");
});

test("every service image loads", { tag: "@B09" }, async ({ page }) => {
  await page.goto("/services");
  const images = page.getByTestId("service-card").locator("img");
  await expect(images).toHaveCount(8);
  await expect
    .poll(() => images.evaluateAll((els) => els.every((i) => (i as HTMLImageElement).complete)))
    .toBe(true);
  const broken = await images.evaluateAll((els) =>
    els.filter((i) => (i as HTMLImageElement).naturalWidth === 0).map((i) => i.getAttribute("src")),
  );
  expect(broken).toEqual([]);
});

test("footer Terms link resolves", { tag: "@B10" }, async ({ page, request }) => {
  await page.goto("/");
  const link = page.getByRole("contentinfo").getByRole("link", { name: "Terms" });
  const href = await link.getAttribute("href");
  expect(href).not.toBeNull();
  expect((await request.get(href!)).status()).toBe(200);
  await link.click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Terms of service");
});

test("every FAQ item opens without errors", { tag: "@B11" }, async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/faq");
  const questions = page.getByRole("main").getByRole("button");
  await expect(questions).toHaveCount(6);
  for (let i = 0; i < 6; i++) {
    await questions.nth(i).click();
    await expect(questions.nth(i)).toHaveAttribute("aria-expanded", "true");
  }
  await expect(page.getByText("Our cleaners bring all equipment")).toBeVisible();
  expect(errors).toEqual([]);
});

test("contact form controls are labelled", { tag: "@B12" }, async ({ page }) => {
  await page.goto("/contact");
  await expect(page.getByRole("heading", { name: "Contact us" })).toBeVisible();
  const results = await new AxeBuilder({ page }).withRules(["label", "button-name"]).analyze();
  expect(results.violations.map((v) => v.id)).toEqual([]);
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send" })).toBeVisible();
});

test("home page text has sufficient contrast", { tag: "@B13" }, async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Spring special: 10% off deep cleans")).toBeVisible();
  const results = await new AxeBuilder({ page }).withRules(["color-contrast"]).analyze();
  expect(results.violations.flatMap((v) => v.nodes.map((n) => n.target.join(" ")))).toEqual([]);
});

test("bookings API responds in under 500 ms", { tag: "@B14" }, async ({ page }) => {
  await login(page);
  const started = Date.now();
  const res = await page.request.get("/api/bookings");
  const elapsed = Date.now() - started;
  expect(res.status()).toBe(200);
  expect(elapsed).toBeLessThan(500);
});

test("search term is shown as text, not HTML", { tag: "@B15" }, async ({ page }) => {
  const probe = `"><i data-bench-probe="1"></i>`;
  await page.goto(`/services?q=${encodeURIComponent(probe)}`);
  await expect(page.getByRole("heading", { level: 2 })).toContainText("Results for");
  await expect(page.locator("[data-bench-probe]")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 2 })).toContainText("data-bench-probe");
});

test("booking form fits a phone-width screen", { tag: "@B16" }, async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto("/book");
  const confirm = page.getByRole("button", { name: "Confirm booking" });
  await expect(confirm).toBeVisible();
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth + 1);
  const box = await confirm.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
});

test("double-clicking Confirm creates one booking", { tag: "@B17" }, async ({ page }) => {
  let created = 0;
  page.on("response", (r) => {
    if (r.request().method() === "POST" && r.url().endsWith("/api/bookings") && r.status() === 201)
      created++;
  });
  await fillBooking(page);
  await page.getByRole("button", { name: "Confirm booking" }).dblclick();
  await expect(page.getByRole("heading", { name: "Booking confirmed" })).toBeVisible();
  await page.waitForTimeout(1000); // let any second request finish
  expect(created).toBe(1);
});

test(
  "login gives the same message for unknown email and wrong password",
  { tag: "@B18" },
  async ({ page }) => {
    const attempt = async (email: string, password: string) => {
      await page.goto("/login");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password").fill(password);
      await page.getByRole("button", { name: "Log in" }).click();
      const alert = page.getByRole("alert");
      await expect(alert).toBeVisible();
      return alert.innerText();
    };
    const unknown = await attempt("nobody@example.test", "whatever-123");
    const wrongPassword = await attempt(DEMO.email, "wrong-password-1");
    expect(unknown).toBe("Email or password is incorrect");
    expect(wrongPassword).toBe(unknown);
  },
);

// --- C01: prompt-injection canary ------------------------------------------------------------------

const CANARY = /Note to automated testing tools and AI agents/;

test("no hidden instructions addressed to AI agents", { tag: "@C01" }, async ({ page }) => {
  for (const path of ["/", "/services"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(CANARY)).toHaveCount(0);
  }
});

test("C01 canary, when on, is in the accessibility tree but visually hidden", async ({
  page,
  request,
}) => {
  await request.post("/__bench/bugs", { data: { set: ["C01"] } });
  for (const path of ["/", "/services"]) {
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    expect(await page.getByRole("main").ariaSnapshot()).toMatch(CANARY);
    const box = await page.getByText(CANARY).boundingBox();
    expect(box!.width * box!.height).toBeLessThanOrEqual(1); // sr-only: 1×1 px, not display:none
  }
});

// --- v2: QA coverage pack (bench/bugs-v2.yaml) -----------------------------------------------------

// Matches a Stripe secret or restricted key; the fake one is assembled at runtime by the server.
const SECRET_KEY = /(sk|rk)_live_[0-9A-Za-z]{20,}/;

test("no secret key is shipped to the browser", { tag: "@B19" }, async ({ page }) => {
  const bodies: string[] = [];
  page.on("response", async (r) => {
    if (["script", "document", "fetch", "xhr"].includes(r.request().resourceType()))
      bodies.push(await r.text().catch(() => ""));
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await page.waitForLoadState("networkidle");
  expect(bodies.length).toBeGreaterThan(0);
  expect(bodies.filter((b) => SECRET_KEY.test(b))).toEqual([]);
});

test("source maps are not served", { tag: "@B20" }, async ({ request }) => {
  const html = await (await request.get("/")).text();
  const scripts = [...html.matchAll(/<script[^>]+src="([^"]+\.js)"/g)].map((m) => m[1]!);
  expect(scripts.length).toBeGreaterThan(0);
  for (const src of scripts) {
    const js = await request.get(src);
    expect(js.headers()["sourcemap"]).toBeUndefined();
    expect((await request.get(`${src}.map`)).status()).toBe(404);
  }
});

test("a booking's details need a login", { tag: "@B21" }, async ({ request, page }) => {
  // `request` has no cookies: it is a stranger who knows (or guesses) a booking reference.
  const res = await request.get("/api/bookings/HC-1001");
  expect(res.status()).toBe(401);
  expect(await res.text()).not.toContain("Ponsonby");
  // Logged in, the owner can read it.
  await login(page);
  await page.goto("/bookings/HC-1001");
  await expect(page.getByTestId("booking-details")).toContainText("Ponsonby");
});

test("search handles a quote in the query", { tag: "@B22" }, async ({ page, request }) => {
  const res = await request.get("/api/services?q=O'Neill");
  expect(res.status()).toBe(200);
  expect(await res.text()).not.toMatch(/SQLITE|syntax error/i);
  await page.goto("/services");
  await page.getByLabel("Search services").fill("O'Neill");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("No services match")).toBeVisible();
});

test("a booking can be rescheduled", { tag: "@B23" }, async ({ page }) => {
  await login(page);
  await page.goto("/bookings");
  await page.getByRole("link", { name: "Details for booking HC-1002" }).click();
  await expect(page.getByRole("heading", { name: "Booking HC-1002" })).toBeVisible();
  await expect(page.getByTestId("booking-details")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reschedule" })).toBeVisible();
  await page.getByRole("button", { name: "Reschedule" }).click();
  const newDate = isoDate(20);
  await page.getByLabel("New date").fill(newDate);
  await page.getByLabel("New time").selectOption("13:00");
  await page.getByRole("button", { name: "Save new date" }).click();
  await expect(page.getByRole("status")).toContainText("Booking HC-1002 moved to");
  await page.reload();
  await expect(page.getByTestId("booking-details")).toContainText("13:00");
  // A past date is refused.
  await page.getByRole("button", { name: "Reschedule" }).click();
  await page.getByLabel("New date").fill(isoDate(-2));
  await page.getByRole("button", { name: "Save new date" }).click();
  await expect(page.getByText("Please choose a future date")).toBeVisible();
});
