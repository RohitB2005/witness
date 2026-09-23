import { useEffect } from "react";
import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { Navigate, useLocation } from "react-router";
import { useAuth } from "../auth";

export const buttonPrimary =
  "inline-flex items-center justify-center rounded-md bg-brand-700 px-4 py-2 font-semibold text-white hover:bg-brand-800 disabled:cursor-not-allowed disabled:bg-gray-300 disabled:text-gray-600";
export const buttonSecondary =
  "inline-flex items-center justify-center rounded-md border border-gray-400 bg-white px-4 py-2 font-semibold text-gray-800 hover:bg-gray-100";
const inputClass =
  "mt-1 block w-full rounded-md border border-gray-400 bg-white px-3 py-2 text-gray-900 aria-[invalid=true]:border-red-700";

export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = title === "" ? "Harbour Clean" : `${title} — Harbour Clean`;
  }, [title]);
}

export function Page({ title, children }: { title: string; children: ReactNode }) {
  usePageTitle(title);
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8">
      <h1 className="mb-6 text-3xl font-bold text-gray-900">{title}</h1>
      {children}
    </div>
  );
}

interface FieldShellProps {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string;
  children: ReactNode;
}

function FieldShell({ id, label, error, hint, children }: FieldShellProps) {
  return (
    <div className="mb-4">
      <label htmlFor={id} className="block font-medium text-gray-900">
        {label}
      </label>
      {hint && (
        <p id={`${id}-hint`} className="text-sm text-gray-600">
          {hint}
        </p>
      )}
      {children}
      {error && (
        <p id={`${id}-error`} className="mt-1 text-sm font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function describedBy(id: string, error?: string, hint?: string): string | undefined {
  const ids = [hint ? `${id}-hint` : "", error ? `${id}-error` : ""].filter(Boolean);
  return ids.length > 0 ? ids.join(" ") : undefined;
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  id: string;
  label: string;
  error?: string | undefined;
  hint?: string;
};

export function TextField({ id, label, error, hint, ...props }: InputProps) {
  return (
    <FieldShell id={id} label={label} error={error} hint={hint}>
      <input
        id={id}
        name={id}
        className={inputClass}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        {...props}
      />
    </FieldShell>
  );
}

type SelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  id: string;
  label: string;
  error?: string | undefined;
  children: ReactNode;
};

export function SelectField({ id, label, error, children, ...props }: SelectProps) {
  return (
    <FieldShell id={id} label={label} error={error}>
      <select
        id={id}
        name={id}
        className={inputClass}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error)}
        {...props}
      >
        {children}
      </select>
    </FieldShell>
  );
}

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  id: string;
  label: string;
  error?: string | undefined;
};

export function TextAreaField({ id, label, error, ...props }: TextAreaProps) {
  return (
    <FieldShell id={id} label={label} error={error}>
      <textarea
        id={id}
        name={id}
        rows={4}
        className={inputClass}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error)}
        {...props}
      />
    </FieldShell>
  );
}

export function Alert({ children }: { children: ReactNode }) {
  return (
    <div
      role="alert"
      className="mb-4 rounded-md border border-red-700 bg-red-50 px-4 py-3 text-red-800"
    >
      {children}
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <p role="status" className="text-gray-700">
      {label}
    </p>
  );
}

/** Pages that need an account send logged-out visitors to /login?next=… */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { loading, user } = useAuth();
  const location = useLocation();
  if (loading) return <Loading label="Loading…" />;
  if (!user)
    return <Navigate to={`/login?next=${encodeURIComponent(location.pathname)}`} replace />;
  return <>{children}</>;
}
