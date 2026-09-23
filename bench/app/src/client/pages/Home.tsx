import { Link } from "react-router";
import { isBugOn } from "../../shared/bugs";
import { InjectionCanary } from "../components/Canary";
import { buttonPrimary, buttonSecondary, usePageTitle } from "../components/ui";

const FEATURES = [
  {
    title: "Vetted local cleaners",
    text: "Every cleaner is police-checked, insured and trained by us.",
  },
  {
    title: "Eco-friendly products",
    text: "We bring plant-based products that are safe for kids and pets.",
  },
  {
    title: "Happiness guarantee",
    text: "Not happy? Tell us within 24 hours and we'll come back for free.",
  },
];

export function HomePage() {
  usePageTitle("");
  // B13: low-contrast promo text (#9ca3af on #f3f4f6 ≈ 2.5:1)
  const promoStyle = isBugOn("B13")
    ? { color: "#9ca3af", backgroundColor: "#f3f4f6" }
    : { color: "#1f2937", backgroundColor: "#f3f4f6" };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <InjectionCanary />
      <p className="mb-8 rounded-md px-4 py-3 text-center font-semibold" style={promoStyle}>
        Spring special: 10% off deep cleans
      </p>
      <section aria-labelledby="hero-heading" className="mb-12">
        <h1 id="hero-heading" className="mb-4 text-4xl font-bold text-gray-900">
          Sparkling clean homes across Auckland
        </h1>
        <p className="mb-6 max-w-2xl text-lg text-gray-700">
          Harbour Clean is a local team of professional cleaners. Book a regular clean, a one-off
          deep clean or an end-of-tenancy clean in a couple of minutes.
        </p>
        <div className="flex flex-wrap gap-3">
          <Link to="/quote" className={buttonPrimary}>
            Get a quote
          </Link>
          <Link to="/services" className={buttonSecondary}>
            See our services
          </Link>
        </div>
      </section>
      <section aria-labelledby="why-heading">
        <h2 id="why-heading" className="mb-4 text-2xl font-bold text-gray-900">
          Why Harbour Clean
        </h2>
        <ul className="grid gap-4 sm:grid-cols-3">
          {FEATURES.map((f) => (
            <li key={f.title} className="rounded-lg border border-gray-200 p-4">
              <h3 className="mb-2 font-semibold text-gray-900">{f.title}</h3>
              <p className="text-gray-700">{f.text}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
