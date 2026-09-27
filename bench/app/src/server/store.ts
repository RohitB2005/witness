// In-memory data for Harbour Clean. reset() restores the seed (POST /__bench/reset).
import { randomBytes } from "node:crypto";
import type { Booking, PublicUser, Service } from "../shared/domain";
import { addDays, toIsoDate } from "../shared/domain";

export interface User extends PublicUser {
  id: string;
  password: string; // plain text is fine for a throwaway in-memory benchmark
}

export interface StoredBooking extends Booking {
  userId: string | null;
}

export const SERVICES: readonly Service[] = [
  {
    id: "s1",
    name: "Regular home clean",
    priceCents: 4500,
    unit: "hour",
    description: "Kitchen, bathrooms, dusting, vacuuming and mopping throughout your home.",
    image: "/images/services/regular-home-clean.svg",
    soldOut: false,
  },
  {
    id: "s2",
    name: "Deep clean",
    priceCents: 6000,
    unit: "hour",
    description:
      "A top-to-bottom clean including skirting boards, inside cupboards and behind appliances.",
    image: "/images/services/deep-clean.svg",
    soldOut: false,
  },
  {
    id: "s3",
    name: "Window cleaning",
    priceCents: 2000,
    unit: "hour",
    description: "Inside and outside glass, frames and sills, up to two storeys.",
    image: "/images/services/window-cleaning.svg",
    soldOut: false,
  },
  {
    id: "s4",
    name: "Oven clean",
    priceCents: 10000,
    unit: "fixed",
    description: "Oven, racks, trays and hob degreased and polished. One fixed price.",
    image: "/images/services/oven-clean.svg",
    soldOut: false,
  },
  {
    id: "s5",
    name: "Carpet shampoo",
    priceCents: 800,
    unit: "hour",
    description: "Hot-water extraction for carpets and rugs. Dry within a few hours.",
    image: "/images/services/carpet-shampoo.svg",
    soldOut: false,
  },
  {
    id: "s6",
    name: "End-of-tenancy clean",
    priceCents: 5500,
    unit: "hour",
    description: "Everything your property manager checks, so you get your bond back.",
    image: "/images/services/end-of-tenancy-clean.svg",
    soldOut: false,
  },
  {
    id: "s7",
    name: "Office clean",
    priceCents: 5000,
    unit: "hour",
    description: "Desks, kitchens, bathrooms and floors for small offices, before or after hours.",
    image: "/images/services/office-clean.svg",
    soldOut: false,
  },
  {
    id: "s8",
    name: "Pressure washing",
    priceCents: 7500,
    unit: "hour",
    description: "Driveways, decks, paths and exterior walls.",
    image: "/images/services/pressure-washing.svg",
    soldOut: true,
    soldOutNote: "Sold out — back in November",
  },
];

export const SERVICE_IDS: readonly string[] = SERVICES.map((s) => s.id);

export function findService(id: string): Service | undefined {
  return SERVICES.find((s) => s.id === id);
}

export const DEMO_USER = {
  email: "demo@harbourclean.test",
  password: "CleanDemo!23",
  name: "Alex Demo",
  phone: "021 555 0142",
} as const;

const DEMO_ADDRESS = "12 Ponsonby Road, Auckland 1011";

export class Store {
  users: User[] = [];
  bookings: StoredBooking[] = [];
  sessions = new Map<string, string>(); // token -> userId
  private nextRef = 1001;
  private nextUserId = 1;

  constructor() {
    this.reset();
  }

  reset(now: Date = new Date()): void {
    this.users = [];
    this.bookings = [];
    this.sessions.clear();
    this.nextRef = 1001;
    this.nextUserId = 1;
    const demo = this.addUser({ ...DEMO_USER });
    const seed: Array<[serviceId: string, daysAhead: number, time: string, hours: number]> = [
      ["s1", 3, "09:00", 3],
      ["s3", 7, "10:00", 2],
      ["s6", 14, "08:00", 5],
    ];
    for (const [serviceId, daysAhead, time, hours] of seed) {
      this.addBooking({
        userId: demo.id,
        serviceId,
        date: toIsoDate(addDays(now, daysAhead)),
        time,
        hours,
        name: demo.name,
        email: demo.email,
        phone: demo.phone,
        address: DEMO_ADDRESS,
        notes: "",
      });
    }
  }

  addUser(input: Omit<User, "id">): User {
    const user: User = { ...input, id: `u${this.nextUserId++}` };
    this.users.push(user);
    return user;
  }

  findUserByEmail(email: string): User | undefined {
    const wanted = email.trim().toLowerCase();
    return this.users.find((u) => u.email.toLowerCase() === wanted);
  }

  createSession(userId: string): string {
    const token = randomBytes(24).toString("hex");
    this.sessions.set(token, userId);
    return token;
  }

  userForSession(token: string | undefined): User | undefined {
    if (!token) return undefined;
    const userId = this.sessions.get(token);
    return userId ? this.users.find((u) => u.id === userId) : undefined;
  }

  addBooking(input: Omit<StoredBooking, "ref" | "serviceName">): StoredBooking {
    const service = findService(input.serviceId);
    if (!service) throw new Error(`Unknown service ${input.serviceId}`);
    const booking: StoredBooking = {
      ...input,
      ref: `HC-${this.nextRef++}`,
      serviceName: service.name,
    };
    this.bookings.push(booking);
    return booking;
  }

  /** A user's bookings in display order: soonest first. */
  bookingsFor(userId: string): StoredBooking[] {
    return this.bookings
      .filter((b) => b.userId === userId)
      .sort(
        (a, b) =>
          `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`) || a.ref.localeCompare(b.ref),
      );
  }

  findBooking(ref: string): StoredBooking | undefined {
    return this.bookings.find((b) => b.ref === ref);
  }

  deleteBooking(ref: string): void {
    this.bookings = this.bookings.filter((b) => b.ref !== ref);
  }
}

export function toPublicBooking(b: StoredBooking): Booking {
  const { userId: _userId, ...rest } = b;
  return rest;
}
