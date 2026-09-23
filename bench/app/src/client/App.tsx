import { Route, Routes } from "react-router";
import { Layout } from "./components/Layout";
import { RequireAuth } from "./components/ui";
import { BookPage } from "./pages/Book";
import { BookConfirmationPage } from "./pages/BookConfirmation";
import { BookingsPage } from "./pages/Bookings";
import { ContactPage } from "./pages/Contact";
import { FaqPage } from "./pages/Faq";
import { HomePage } from "./pages/Home";
import { LoginPage, SignupPage } from "./pages/Auth";
import { NotFoundPage } from "./pages/NotFound";
import { ProfilePage } from "./pages/Profile";
import { QuotePage } from "./pages/Quote";
import { ServiceDetailPage } from "./pages/ServiceDetail";
import { ServicesPage } from "./pages/Services";
import { PrivacyPage, TermsPage } from "./pages/Legal";

export function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/services" element={<ServicesPage />} />
        <Route path="/services/:id" element={<ServiceDetailPage />} />
        <Route path="/quote" element={<QuotePage />} />
        <Route path="/book" element={<BookPage />} />
        <Route path="/book/confirmation" element={<BookConfirmationPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route
          path="/bookings"
          element={
            <RequireAuth>
              <BookingsPage />
            </RequireAuth>
          }
        />
        <Route
          path="/profile"
          element={
            <RequireAuth>
              <ProfilePage />
            </RequireAuth>
          }
        />
        <Route path="/faq" element={<FaqPage />} />
        <Route path="/contact" element={<ContactPage />} />
        <Route path="/terms" element={<TermsPage />} />
        <Route path="/privacy" element={<PrivacyPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Layout>
  );
}
