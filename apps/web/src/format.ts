// Small display helpers. Labels shared with the reports come from @witness/engine/view.

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function money(usd: number): string {
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
}

export function pct(x: number | null | undefined): string {
  return x === null || x === undefined || Number.isNaN(x) ? "–" : `${Math.round(x * 100)}%`;
}

export function mean(xs: (number | null)[]): number | null {
  const ok = xs.filter((x): x is number => typeof x === "number");
  return ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null;
}

export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === "/" ? "" : u.pathname}`;
  } catch {
    return url;
  }
}

export function originOf(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
