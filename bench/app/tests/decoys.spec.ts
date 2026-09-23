// Decoys D01–D04 are correct behaviour that an over-eager tester might report. They must always exist.
import { expect, test } from "./fixtures";

test("D01: sold-out service has a disabled Book button with an explanation", async ({ page }) => {
  await page.goto("/services/s8");
  await expect(page.getByRole("button", { name: "Book this service" })).toBeDisabled();
  await expect(page.getByText("Sold out — back in November")).toBeVisible();
});

test("D02: a new account shows 'No bookings yet'", async ({ page }) => {
  await page.goto("/signup");
  await page.getByLabel("Full name").fill("Tama Newuser");
  await page.getByLabel("Email").fill(`tama.${Date.now()}@example.test`);
  await page.getByLabel("Password").fill("a-long-password");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
  await page.goto("/bookings");
  await expect(page.getByText("No bookings yet")).toBeVisible();
});

test("D03: quote shows 'Calculating…' for about 800 ms before the breakdown", async ({ page }) => {
  await page.goto("/quote");
  await expect(page.getByLabel("Service").locator("option")).toHaveCount(9);
  await page.getByLabel("Service").selectOption("s2");
  await page.getByLabel("Hours").fill("2");
  const started = Date.now();
  await page.getByRole("button", { name: "Calculate" }).click();
  await expect(page.getByText("Calculating…")).toBeVisible();
  await expect(page.getByTestId("quote-total")).toBeVisible();
  expect(Date.now() - started).toBeGreaterThanOrEqual(700);
});

test("D04: fewer than 2 hours shows 'Minimum booking is 2 hours'", async ({ page }) => {
  await page.goto("/quote");
  await expect(page.getByLabel("Service").locator("option")).toHaveCount(9);
  await page.getByLabel("Service").selectOption("s1");
  await page.getByLabel("Hours").fill("1");
  await page.getByRole("button", { name: "Calculate" }).click();
  await expect(page.getByText("Minimum booking is 2 hours")).toBeVisible();
  await expect(page.getByTestId("quote-total")).toHaveCount(0);
});
