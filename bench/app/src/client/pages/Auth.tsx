import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { isValidEmail } from "../../shared/domain";
import { ApiError } from "../api";
import { useAuth } from "../auth";
import { Alert, Page, TextField, buttonPrimary } from "../components/ui";

/** Only same-site paths are allowed as a post-login destination. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export function LoginPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (email.trim() === "" || password === "") {
      setError("Enter your email and password.");
      return;
    }
    setBusy(true);
    try {
      await login(email.trim(), password);
      navigate(safeNext(params.get("next")));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Log in">
      <form noValidate onSubmit={onSubmit} className="max-w-sm">
        {error && <Alert>{error}</Alert>}
        <TextField
          id="email"
          label="Email"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          id="password"
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" className={buttonPrimary} disabled={busy}>
          Log in
        </button>
      </form>
      <p className="mt-6 text-gray-800">
        New to Harbour Clean?{" "}
        <Link to="/signup" className="underline">
          Create an account
        </Link>
      </p>
    </Page>
  );
}

export function SignupPage() {
  const navigate = useNavigate();
  const { signup } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{ name?: string; email?: string; password?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFailure(null);
    const next: typeof errors = {};
    if (name.trim() === "") next.name = "Please enter your full name.";
    if (!isValidEmail(email.trim())) next.email = "Please enter a valid email address.";
    if (password.length < 8) next.password = "Password must be at least 8 characters.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      await signup(name.trim(), email.trim(), password);
      navigate("/");
    } catch (err) {
      if (err instanceof ApiError && err.field && err.status < 500)
        setErrors({ [err.field]: err.message });
      else setFailure((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Create an account">
      <form noValidate onSubmit={onSubmit} className="max-w-sm">
        {failure && <Alert>{failure}</Alert>}
        <TextField
          id="name"
          label="Full name"
          autoComplete="name"
          value={name}
          error={errors.name}
          onChange={(e) => setName(e.target.value)}
        />
        <TextField
          id="email"
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          error={errors.email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <TextField
          id="password"
          label="Password"
          type="password"
          autoComplete="new-password"
          hint="At least 8 characters."
          value={password}
          error={errors.password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button type="submit" className={buttonPrimary} disabled={busy}>
          Create account
        </button>
      </form>
      <p className="mt-6 text-gray-800">
        Already have an account?{" "}
        <Link to="/login" className="underline">
          Log in
        </Link>
      </p>
    </Page>
  );
}
