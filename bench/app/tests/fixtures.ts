import { test as base, expect, type Page } from "@playwright/test";

export { expect };

export const DEMO = {
  email: "demo@harbourclean.test",
  password: process.env.BENCH_TEST_PASSWORD ?? "CleanDemo!23",
  phone: "021 555 0142",
};

const BUG_TAG = /^@(B\d\d|C01)$/;

/**
 * Auto fixture: before every test, restore seed data and switch all flags off. In the "flagged"
 * project, switch on only the test's own flag (from its @Bxx tag) and mark the test as expected to
 * fail. Playwright then reports an error if a bug test still passes with its bug on.
 */
export const test = base.extend<{ benchState: void }>({
  benchState: [
    async ({ request }, use, testInfo) => {
      const reset = await request.post("/__bench/reset");
      expect(reset.ok()).toBe(true);
      const tag = testInfo.tags.find((t) => BUG_TAG.test(t));
      const flagged = testInfo.project.name === "flagged" && tag !== undefined;
      const bugId = tag?.slice(1);
      const res = await request.post("/__bench/bugs", {
        data: { set: flagged && bugId ? [bugId] : [] },
      });
      expect(res.ok()).toBe(true);
      if (flagged) testInfo.fail(true, `${bugId} is on, so the clean-behaviour check must fail`);
      await use();
    },
    { auto: true },
  ],
});

export function isoDate(daysFromToday: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function parseMoney(text: string): number {
  const match = /-?\$?\s*([\d,]+(?:\.\d+)?)/.exec(text);
  if (!match?.[1]) throw new Error(`No amount in "${text}"`);
  return Number(match[1].replace(/,/g, ""));
}

export async function login(page: Page): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(DEMO.email);
  await page.getByLabel("Password").fill(DEMO.password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page.getByRole("button", { name: "Log out" })).toBeVisible();
}

export interface BookingInput {
  service: string;
  date: string;
  time: string;
  hours: string;
  name: string;
  email: string;
  phone: string;
  address: string;
}

export const GUEST_BOOKING: BookingInput = {
  service: "s1",
  date: isoDate(5),
  time: "10:00",
  hours: "3",
  name: "Mere Parata",
  email: "mere@example.test",
  phone: "021 555 0100",
  address: "4 Queen Street, Auckland",
};

export async function fillBooking(
  page: Page,
  overrides: Partial<BookingInput> = {},
): Promise<void> {
  const b = { ...GUEST_BOOKING, ...overrides };
  await page.goto("/book");
  // Wait for the service list to load before choosing one.
  await expect(page.getByLabel("Service").locator("option")).toHaveCount(9);
  await page.getByLabel("Service").selectOption(b.service);
  await page.getByLabel("Date").fill(b.date);
  await page.getByLabel("Time").selectOption(b.time);
  await page.getByLabel("Hours").fill(b.hours);
  await page.getByLabel("Full name").fill(b.name);
  await page.getByLabel("Email").fill(b.email);
  await page.getByLabel("Phone").fill(b.phone);
  await page.getByLabel("Address").fill(b.address);
}
