import { describe, expect, it } from "vitest";
import {
  canonicalUrl,
  isIdSegment,
  routePattern,
  snapshotSkeleton,
  structureHash,
} from "./normalise";
import { followable } from "./crawler";

describe("routePattern", () => {
  it.each([
    ["http://a.test/", "/"],
    ["http://a.test/orders/42", "/orders/:id"],
    ["http://a.test/orders/42/", "/orders/:id"],
    ["http://a.test/u/3f2504e0-4f89-11d3-9a0c-0305e82c3301/edit", "/u/:id/edit"],
    ["http://a.test/blob/0123456789abcdef0123", "/blob/:id"],
    ["http://a.test/services/s1", "/services/s1"], // a word with a digit is not an id
    ["http://a.test/search?q=x&a=1", "/search?a&q"],
    ["http://a.test/search?b=2&a=1&a=3#top", "/search?a&b"],
  ])("%s → %s", (url, pattern) => expect(routePattern(url)).toBe(pattern));
});

describe("isIdSegment", () => {
  it.each([
    ["123", true],
    ["about", false],
    ["v2", false],
    ["deadbeefdeadbeef", true],
    ["ORD-1042", true], // reference numbers
    ["INV2024", true],
    ["s1", false],
    ["page-2", false],
  ])("%s → %s", (s, id) => expect(isIdSegment(s)).toBe(id));
});

describe("canonicalUrl", () => {
  it("drops hash and trailing slash and sorts query", () => {
    expect(canonicalUrl("http://a.test/x/?b=2&a=1#frag")).toBe("http://a.test/x?a=1&b=2");
    expect(canonicalUrl("http://a.test/")).toBe("http://a.test/");
  });
});

describe("structure hash", () => {
  const a = `- generic [ref=e3]:
  - banner [ref=e5]:
    - link "Home" [ref=e7] [cursor=pointer]:
      - /url: /
  - main [ref=e24]:
    - heading "Your cart (3 items)" [level=1] [ref=e29]
    - paragraph [ref=e30]: Some text that changes
    - button "Checkout" [ref=e31]`;
  const sameDifferentRefsAndText = a
    .replaceAll("[ref=e", "[ref=f1e")
    .replace("3 items", "4 items")
    .replace("Some text that changes", "Other text");
  const differentPage = a.replace('button "Checkout"', 'button "Pay now"');

  it("ignores refs, cursor hints, URLs, free text and numbers", () => {
    expect(structureHash(sameDifferentRefsAndText)).toBe(structureHash(a));
    expect(snapshotSkeleton(a)).not.toMatch(/ref=|cursor|\/url|Some text/);
  });
  it("differs when controls differ", () => {
    expect(structureHash(differentPage)).not.toBe(structureHash(a));
  });
});

describe("followable", () => {
  const origin = "http://a.test";
  const link = (href: string, text = "x", download = false) => ({ href, text, download });
  it.each([
    [link("http://a.test/about"), "http://a.test/about"],
    [link("http://a.test/about#team"), "http://a.test/about"],
    [link("http://other.test/"), undefined],
    [link("mailto:hi@a.test"), undefined],
    [link("javascript:void(0)"), undefined],
    [link("http://a.test/report.pdf"), undefined],
    [link("http://a.test/file", "Get it", true), undefined],
    [link("http://a.test/account", "Log out"), undefined],
    [link("http://a.test/logout", "Bye"), undefined],
  ])("%o → %s", (l, expected) => expect(followable(l, origin)).toBe(expected));
});

import { rendersAppPage } from "./crawler";

describe("rendersAppPage (an error status with a working app page)", () => {
  it("a real not-found page is an error page", () => {
    expect(rendersAppPage(`- main:\n  - heading "Not found" [level=1]\n  - link "Home"`)).toBe(
      false,
    );
  });
  it("a single-page app answering a deep link with 404 but rendering its page is not", () => {
    const snap = `- main:\n  - heading "Products" [level=2]\n  - combobox "Sort products"\n${'  - button "Add to cart"\n'.repeat(6)}`;
    expect(rendersAppPage(snap)).toBe(true);
  });
});
