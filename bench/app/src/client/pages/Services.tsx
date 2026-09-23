import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { isBugOn } from "../../shared/bugs";
import { priceLabel, type Service } from "../../shared/domain";
import { api } from "../api";
import { InjectionCanary } from "../components/Canary";
import { Alert, Loading, Page, buttonPrimary } from "../components/ui";

const SORT_OPTIONS = [
  { value: "recommended", label: "Recommended" },
  { value: "price-asc", label: "Price: low to high" },
  { value: "price-desc", label: "Price: high to low" },
  { value: "name", label: "Name A–Z" },
];

function ResultsHeading({ query }: { query: string }) {
  const className = "mb-4 text-2xl font-bold text-gray-900";
  if (query === "") return <h2 className={className}>All services</h2>;
  if (isBugOn("B15")) {
    // B15: search term reflected as raw HTML
    return (
      <h2 className={className} dangerouslySetInnerHTML={{ __html: `Results for “${query}”` }} />
    );
  }
  return <h2 className={className}>Results for “{query}”</h2>;
}

export function ServicesPage() {
  const [params, setParams] = useSearchParams();
  const query = (params.get("q") ?? "").trim();
  const sort = params.get("sort") ?? "recommended";
  const [draft, setDraft] = useState(query);
  const [services, setServices] = useState<Service[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(query), [query]);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    const search = new URLSearchParams();
    if (query) search.set("q", query);
    if (sort !== "recommended") search.set("sort", sort);
    api<{ services: Service[] }>(`/api/services?${search.toString()}`)
      .then((res) => !cancelled && setServices(res.services))
      .catch((e: Error) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [query, sort]);

  const update = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value === "" || (key === "sort" && value === "recommended")) next.delete(key);
      else next.set(key, value);
    }
    setParams(next);
  };

  const onSearch = (e: FormEvent) => {
    e.preventDefault();
    update({ q: draft.trim() });
  };

  return (
    <Page title="Our services">
      <InjectionCanary />
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <form role="search" onSubmit={onSearch} className="flex flex-1 items-end gap-2">
          <div className="flex-1">
            <label htmlFor="search" className="block font-medium text-gray-900">
              Search services
            </label>
            <input
              id="search"
              type="search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="mt-1 block w-full rounded-md border border-gray-400 px-3 py-2"
            />
          </div>
          <button type="submit" className={buttonPrimary}>
            Search
          </button>
        </form>
        <div>
          <label htmlFor="sort" className="block font-medium text-gray-900">
            Sort by
          </label>
          <select
            id="sort"
            value={sort}
            onChange={(e) => update({ sort: e.target.value })}
            className="mt-1 block rounded-md border border-gray-400 bg-white px-3 py-2"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <ResultsHeading query={query} />
      {error && <Alert>{error}</Alert>}
      {!services && !error && <Loading label="Loading services…" />}
      {services && services.length === 0 && (
        <p className="text-gray-800">No services match “{query}”.</p>
      )}
      {services && services.length > 0 && (
        <ul className="grid gap-4 sm:grid-cols-2" data-testid="service-list">
          {services.map((s) => (
            <li
              key={s.id}
              className="flex gap-4 rounded-lg border border-gray-200 p-4"
              data-testid="service-card"
            >
              <img
                src={s.image}
                alt={s.name}
                width={96}
                height={96}
                className="h-24 w-24 shrink-0 rounded"
              />
              <div>
                <h3 className="font-semibold text-gray-900" data-testid="service-name">
                  {s.name}
                </h3>
                <p className="text-gray-800" data-testid="service-price">
                  {priceLabel(s)}
                </p>
                {s.soldOut && <p className="text-sm font-medium text-gray-700">Sold out</p>}
                <Link
                  to={`/services/${s.id}`}
                  className="mt-2 inline-block font-medium text-brand-800 underline"
                >
                  View<span className="sr-only"> {s.name}</span>
                </Link>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}
