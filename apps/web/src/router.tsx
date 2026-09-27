// A tiny history router: five pages don't need a routing library (CLAUDE.md: minimal dependencies).
import { useEffect, useState, type AnchorHTMLAttributes, type MouseEvent } from "react";

export function navigate(to: string): void {
  if (to === location.pathname + location.search) return;
  history.pushState(null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}

export function usePath(): string {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  return path;
}

export function Link({
  to,
  onClick,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return (
    <a
      href={to}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
        e.preventDefault();
        navigate(to);
      }}
      {...rest}
    />
  );
}
