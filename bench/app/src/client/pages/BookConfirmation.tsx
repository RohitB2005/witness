import { Link, useSearchParams } from "react-router";
import { useAuth } from "../auth";
import { Page } from "../components/ui";

export function BookConfirmationPage() {
  const [params] = useSearchParams();
  const ref = params.get("ref");
  const { user } = useAuth();
  return (
    <Page title="Booking confirmed">
      <p className="mb-4 text-lg text-gray-800">
        {ref ? (
          <>
            Thanks! Your reference is <strong data-testid="booking-ref">{ref}</strong>.
          </>
        ) : (
          "Thanks! Your booking is confirmed."
        )}
      </p>
      <p className="mb-6 text-gray-800">We've sent the details to your email.</p>
      <Link to={user ? "/bookings" : "/"} className="underline">
        {user ? "View my bookings" : "Back to the home page"}
      </Link>
    </Page>
  );
}
