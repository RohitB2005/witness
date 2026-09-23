import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { isBugOn } from "../../shared/bugs";
import { formatDate, type Booking } from "../../shared/domain";
import { api } from "../api";
import { useAuth } from "../auth";
import { Alert, Loading, Page, buttonPrimary, buttonSecondary } from "../components/ui";

function CancelDialog({
  booking,
  busy,
  onKeep,
  onConfirm,
}: {
  booking: Booking;
  busy: boolean;
  onKeep: () => void;
  onConfirm: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  return (
    <dialog
      ref={ref}
      aria-labelledby="cancel-heading"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-lg p-6"
      onCancel={(e) => {
        e.preventDefault();
        onKeep();
      }}
    >
      <h2 id="cancel-heading" className="mb-2 text-xl font-bold text-gray-900">
        Cancel booking {booking.ref}?
      </h2>
      <p className="mb-6 text-gray-800">
        {booking.serviceName} on {formatDate(booking.date)} at {booking.time}.
      </p>
      <div className="flex flex-wrap justify-end gap-3">
        <button type="button" className={buttonSecondary} onClick={onKeep} autoFocus>
          Keep booking
        </button>
        <button type="button" className={buttonPrimary} onClick={onConfirm} disabled={busy}>
          Yes, cancel
        </button>
      </div>
    </dialog>
  );
}

export function BookingsPage() {
  const { setBookingCount } = useAuth();
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Booking | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api<{ bookings: Booking[] }>("/api/bookings")
      .then((res) => setBookings(res.bookings))
      .catch((e: Error) => setError(e.message));
  }, []);

  const confirmCancel = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ bookings: Booking[] }>(
        `/api/bookings/${encodeURIComponent(pending.ref)}`,
        {
          method: "DELETE",
        },
      );
      setBookings(res.bookings);
      if (!isBugOn("B07")) setBookingCount(res.bookings.length); // B07: badge left stale
      setNotice(`Booking ${pending.ref} cancelled.`);
      setPending(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="My bookings">
      <div role="status" className="mb-4 text-gray-800">
        {notice}
      </div>
      {error && <Alert>{error}</Alert>}
      {!bookings && !error && <Loading label="Loading your bookings…" />}
      {bookings && bookings.length === 0 && (
        <div>
          {/* Decoy D02: a new account legitimately has no bookings. */}
          <p className="mb-4 text-gray-800">No bookings yet</p>
          <Link to="/book" className={buttonPrimary}>
            Book a clean
          </Link>
        </div>
      )}
      {bookings && bookings.length > 0 && (
        <ul className="space-y-3" data-testid="booking-list">
          {bookings.map((b) => (
            <li
              key={b.ref}
              data-testid="booking-row"
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 p-4"
            >
              <div>
                <p className="font-semibold text-gray-900">
                  {b.ref} · {b.serviceName}
                </p>
                <p className="text-gray-800">
                  {formatDate(b.date)} at {b.time} · {b.hours} hours
                </p>
              </div>
              <button type="button" className={buttonSecondary} onClick={() => setPending(b)}>
                Cancel<span className="sr-only"> booking {b.ref}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {pending && (
        <CancelDialog
          booking={pending}
          busy={busy}
          onKeep={() => setPending(null)}
          onConfirm={confirmCancel}
        />
      )}
    </Page>
  );
}
