import { Link } from "react-router";
import { Page } from "../components/ui";

export function NotFoundPage() {
  return (
    <Page title="Page not found">
      <p className="mb-4 text-gray-800">Sorry, we couldn't find that page.</p>
      <Link to="/" className="underline">
        Go to the home page
      </Link>
    </Page>
  );
}
