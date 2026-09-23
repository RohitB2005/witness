import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { priceLabel, type Service } from "../../shared/domain";
import { api } from "../api";
import { Alert, Loading, Page, buttonPrimary } from "../components/ui";
import { NotFoundPage } from "./NotFound";

export function ServiceDetailPage() {
  const { id = "" } = useParams();
  const [service, setService] = useState<Service | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "missing" | "error">("loading");

  useEffect(() => {
    setStatus("loading");
    api<{ service: Service }>(`/api/services/${encodeURIComponent(id)}`)
      .then((res) => {
        setService(res.service);
        setStatus("ok");
      })
      .catch((e: { status?: number }) => setStatus(e.status === 404 ? "missing" : "error"));
  }, [id]);

  if (status === "missing") return <NotFoundPage />;
  if (status === "error") {
    return (
      <Page title="Service">
        <Alert>Something went wrong. Please try again.</Alert>
      </Page>
    );
  }
  if (!service) return <Loading label="Loading service…" />;

  return (
    <Page title={service.name}>
      <div className="flex flex-col gap-6 sm:flex-row">
        <img
          src={service.image}
          alt={service.name}
          width={240}
          height={240}
          className="h-60 w-60 rounded-lg"
        />
        <div>
          <p className="mb-2 text-xl font-semibold text-gray-900" data-testid="service-price">
            {priceLabel(service)}
          </p>
          <p className="mb-6 text-gray-800">{service.description}</p>
          {service.soldOut ? (
            <div>
              <button
                type="button"
                disabled
                className={buttonPrimary}
                aria-describedby="sold-out-note"
              >
                Book this service
              </button>
              <p id="sold-out-note" className="mt-2 font-medium text-gray-800">
                {service.soldOutNote}
              </p>
            </div>
          ) : (
            <Link to={`/book?service=${service.id}`} className={buttonPrimary}>
              Book this service
            </Link>
          )}
          <p className="mt-6">
            <Link to="/services" className="underline">
              Back to all services
            </Link>
          </p>
        </div>
      </div>
    </Page>
  );
}
