// SECURITY.md T5: the gateway never sends a secret value to a model.
// Found in the P2 spike: Playwright aria snapshots show what was typed into a password field in plain text,
// so any snapshot taken after logging in would carry the password into the next prompt.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Browser } from "playwright";
import { z } from "zod";
import { testGateway } from "../../test/mock-llm";
import { launchBrowser } from "../browser/context";
import { SecretVault } from "../browser/vault";
import { SecretLeakError } from "./gateway";
import { pageContent } from "./prompts/universal";

const PASSWORD = "Tr1cky pa$$word&=";
let browser: Browser;

beforeAll(async () => {
  browser = await launchBrowser();
});
afterAll(async () => {
  await browser.close();
});

function vault(): SecretVault {
  const v = new SecretVault();
  v.set("password", PASSWORD);
  return v;
}

describe("redaction", () => {
  it("a real aria snapshot after typing a password contains it — and the model only sees the placeholder", async () => {
    const page = await browser.newPage();
    await page.setContent(
      `<form><label>Email <input type="email"></label><label>Password <input type="password" id="pw"></label><button>Log in</button></form>`,
    );
    await page.locator("#pw").fill(PASSWORD);
    const snapshot = await page.ariaSnapshot({ mode: "ai" });
    await page.close();
    expect(snapshot).toContain(PASSWORD); // the risk is real

    const t = await testGateway([], [{ tool: "finish", input: { note: "ok" } }], {
      vault: vault(),
    });
    const r = await t.gateway.toolCall({
      role: "explorer",
      tier: "fast",
      instructions: "Drive the browser.",
      prompt: `History: typed ${PASSWORD} (encoded ${encodeURIComponent(PASSWORD)})\n${pageContent(snapshot, "http://app.test/login")}`,
      tools: { finish: { description: "End", schema: z.object({ note: z.string() }) } },
    });
    expect(r.ok).toBe(true);
    const sent = t.fast.prompts.join("\n");
    expect(sent).not.toContain(PASSWORD);
    expect(sent).not.toContain(encodeURIComponent(PASSWORD));
    expect(sent).toContain("{{secret:password}}");
  });

  it("throws (and sends nothing) if a vault value would still leave in the payload", async () => {
    const t = await testGateway([], [{ tool: "finish", input: { note: "ok" } }], {
      vault: vault(),
    });
    // Tool descriptions are code, not redacted: a secret there must stop the call, not be sent.
    await expect(
      t.gateway.toolCall({
        role: "explorer",
        tier: "fast",
        instructions: "Drive.",
        prompt: "go",
        tools: {
          finish: {
            description: `End. Password is ${PASSWORD}`,
            schema: z.object({ note: z.string() }),
          },
        },
      }),
    ).rejects.toBeInstanceOf(SecretLeakError);
    expect(t.fast.prompts).toHaveLength(0);
  });

  it("the vault redacts plain, URL-encoded and JSON-escaped forms", () => {
    const v = new SecretVault();
    v.set("password", 'a"b\\c');
    const text = `x a"b\\c y ${encodeURIComponent('a"b\\c')} z ${JSON.stringify('a"b\\c')}`;
    expect(v.leaks(text)).toBe(true);
    const out = v.toPlaceholders(text);
    expect(v.leaks(out)).toBe(false);
    expect(out.match(/\{\{secret:password\}\}/g)).toHaveLength(3);
  });

  it("cache entries never contain the secret (they hold the redacted prompt's output only)", async () => {
    const t = await testGateway([{ json: { echo: "{{secret:password}}" } }], undefined, {
      vault: vault(),
      cacheMode: "rw",
    });
    await t.gateway.structured({
      role: "planner",
      tier: "smart",
      instructions: "x",
      prompt: `secret is ${PASSWORD}`,
      schema: z.object({ echo: z.string() }),
      schemaName: "echo",
    });
    const { readdir, readFile } = await import("node:fs/promises");
    const dir = `${t.cacheDir}/planner`;
    for (const f of await readdir(dir))
      expect(await readFile(`${dir}/${f}`, "utf8")).not.toContain(PASSWORD);
  });
});
