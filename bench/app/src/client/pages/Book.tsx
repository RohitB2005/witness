import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { isBugOn } from "../../shared/bugs";
import {
  MAX_HOURS,
  MIN_HOURS,
  TIME_SLOTS,
  formatDate,
  formatMoney,
  isPastDate,
  isValidEmail,
  isValidIsoDate,
  toIsoDate,
  type Booking,
  type Service,
} from "../../shared/domain";
import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import {
  Alert,
  Page,
  SelectField,
  TextAreaField,
  TextField,
  buttonPrimary,
} from "../components/ui";

type FieldName = "service" | "date" | "time" | "hours" | "name" | "email" | "phone" | "address";
type Errors = Partial<Record<FieldName, string>>;

interface FormState {
  serviceId: string;
  date: string;
  time: string;
  hours: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
}

function validate(form: FormState): Errors {
  const errors: Errors = {};
  if (form.serviceId === "") errors.service = "Please choose a service.";
  if (!isValidIsoDate(form.date)) errors.date = "Please choose a date.";
  else if (!isBugOn("B04") && isPastDate(form.date)) errors.date = "Please choose a future date"; // B04 skips this
  if (form.time === "") errors.time = "Please choose a time.";
  const hours = Number(form.hours);
  if (!Number.isInteger(hours) || hours < MIN_HOURS)
    errors.hours = `Minimum booking is ${MIN_HOURS} hours`;
  else if (hours > MAX_HOURS) errors.hours = `Maximum booking is ${MAX_HOURS} hours`;
  if (form.name.trim() === "") errors.name = "Please enter your full name.";
  if (!isValidEmail(form.email.trim())) errors.email = "Please enter a valid email address.";
  if (form.phone.trim() === "") errors.phone = "Please enter a phone number.";
  if (form.address.trim() === "") errors.address = "Please enter the address.";
  return errors;
}

export function BookPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, refresh } = useAuth();
  const [services, setServices] = useState<Service[]>([]);
  const [form, setForm] = useState<FormState>({
    serviceId: params.get("service") ?? "",
    date: "",
    time: "",
    hours: "3",
    name: "",
    email: "",
    phone: "",
    address: "",
    notes: "",
  });
  const [errors, setErrors] = useState<Errors>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    api<{ services: Service[] }>("/api/services")
      .then((res) => setServices(res.services))
      .catch((e: Error) => setFailure(e.message));
  }, []);

  useEffect(() => {
    if (!user) return;
    setForm((f) => ({
      ...f,
      name: f.name || user.name,
      email: f.email || user.email,
      phone: f.phone || user.phone,
    }));
  }, [user]);

  const set = (key: keyof FormState) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const guard = !isBugOn("B17"); // B17: no in-flight guard, so a double click submits twice
    if (guard && submittingRef.current) return;
    setFailure(null);
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    if (guard) submittingRef.current = true;
    setSubmitting(true);
    try {
      const res = await api<{ booking: Booking }>("/api/bookings", {
        method: "POST",
        body: {
          serviceId: form.serviceId,
          date: form.date,
          time: form.time,
          hours: Number(form.hours),
          name: form.name,
          email: form.email,
          phone: form.phone,
          address: form.address,
          notes: form.notes,
        },
      });
      if (user) await refresh();
      navigate(`/book/confirmation?ref=${encodeURIComponent(res.booking.ref)}`);
    } catch (err) {
      if (err instanceof ApiError && err.field && err.status < 500) {
        setErrors({ [err.field]: err.message });
      } else {
        setFailure((err as Error).message);
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const selected = services.find((s) => s.id === form.serviceId);
  const hoursNum = Number(form.hours);
  const estimate =
    selected && Number.isInteger(hoursNum) && hoursNum > 0
      ? selected.unit === "fixed"
        ? selected.priceCents
        : selected.priceCents * hoursNum
      : null;

  // B16: a fixed 480 px summary panel in a non-wrapping row overflows phone-width screens
  const rowClass = isBugOn("B16")
    ? "mt-6 flex flex-row items-start gap-4"
    : "mt-6 flex flex-col gap-4 sm:flex-row sm:items-start";
  const panelClass = isBugOn("B16")
    ? "shrink-0 rounded-lg border border-gray-200 bg-gray-50 p-4"
    : "w-full rounded-lg border border-gray-200 bg-gray-50 p-4 sm:w-80";
  const panelStyle = isBugOn("B16") ? { width: 480 } : undefined;

  return (
    <Page title="Book a clean">
      {failure && <Alert>{failure}</Alert>}
      <form noValidate onSubmit={onSubmit}>
        <div className="grid gap-x-6 sm:grid-cols-2">
          <SelectField
            id="service"
            label="Service"
            value={form.serviceId}
            error={errors.service}
            onChange={set("serviceId")}
          >
            <option value="">Choose a service</option>
            {services.map((s) => (
              <option key={s.id} value={s.id} disabled={s.soldOut}>
                {s.name}
                {s.soldOut ? " (sold out)" : ""}
              </option>
            ))}
          </SelectField>
          <TextField
            id="date"
            label="Date"
            type="date"
            min={isBugOn("B04") ? undefined : toIsoDate(new Date())}
            value={form.date}
            error={errors.date}
            onChange={set("date")}
          />
          <SelectField
            id="time"
            label="Time"
            value={form.time}
            error={errors.time}
            onChange={set("time")}
          >
            <option value="">Choose a time</option>
            {TIME_SLOTS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </SelectField>
          <TextField
            id="hours"
            label="Hours"
            type="number"
            inputMode="numeric"
            min={MIN_HOURS}
            max={MAX_HOURS}
            step={1}
            value={form.hours}
            error={errors.hours}
            onChange={set("hours")}
          />
          <TextField
            id="name"
            label="Full name"
            autoComplete="name"
            value={form.name}
            error={errors.name}
            onChange={set("name")}
          />
          <TextField
            id="email"
            label="Email"
            type="email"
            autoComplete="email"
            value={form.email}
            error={errors.email}
            onChange={set("email")}
          />
          <TextField
            id="phone"
            label="Phone"
            type="tel"
            autoComplete="tel"
            value={form.phone}
            error={errors.phone}
            onChange={set("phone")}
          />
          <TextField
            id="address"
            label="Address"
            autoComplete="street-address"
            value={form.address}
            error={errors.address}
            onChange={set("address")}
          />
        </div>
        <TextAreaField
          id="notes"
          label="Notes (optional)"
          value={form.notes}
          onChange={set("notes")}
        />

        <div className={rowClass}>
          <section aria-labelledby="summary-heading" className={panelClass} style={panelStyle}>
            <h2 id="summary-heading" className="mb-2 text-lg font-bold text-gray-900">
              Booking summary
            </h2>
            <dl className="grid grid-cols-2 gap-y-1 text-gray-800">
              <dt>Service</dt>
              <dd>{selected?.name ?? "—"}</dd>
              <dt>When</dt>
              <dd>
                {isValidIsoDate(form.date)
                  ? `${formatDate(form.date)}${form.time ? `, ${form.time}` : ""}`
                  : "—"}
              </dd>
              <dt>Estimate</dt>
              <dd>{estimate === null ? "—" : `${formatMoney(estimate)} excl. GST`}</dd>
            </dl>
          </section>
          <button
            type="submit"
            className={buttonPrimary}
            disabled={isBugOn("B17") ? false : submitting}
            aria-busy={submitting || undefined}
          >
            Confirm booking
          </button>
        </div>
      </form>
    </Page>
  );
}
