import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router";
import { MIN_HOURS, formatMoney, priceLabel, type Quote, type Service } from "../../shared/domain";
import { api } from "../api";
import { Alert, Page, SelectField, TextField, buttonPrimary } from "../components/ui";

// Decoy D03: the calculation always shows "Calculating…" for about 800 ms. Intended, not a bug.
const MIN_CALCULATING_MS = 800;

export function QuotePage() {
  const [services, setServices] = useState<Service[]>([]);
  const [serviceId, setServiceId] = useState("");
  const [hours, setHours] = useState("3");
  const [errors, setErrors] = useState<{ service?: string; hours?: string }>({});
  const [calculating, setCalculating] = useState(false);
  const [quote, setQuote] = useState<Quote | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    api<{ services: Service[] }>("/api/services")
      .then((res) => setServices(res.services))
      .catch((e: Error) => setFailure(e.message));
  }, []);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setQuote(null);
    setFailure(null);
    const next: typeof errors = {};
    const hoursNum = Number(hours);
    if (serviceId === "") next.service = "Please choose a service.";
    // Decoy D04: minimum booking is 2 hours. Intended, not a bug.
    if (!Number.isInteger(hoursNum) || hoursNum < MIN_HOURS)
      next.hours = `Minimum booking is ${MIN_HOURS} hours`;
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    setCalculating(true);
    const started = Date.now();
    try {
      const res = await api<{ quote: Quote }>(
        `/api/quote?service=${encodeURIComponent(serviceId)}&hours=${hoursNum}`,
      );
      const wait = MIN_CALCULATING_MS - (Date.now() - started);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      setQuote(res.quote);
    } catch (err) {
      setFailure((err as Error).message);
    } finally {
      setCalculating(false);
    }
  };

  const selected = services.find((s) => s.id === quote?.serviceId);

  return (
    <Page title="Get a quote">
      <p className="mb-6 text-gray-800">Prices exclude GST. Your quote shows GST separately.</p>
      <form noValidate onSubmit={onSubmit} className="max-w-md">
        <SelectField
          id="service"
          label="Service"
          value={serviceId}
          error={errors.service}
          onChange={(e) => setServiceId(e.target.value)}
        >
          <option value="">Choose a service</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({priceLabel(s)})
            </option>
          ))}
        </SelectField>
        <TextField
          id="hours"
          label="Hours"
          type="number"
          inputMode="numeric"
          min={MIN_HOURS}
          step={1}
          value={hours}
          error={errors.hours}
          onChange={(e) => setHours(e.target.value)}
        />
        <button type="submit" className={buttonPrimary} disabled={calculating}>
          Calculate
        </button>
      </form>

      <div aria-live="polite" className="mt-6 max-w-md">
        {calculating && <p className="text-gray-800">Calculating…</p>}
        {failure && <Alert>{failure}</Alert>}
        {quote && selected && (
          <section
            aria-labelledby="breakdown-heading"
            className="rounded-lg border border-gray-200 p-4"
          >
            <h2 id="breakdown-heading" className="mb-3 text-xl font-bold text-gray-900">
              Your quote
            </h2>
            <p className="mb-3 text-gray-800">
              {selected.name}
              {selected.unit === "fixed" ? " (fixed price)" : `, ${quote.hours} hours`}
            </p>
            <dl className="grid grid-cols-2 gap-y-2">
              <dt className="text-gray-800">Subtotal</dt>
              <dd className="text-right" data-testid="quote-subtotal">
                {formatMoney(quote.subtotalCents)}
              </dd>
              <dt className="text-gray-800">GST (15%)</dt>
              <dd className="text-right" data-testid="quote-gst">
                {formatMoney(quote.gstCents)}
              </dd>
              <dt className="font-bold text-gray-900">Total (incl. 15% GST)</dt>
              <dd className="text-right font-bold text-gray-900" data-testid="quote-total">
                {formatMoney(quote.totalCents)}
              </dd>
            </dl>
            <Link to={`/book?service=${selected.id}`} className={`${buttonPrimary} mt-4`}>
              Book this clean
            </Link>
          </section>
        )}
      </div>
    </Page>
  );
}
