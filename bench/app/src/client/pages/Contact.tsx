import { useState } from "react";
import type { FormEvent } from "react";
import { isBugOn } from "../../shared/bugs";
import { isValidEmail } from "../../shared/domain";
import { ApiError, api } from "../api";
import { Alert, Page, TextAreaField, TextField, buttonPrimary } from "../components/ui";

function SendIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
      <path d="M2 21l21-9L2 3v7l15 2-15 2z" />
    </svg>
  );
}

export function ContactPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string; message?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFailure(null);
    const next: typeof errors = {};
    if (name.trim() === "") next.name = "Please enter your name.";
    if (!isValidEmail(email.trim())) next.email = "Please enter a valid email address.";
    if (message.trim() === "") next.message = "Please enter a message.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      await api("/api/contact", { method: "POST", body: { name, email, message } });
      setSent(true);
    } catch (err) {
      if (err instanceof ApiError && err.field && err.status < 500)
        setErrors({ [err.field]: err.message });
      else setFailure((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const b12 = isBugOn("B12");

  return (
    <Page title="Contact us">
      {sent ? (
        <p role="status" className="text-lg text-gray-800">
          Thanks — we'll reply within one working day
        </p>
      ) : (
        <form noValidate onSubmit={onSubmit} className="max-w-md">
          {failure && <Alert>{failure}</Alert>}
          <TextField
            id="name"
            label="Name"
            autoComplete="name"
            value={name}
            error={errors.name}
            onChange={(e) => setName(e.target.value)}
          />
          {b12 ? (
            // B12: the visible "Email" text is not associated with the input
            <div className="mb-4">
              <div className="font-medium text-gray-900">Email</div>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full rounded-md border border-gray-400 px-3 py-2"
              />
              {errors.email && (
                <p className="mt-1 text-sm font-medium text-red-700">{errors.email}</p>
              )}
            </div>
          ) : (
            <TextField
              id="email"
              label="Email"
              type="email"
              autoComplete="email"
              value={email}
              error={errors.email}
              onChange={(e) => setEmail(e.target.value)}
            />
          )}
          <TextAreaField
            id="message"
            label="Message"
            value={message}
            error={errors.message}
            onChange={(e) => setMessage(e.target.value)}
          />
          <button type="submit" className={`${buttonPrimary} gap-2`} disabled={busy}>
            <SendIcon />
            {/* B12: icon-only button with no accessible name */}
            {!b12 && "Send"}
          </button>
        </form>
      )}
    </Page>
  );
}
