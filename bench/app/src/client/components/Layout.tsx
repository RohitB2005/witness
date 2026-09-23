import type { ReactNode } from "react";
import { Link, NavLink, useNavigate } from "react-router";
import { isBugOn } from "../../shared/bugs";
import { useAuth } from "../auth";

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  `rounded px-2 py-1 font-medium hover:bg-brand-50 ${isActive ? "text-brand-900 underline underline-offset-4" : "text-gray-800"}`;

function Header() {
  const { user, bookingCount, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <header className="border-b border-gray-200 bg-white">
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-2 px-4 py-3">
        <Link to="/" className="text-xl font-bold text-brand-800">
          Harbour Clean
        </Link>
        <nav aria-label="Main">
          <ul className="flex flex-wrap items-center gap-1">
            <li>
              <NavLink to="/services" className={navLinkClass}>
                Services
              </NavLink>
            </li>
            <li>
              <NavLink to="/quote" className={navLinkClass}>
                Quote
              </NavLink>
            </li>
            <li>
              <NavLink to="/book" end className={navLinkClass}>
                Book
              </NavLink>
            </li>
            <li className="flex items-center">
              <NavLink to="/bookings" className={navLinkClass}>
                My bookings
              </NavLink>
              {user && (
                <span
                  data-testid="bookings-badge"
                  className="ml-0.5 rounded-full bg-brand-700 px-2 text-sm font-semibold text-white"
                >
                  <span className="sr-only">Upcoming bookings: </span>
                  {bookingCount}
                </span>
              )}
            </li>
            <li>
              <NavLink to="/faq" className={navLinkClass}>
                FAQ
              </NavLink>
            </li>
            <li>
              <NavLink to="/contact" className={navLinkClass}>
                Contact
              </NavLink>
            </li>
            {user ? (
              <>
                <li>
                  <NavLink to="/profile" className={navLinkClass}>
                    Profile
                  </NavLink>
                </li>
                <li>
                  <button
                    type="button"
                    className="rounded px-2 py-1 font-medium text-gray-800 hover:bg-brand-50"
                    onClick={async () => {
                      await logout();
                      navigate("/");
                    }}
                  >
                    Log out
                  </button>
                </li>
              </>
            ) : (
              <li>
                <NavLink to="/login" className={navLinkClass}>
                  Log in
                </NavLink>
              </li>
            )}
          </ul>
        </nav>
      </div>
    </header>
  );
}

function Footer() {
  // B10: the Terms link points at a route that doesn't exist
  const termsHref = isBugOn("B10") ? "/terms-and-conditions" : "/terms";
  return (
    <footer className="mt-12 border-t border-gray-200 bg-gray-50">
      <div className="mx-auto flex w-full max-w-4xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-gray-700">
        <p>© 2026 Harbour Clean Ltd, Auckland</p>
        <nav aria-label="Footer">
          <ul className="flex gap-4">
            <li>
              <Link to={termsHref} className="underline">
                Terms
              </Link>
            </li>
            <li>
              <Link to="/privacy" className="underline">
                Privacy
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:rounded focus:bg-white focus:px-3 focus:py-2"
      >
        Skip to main content
      </a>
      <Header />
      <main id="main" className="flex-1">
        {children}
      </main>
      <Footer />
    </div>
  );
}
