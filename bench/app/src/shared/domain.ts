// Types and pure helpers shared by the Harbour Clean server and browser code.

export interface Service {
  id: string;
  name: string;
  /** Price in cents, excluding GST. Hourly unless `unit` is "fixed". */
  priceCents: number;
  unit: "hour" | "fixed";
  description: string;
  image: string;
  soldOut: boolean;
  soldOutNote?: string;
}

export interface Booking {
  ref: string;
  serviceId: string;
  serviceName: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  hours: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
}

export interface PublicUser {
  name: string;
  email: string;
  phone: string;
}

export interface Quote {
  serviceId: string;
  hours: number;
  subtotalCents: number;
  gstCents: number;
  totalCents: number;
}

export const GST_RATE = 0.15;
export const MIN_HOURS = 2;
export const MAX_HOURS = 12;
export const MAX_NAME_LENGTH = 300;

export const TIME_SLOTS = ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00"];

/** "$45" for whole dollars, "$12.50" otherwise. */
export function formatPrice(cents: number): string {
  return cents % 100 === 0 ? `$${cents / 100}` : formatMoney(cents);
}

/** Always two decimals: "$155.25". */
export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100).toLocaleString("en-NZ");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

export function priceLabel(service: Pick<Service, "priceCents" | "unit">): string {
  return service.unit === "fixed"
    ? `${formatPrice(service.priceCents)} fixed price`
    : `${formatPrice(service.priceCents)} per hour`;
}

/**
 * Quote maths. Subtotal is price × hours (or the fixed price); GST is 15% of subtotal;
 * total = subtotal + GST. All in integer cents, rounded half-up.
 * `applyGstTwice` exists only for seeded bug B01.
 */
export function calculateQuote(
  service: Pick<Service, "id" | "priceCents" | "unit">,
  hours: number,
  options: { applyGstTwice?: boolean } = {},
): Quote {
  const subtotalCents = service.unit === "fixed" ? service.priceCents : service.priceCents * hours;
  const gstCents = Math.round(subtotalCents * GST_RATE);
  const totalCents = options.applyGstTwice
    ? Math.round(subtotalCents * (1 + GST_RATE) * (1 + GST_RATE))
    : subtotalCents + gstCents;
  return { serviceId: service.id, hours, subtotalCents, gstCents, totalCents };
}

/** Local calendar date as YYYY-MM-DD. */
export function toIsoDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

/** True if `isoDate` (YYYY-MM-DD) is before today's local date. Today counts as valid. */
export function isPastDate(isoDate: string, now: Date = new Date()): boolean {
  return isoDate < toIsoDate(now);
}

export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Readable date for lists: "Sat 26 Sep 2026". */
export function formatDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  return new Date(y, m - 1, d).toLocaleDateString("en-NZ", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Client-side routes the production server answers with 200. Anything else gets the app shell with
 * HTTP 404, so a dead link (e.g. B10's /terms-and-conditions) is a real 404 to crawlers.
 */
const STATIC_ROUTES = new Set([
  "/",
  "/services",
  "/quote",
  "/book",
  "/book/confirmation",
  "/login",
  "/signup",
  "/bookings",
  "/profile",
  "/faq",
  "/contact",
  "/terms",
  "/privacy",
]);

export function isKnownRoute(pathname: string, serviceIds: readonly string[]): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  if (STATIC_ROUTES.has(path)) return true;
  const match = /^\/services\/([^/]+)$/.exec(path);
  if (match === null) return false;
  try {
    return serviceIds.includes(decodeURIComponent(match[1] ?? ""));
  } catch {
    return false; // malformed percent-encoding
  }
}
