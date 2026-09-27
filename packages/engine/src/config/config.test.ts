import { describe, expect, it } from "vitest";
import { BUDGETS } from "./budgets";
import { ConfigError, defaultMode, isLocalHost, parseTargetUrl, resolveScanConfig } from "./schema";

describe("scan config", () => {
  it("defaults mode by host: staging for local/test hosts, production otherwise", () => {
    expect(defaultMode(new URL("http://localhost:5180"))).toBe("staging");
    expect(defaultMode(new URL("http://127.0.0.1:3000"))).toBe("staging");
    expect(defaultMode(new URL("http://shop.local"))).toBe("staging");
    expect(defaultMode(new URL("http://app.test"))).toBe("staging");
    expect(defaultMode(new URL("https://example.com"))).toBe("production");
    expect(isLocalHost("[::1]")).toBe(true);
  });

  it("fills defaults", () => {
    const c = resolveScanConfig({ url: "https://example.com" });
    expect(c).toMatchObject({
      mode: "production",
      budget: "standard",
      pipeline: "full",
      llmCache: "rw",
      viewport: { width: 1280, height: 800 },
      mobileViewport: { width: 375, height: 667 },
    });
  });

  it.each([
    ["not a url", /isn't a valid web address/],
    ["ftp://example.com", /only scans http/],
    ["file:///etc/passwd", /only scans http/],
    ["https://user:pw@example.com", /credentials fields/],
  ])("rejects %s with a plain-language message", (url, msg) => {
    expect(() => parseTargetUrl(url)).toThrow(ConfigError);
    expect(() => parseTargetUrl(url)).toThrow(msg);
  });

  it("rejects an over-long hint", () => {
    expect(() => resolveScanConfig({ url: "http://localhost", hint: "x".repeat(201) })).toThrow(
      ConfigError,
    );
  });

  it("budget presets match FR-14", () => {
    expect(BUDGETS.quick).toMatchObject({
      pages: 15,
      journeys: 2,
      stepsPerJourney: 15,
      llmUsd: 0.5,
    });
    expect(BUDGETS.standard).toMatchObject({
      pages: 40,
      journeys: 3, // was 5: fits replay into 8 minutes (D50)
      stepsPerJourney: 25,
      llmUsd: 2,
    });
    expect(BUDGETS.deep).toMatchObject({ pages: 100, journeys: 8, stepsPerJourney: 35, llmUsd: 5 });
    expect(BUDGETS.standard.wallClockMs).toBe(8 * 60_000);
  });
});
