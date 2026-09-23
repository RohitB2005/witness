import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ApiError, api } from "../api";
import { useAuth } from "../auth";
import { Alert, Loading, Page, TextField, buttonPrimary } from "../components/ui";

interface Profile {
  name: string;
  email: string;
  phone: string;
}

export function ProfilePage() {
  const { setUser } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<{ name?: string; phone?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ profile: Profile }>("/api/profile")
      .then((res) => {
        setProfile(res.profile);
        setName(res.profile.name);
        setPhone(res.profile.phone);
      })
      .catch((e: Error) => setFailure(e.message));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setFailure(null);
    setToast(null);
    const next: typeof errors = {};
    if (name.trim() === "") next.name = "Please enter your full name.";
    if (phone.trim() === "") next.phone = "Please enter a phone number.";
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setBusy(true);
    try {
      const res = await api<{ profile: Profile }>("/api/profile", {
        method: "PUT",
        body: { name, phone },
      });
      setProfile(res.profile);
      setUser(res.profile);
      setToast("Profile saved");
    } catch (err) {
      if (err instanceof ApiError && err.field && err.status < 500)
        setErrors({ [err.field]: err.message });
      else setFailure((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Your profile">
      {failure && <Alert>{failure}</Alert>}
      {!profile && !failure && <Loading label="Loading your profile…" />}
      {profile && (
        <form noValidate onSubmit={onSubmit} className="max-w-sm">
          <p className="mb-4 text-gray-800">
            Signed in as <strong>{profile.email}</strong>
          </p>
          <TextField
            id="name"
            label="Full name"
            autoComplete="name"
            value={name}
            error={errors.name}
            onChange={(e) => setName(e.target.value)}
          />
          <TextField
            id="phone"
            label="Phone"
            type="tel"
            autoComplete="tel"
            value={phone}
            error={errors.phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <button type="submit" className={buttonPrimary} disabled={busy}>
            Save
          </button>
        </form>
      )}
      <div role="status" className="mt-4">
        {toast && (
          <p className="inline-block rounded-md bg-brand-800 px-4 py-2 font-medium text-white">
            {toast}
          </p>
        )}
      </div>
    </Page>
  );
}
