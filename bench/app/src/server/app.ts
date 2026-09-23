// Harbour Clean API (+ static frontend in production). Seeded bugs are the isBugOn(...) branches.
import { readFileSync } from "node:fs";
import path from "node:path";
import express from "express";
import type { NextFunction, Request, Response } from "express";
import {
  BUG_IDS,
  getActiveBugs,
  isBugId,
  isBugOn,
  setActiveBugs,
  type BugId,
} from "../shared/bugs";
import {
  MAX_HOURS,
  MAX_NAME_LENGTH,
  MIN_HOURS,
  TIME_SLOTS,
  calculateQuote,
  formatPrice,
  isKnownRoute,
  isPastDate,
  isValidEmail,
  isValidIsoDate,
  type Service,
} from "../shared/domain";
import {
  SERVICES,
  SERVICE_IDS,
  findService,
  toPublicBooking,
  type Store,
  type User,
} from "./store";

const SESSION_COOKIE = "hc_session";

export interface AppOptions {
  store: Store;
  /** Built frontend (dist/). When set, the server also serves the app shell. */
  staticDir?: string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly field?: string,
  ) {
    super(message);
  }
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

function setSessionCookie(res: Response, token: string): void {
  res.cookie(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", path: "/" });
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toInt(value: unknown): number {
  const n = typeof value === "number" ? value : Number(str(value).trim() || NaN);
  return Number.isInteger(n) ? n : NaN;
}

function publicService(service: Service): Service {
  if (service.id === "s5" && isBugOn("B09")) {
    return { ...service, image: "/images/services/carpet-shampoo.jpg" }; // B09: file doesn't exist
  }
  return service;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createApp({ store, staticDir }: AppOptions): express.Express {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "100kb" }));

  const currentUser = (req: Request): User | undefined =>
    store.userForSession(readCookie(req, SESSION_COOKIE));

  const requireUser = (req: Request): User => {
    const user = currentUser(req);
    if (!user) throw new HttpError(401, "Please log in to continue.");
    return user;
  };

  // --- Bench control (never linked from the UI) ---------------------------------------------------

  app.get("/__bench/bugs", (_req, res) => {
    res.json({ active: getActiveBugs(), all: BUG_IDS });
  });

  app.post("/__bench/bugs", (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const lists: Record<"set" | "enable" | "disable", BugId[] | undefined> = {
      set: undefined,
      enable: undefined,
      disable: undefined,
    };
    for (const key of ["set", "enable", "disable"] as const) {
      const value = body[key];
      if (value === undefined) continue;
      if (!Array.isArray(value)) throw new HttpError(400, `"${key}" must be an array of bug IDs`);
      const ids = value.map((v) => str(v).toUpperCase());
      const unknown = ids.filter((id) => !isBugId(id));
      if (unknown.length > 0)
        throw new HttpError(400, `Unknown bug flag(s): ${unknown.join(", ")}`);
      lists[key] = ids as BugId[];
    }
    const next = new Set<BugId>(lists.set ?? getActiveBugs());
    for (const id of lists.enable ?? []) next.add(id);
    for (const id of lists.disable ?? []) next.delete(id);
    setActiveBugs(next);
    res.json({ active: getActiveBugs(), all: BUG_IDS });
  });

  app.post("/__bench/reset", (_req, res) => {
    store.reset();
    res.json({ ok: true });
  });

  // --- Services and quotes ---------------------------------------------------------------------

  app.get("/api/services", (req, res) => {
    const q = str(req.query.q).trim();
    const sort = str(req.query.sort) || "recommended";
    let list = [...SERVICES];
    if (q !== "") {
      list = isBugOn("B03")
        ? list.filter((s) => s.name.includes(q)) // B03: case-sensitive search
        : list.filter((s) => s.name.toLowerCase().includes(q.toLowerCase()));
    }
    if (sort === "price-asc") {
      list.sort(
        isBugOn("B02")
          ? (a, b) => (formatPrice(a.priceCents) < formatPrice(b.priceCents) ? -1 : 1) // B02: text sort
          : (a, b) => a.priceCents - b.priceCents,
      );
    } else if (sort === "price-desc") {
      list.sort((a, b) => b.priceCents - a.priceCents);
    } else if (sort === "name") {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    res.json({ services: list.map(publicService) });
  });

  app.get("/api/services/:id", (req, res) => {
    const service = findService(req.params.id);
    if (!service) throw new HttpError(404, "Service not found");
    res.json({ service: publicService(service) });
  });

  app.get("/api/quote", (req, res) => {
    const service = findService(str(req.query.service));
    if (!service) throw new HttpError(400, "Choose a service", "service");
    const hours = toInt(req.query.hours);
    if (Number.isNaN(hours) || hours < MIN_HOURS) {
      throw new HttpError(400, `Minimum booking is ${MIN_HOURS} hours`, "hours");
    }
    if (hours > MAX_HOURS)
      throw new HttpError(400, `Maximum booking is ${MAX_HOURS} hours`, "hours");
    res.json({ quote: calculateQuote(service, hours, { applyGstTwice: isBugOn("B01") }) });
  });

  // --- Auth ---------------------------------------------------------------------------------------

  const meResponse = (user: User | undefined) =>
    user
      ? {
          user: { name: user.name, email: user.email, phone: user.phone },
          bookingCount: store.bookingsFor(user.id).length,
        }
      : { user: null, bookingCount: 0 };

  app.get("/api/auth/me", (req, res) => {
    res.json(meResponse(currentUser(req)));
  });

  app.post("/api/auth/login", (req, res) => {
    const email = str(req.body?.email).trim();
    const password = str(req.body?.password);
    if (email === "" || password === "") throw new HttpError(400, "Enter your email and password.");
    const user = store.findUserByEmail(email);
    if (isBugOn("B18")) {
      // B18: distinct messages reveal whether an account exists
      if (!user) throw new HttpError(401, "No account found for that email");
      if (user.password !== password) throw new HttpError(401, "Incorrect password");
    } else if (!user || user.password !== password) {
      throw new HttpError(401, "Email or password is incorrect");
    }
    setSessionCookie(res, store.createSession(user.id));
    res.json(meResponse(user));
  });

  app.post("/api/auth/signup", (req, res) => {
    const name = str(req.body?.name).trim();
    const email = str(req.body?.email).trim();
    const password = str(req.body?.password);
    if (name === "") throw new HttpError(400, "Please enter your full name.", "name");
    if (name.length > MAX_NAME_LENGTH) throw new HttpError(400, "Name is too long.", "name");
    if (!isValidEmail(email))
      throw new HttpError(400, "Please enter a valid email address.", "email");
    if (password.length < 8) {
      throw new HttpError(400, "Password must be at least 8 characters.", "password");
    }
    if (store.findUserByEmail(email)) {
      throw new HttpError(409, "An account with that email already exists.", "email");
    }
    const user = store.addUser({ name, email, password, phone: "" });
    setSessionCookie(res, store.createSession(user.id));
    res.status(201).json(meResponse(user));
  });

  app.post("/api/auth/logout", (req, res) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) store.sessions.delete(token);
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.json({ ok: true });
  });

  // --- Bookings -----------------------------------------------------------------------------------

  app.get("/api/bookings", async (req, res) => {
    const user = requireUser(req);
    if (isBugOn("B14")) await sleep(3500); // B14: slow endpoint
    res.json({ bookings: store.bookingsFor(user.id).map(toPublicBooking) });
  });

  app.post("/api/bookings", (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const service = findService(str(body.serviceId));
    if (!service) throw new HttpError(400, "Please choose a service.", "service");
    if (service.soldOut) throw new HttpError(400, `${service.name} is sold out.`, "service");
    const date = str(body.date);
    if (!isValidIsoDate(date)) throw new HttpError(400, "Please choose a date.", "date");
    if (!isBugOn("B04") && isPastDate(date)) {
      throw new HttpError(400, "Please choose a future date", "date");
    }
    const time = str(body.time);
    if (!TIME_SLOTS.includes(time)) throw new HttpError(400, "Please choose a time.", "time");
    const hours = toInt(body.hours);
    if (Number.isNaN(hours) || hours < MIN_HOURS) {
      throw new HttpError(400, `Minimum booking is ${MIN_HOURS} hours`, "hours");
    }
    if (hours > MAX_HOURS)
      throw new HttpError(400, `Maximum booking is ${MAX_HOURS} hours`, "hours");
    const name = str(body.name).trim();
    if (name === "") throw new HttpError(400, "Please enter your full name.", "name");
    if (name.length > MAX_NAME_LENGTH) throw new HttpError(400, "Name is too long.", "name");
    const email = str(body.email).trim();
    if (!isValidEmail(email))
      throw new HttpError(400, "Please enter a valid email address.", "email");
    const phone = str(body.phone).trim();
    if (phone === "") throw new HttpError(400, "Please enter a phone number.", "phone");
    const address = str(body.address).trim();
    if (address === "") throw new HttpError(400, "Please enter the address.", "address");
    const notes = str(body.notes).trim().slice(0, 1000);

    if (isBugOn("B05") && name.includes("'")) {
      // B05: simulates building SQL by string concatenation
      throw new Error(`SQL syntax error near '${name.slice(name.indexOf("'"))}'`);
    }

    const user = currentUser(req);
    const booking = store.addBooking({
      userId: user?.id ?? null,
      serviceId: service.id,
      date,
      time,
      hours,
      name,
      email,
      phone,
      address,
      notes,
    });
    res.status(201).json({ booking: toPublicBooking(booking) });
  });

  app.delete("/api/bookings/:ref", (req, res) => {
    const user = requireUser(req);
    const list = store.bookingsFor(user.id);
    const index = list.findIndex((b) => b.ref === req.params.ref);
    if (index === -1) throw new HttpError(404, "Booking not found");
    // B06: with more than one booking, the next one in the list is deleted instead
    const target =
      isBugOn("B06") && list.length > 1 ? list[(index + 1) % list.length] : list[index];
    if (target) store.deleteBooking(target.ref);
    res.json({ bookings: store.bookingsFor(user.id).map(toPublicBooking) });
  });

  // --- Profile and contact ------------------------------------------------------------------------

  app.get("/api/profile", (req, res) => {
    const user = requireUser(req);
    res.json({ profile: { name: user.name, email: user.email, phone: user.phone } });
  });

  app.put("/api/profile", (req, res) => {
    const user = requireUser(req);
    const name = str(req.body?.name).trim();
    const phone = str(req.body?.phone).trim();
    if (name === "") throw new HttpError(400, "Please enter your full name.", "name");
    if (name.length > MAX_NAME_LENGTH) throw new HttpError(400, "Name is too long.", "name");
    if (phone === "") throw new HttpError(400, "Please enter a phone number.", "phone");
    if (!isBugOn("B08")) {
      // B08 skips this: responds as if saved but keeps the old values
      user.name = name;
      user.phone = phone;
    }
    res.json({ profile: { name, email: user.email, phone } });
  });

  app.post("/api/contact", (req, res) => {
    const name = str(req.body?.name).trim();
    const email = str(req.body?.email).trim();
    const message = str(req.body?.message).trim();
    if (name === "") throw new HttpError(400, "Please enter your name.", "name");
    if (!isValidEmail(email))
      throw new HttpError(400, "Please enter a valid email address.", "email");
    if (message === "") throw new HttpError(400, "Please enter a message.", "message");
    res.json({ ok: true });
  });

  app.use("/api", (_req, _res) => {
    throw new HttpError(404, "Not found");
  });

  // --- Frontend (production) ------------------------------------------------------------------------

  if (staticDir) {
    const indexHtml = readFileSync(path.join(staticDir, "index.html"), "utf8");
    app.use(express.static(staticDir, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (req.path.startsWith("/__bench")) return next();
      const lastSegment = req.path.split("/").pop() ?? "";
      if (lastSegment.includes(".")) {
        res.status(404).type("text/plain").send("Not found"); // missing asset, e.g. B09's image
        return;
      }
      const status = isKnownRoute(req.path, SERVICE_IDS) ? 200 : 404;
      res.status(status).type("html").send(indexHtml);
    });
  }

  app.use((_req: Request, res: Response) => {
    res.status(404).type("text/plain").send("Not found");
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, field: err.field });
      return;
    }
    const status = (err as { status?: unknown }).status;
    if (typeof status === "number" && status >= 400 && status < 500) {
      res.status(status).json({ error: "Invalid request" });
      return;
    }
    console.warn(`[bench] 500: ${err instanceof Error ? err.message : String(err)}`);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
