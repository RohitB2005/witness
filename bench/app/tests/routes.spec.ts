// The production server answers real app routes with 200 and unknown paths with 404, so broken-link
// detection works (a SPA that returns 200 for everything would hide B10).
import { expect, test } from "./fixtures";

const KNOWN = [
  "/",
  "/services",
  ...["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"].map((id) => `/services/${id}`),
  "/quote",
  "/book",
  "/book/confirmation?ref=HC-1001",
  "/login",
  "/signup",
  "/bookings",
  "/profile",
  "/faq",
  "/contact",
  "/terms",
  "/privacy",
  "/services?q=window&sort=price-asc",
];

const UNKNOWN = [
  "/terms-and-conditions",
  "/services/s99",
  "/nope",
  "/api/nope",
  "/images/services/missing.jpg",
];

test("known routes return 200", async ({ request }) => {
  for (const path of KNOWN) {
    expect(`${path} ${(await request.get(path)).status()}`).toBe(`${path} 200`);
  }
});

test("unknown paths return 404", async ({ request }) => {
  for (const path of UNKNOWN) {
    expect(`${path} ${(await request.get(path)).status()}`).toBe(`${path} 404`);
  }
});
