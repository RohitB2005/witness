// Tiny static fixture server for detector/browser tests (SPEC FR-4 AC). One route table per server.
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

export interface FixtureRoute {
  status?: number;
  body?: string | Buffer;
  contentType?: string;
  headers?: Record<string, string>;
  delayMs?: number;
  /** Drop the connection instead of responding (for DET-REQFAIL). */
  destroy?: boolean;
}

export type FixtureRoutes = Record<string, FixtureRoute | ((req: IncomingMessage) => FixtureRoute)>;

export interface FixtureServer {
  origin: string;
  url(path: string): string;
  /** Every request received, in order: "METHOD /path". */
  requests: string[];
  close(): Promise<void>;
}

export async function startFixtureServer(routes: FixtureRoutes): Promise<FixtureServer> {
  const requests: string[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = new URL(req.url ?? "/", "http://x").pathname;
    requests.push(`${req.method} ${path}`);
    const entry = routes[`${req.method} ${path}`] ?? routes[path];
    const route = typeof entry === "function" ? entry(req) : entry;
    const respond = () => {
      if (!route) {
        res.writeHead(404, { "content-type": "text/html" });
        res.end("<!doctype html><title>Not found</title><h1>Not found</h1>");
        return;
      }
      if (route.destroy) {
        req.socket.destroy();
        return;
      }
      res.writeHead(route.status ?? 200, {
        "content-type": route.contentType ?? "text/html; charset=utf-8",
        ...route.headers,
      });
      res.end(route.body ?? "");
    };
    req.resume();
    req.on("end", () => (route?.delayMs ? setTimeout(respond, route.delayMs) : respond()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  const origin = `http://127.0.0.1:${port}`;
  return {
    origin,
    url: (p) => origin + p,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A minimal accessible HTML page: passes axe with default rules. */
export function page(body: string, opts: { title?: string; head?: string } = {}): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${opts.title ?? "Fixture"}</title>${opts.head ?? ""}</head><body><main><h1>${opts.title ?? "Fixture"}</h1>${body}</main></body></html>`;
}

/** 1×1 transparent PNG. */
export const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);
