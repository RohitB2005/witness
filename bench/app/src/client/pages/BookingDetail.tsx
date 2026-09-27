import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useParams } from "react-router";
import { isBugOn } from "../../shared/bugs";
import { TIME_SLOTS, formatDate, toIsoDate, type Booking } from "../../shared/domain";
import { ApiError, api } from "../api";
import {
  Alert,
  Loading,
  Page,
  SelectField,
  TextField,
  buttonPrimary,
  buttonSecondary,
} from "../components/ui";

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[8rem_1fr] gap-2 py-1">
      <dt className="font-medium text-gray-900">{label}</dt>
      <dd className="text-gray-800">{value}</dd>
    </div>
  );
}

function RescheduleForm({
  booking,
  onSaved,
  onClose,
}: {
  booking: Booking;
  onSaved: (b: Booking) => void;
  onClose: () => void;
}) {
  const [date, setDate] = useState(booking.date);
  const [time, setTime] = useState(booking.time);
  const [errors, setErrors] = useState<{ date?: string; time?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFailure(null);
    setErrors({});
    setBusy(true);
    try {
      const res = await api<{ booking: Booking }>(
        `/api/bookings/${encodeURIComponent(booking.ref)}`,
        { method: "PATCH", body: { date, time } },
      );
      onSaved(res.booking);
    } catch (err) {
      if (err instanceof ApiError && err.field && err.status < 500)
        setErrors({ [err.field]: err.message });
      else setFailure((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form noValidate onSubmit={onSubmit} className="mt-4 max-w-sm" aria-label="Reschedule booking">
      {failure && <Alert>{failure}</Alert>}
      <TextField
        id="new-date"
        label="New date"
        type="date"
        min={toIsoDate(new Date())}
        value={date}
        error={errors.date}
        onChange={(e) => setDate(e.target.value)}
      />
      <SelectField
        id="new-time"
        label="New time"
        value={time}
        error={errors.time}
        onChange={(e) => setTime(e.target.value)}
      >
        {TIME_SLOTS.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </SelectField>
      <div className="flex flex-wrap gap-3">
        <button type="submit" className={buttonPrimary} disabled={busy}>
          Save new date
        </button>
        <button type="button" className={buttonSecondary} onClick={onClose}>
          Keep current date
        </button>
      </div>
    </form>
  );
}

export function BookingDetailPage() {
  const { ref = "" } = useParams();
  const [booking, setBooking] = useState<Booking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api<{ booking: Booking }>(`/api/bookings/${encodeURIComponent(ref)}`)
      .then((res) => setBooking(res.booking))
      .catch((e: Error) => setError(e.message));
  }, [ref]);

  return (
    <Page title={`Booking ${ref}`}>
      <div role="status" className="mb-4 text-gray-800">
        {notice}
      </div>
      {error && <Alert>{error}</Alert>}
      {!booking && !error && <Loading label="Loading the booking…" />}
      {booking && (
        <>
          <dl className="mb-6 rounded-lg border border-gray-200 p-4" data-testid="booking-details">
            <Detail label="Service" value={booking.serviceName} />
            <Detail label="Date" value={formatDate(booking.date)} />
            <Detail label="Time" value={booking.time} />
            <Detail label="Hours" value={String(booking.hours)} />
            <Detail label="Name" value={booking.name} />
            <Detail label="Phone" value={booking.phone} />
            <Detail label="Address" value={booking.address} />
          </dl>
          {/* B23: the reschedule feature promised in SCOPE.md is missing */}
          {!isBugOn("B23") && !editing && (
            <button type="button" className={buttonSecondary} onClick={() => setEditing(true)}>
              Reschedule
            </button>
          )}
          {!isBugOn("B23") && editing && (
            <RescheduleForm
              booking={booking}
              onClose={() => setEditing(false)}
              onSaved={(b) => {
                setBooking(b);
                setEditing(false);
                setNotice(`Booking ${b.ref} moved to ${formatDate(b.date)} at ${b.time}.`);
              }}
            />
          )}
        </>
      )}
      <p className="mt-6">
        <Link to="/bookings" className="underline">
          Back to my bookings
        </Link>
      </p>
    </Page>
  );
}
