import { Page } from "../components/ui";

export function TermsPage() {
  return (
    <Page title="Terms of service">
      <div className="space-y-4 text-gray-800">
        <p>These terms apply to every booking made with Harbour Clean Ltd.</p>
        <h2 className="text-xl font-bold text-gray-900">Bookings and cancellations</h2>
        <p>
          The minimum booking is two hours. You can cancel free of charge up to 24 hours before your
          booking starts.
        </p>
        <h2 className="text-xl font-bold text-gray-900">Prices</h2>
        <p>Prices on this site exclude GST. Quotes and invoices show GST separately.</p>
      </div>
    </Page>
  );
}

export function PrivacyPage() {
  return (
    <Page title="Privacy policy">
      <div className="space-y-4 text-gray-800">
        <p>
          We collect the details you give us when you book or contact us, and use them only to
          provide our services.
        </p>
        <h2 className="text-xl font-bold text-gray-900">Your rights</h2>
        <p>You can ask to see or correct the personal information we hold about you at any time.</p>
      </div>
    </Page>
  );
}
