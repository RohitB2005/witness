import { useState } from "react";
import { isBugOn } from "../../shared/bugs";
import { Page } from "../components/ui";

const FAQS = [
  {
    id: "areas",
    q: "Which areas do you cover?",
    a: "We clean homes and offices across central, west and north Auckland.",
  },
  {
    id: "home",
    q: "Do I need to be home during the clean?",
    a: "No. Many customers leave a key in a lockbox. Just tell us in the booking notes.",
  },
  {
    id: "pets",
    q: "Are your products safe for pets?",
    a: "Yes. We use plant-based products that are safe for children and pets.",
  },
  {
    id: "supplies",
    q: "Do you bring your own supplies?",
    a: "Yes. Our cleaners bring all equipment and products, including a vacuum.",
  },
  {
    id: "cancel",
    q: "How do I cancel or change a booking?",
    a: "Log in and open My bookings. Cancellation is free up to 24 hours before the clean.",
  },
  {
    id: "gst",
    q: "Do your prices include GST?",
    a: "No. Prices on the site exclude GST; your quote shows GST and the total separately.",
  },
];

// Related links per answer (none yet).
const DETAILS: Record<string, { links: string[] }> = {
  areas: { links: [] },
  home: { links: [] },
  pets: { links: [] },
  supplies: { links: [] },
  cancel: { links: [] },
  gst: { links: [] },
};

export function FaqPage() {
  const [open, setOpen] = useState<Set<string>>(new Set());

  const toggle = (id: string) => {
    // B11: a stale key for the 4th item makes `details` undefined -> TypeError on open
    const key = isBugOn("B11") && id === "supplies" ? "own-supplies" : id;
    const details = DETAILS[key] as { links: string[] };
    if (details.links.length > 3) return;
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Page title="Frequently asked questions">
      <div className="divide-y divide-gray-200 rounded-lg border border-gray-200">
        {FAQS.map((f) => {
          const expanded = open.has(f.id);
          return (
            <div key={f.id}>
              <h2>
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={`faq-${f.id}`}
                  onClick={() => toggle(f.id)}
                  className="flex w-full items-center justify-between px-4 py-3 text-left font-semibold text-gray-900 hover:bg-gray-50"
                >
                  {f.q}
                  <span aria-hidden="true">{expanded ? "−" : "+"}</span>
                </button>
              </h2>
              <div id={`faq-${f.id}`} hidden={!expanded} className="px-4 pb-4 text-gray-800">
                {f.a}
              </div>
            </div>
          );
        })}
      </div>
    </Page>
  );
}
