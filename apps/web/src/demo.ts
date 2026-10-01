// New scan's demo settings (`pnpm demo:up` only, DEMO_RUNBOOK §4). The browser never holds the demo
// password: with the demo account chosen, the form sends `useDemoAccount` and the server fills it in.
import type { DemoSettings, NewScanBody } from "./api";

export interface DemoForm {
  url: string;
  mode: NewScanBody["mode"];
  budget: NewScanBody["budget"];
  username: string;
  demoAccount: boolean;
  requirements: string;
  reqFile?: string;
}

export function demoForm(d: DemoSettings): DemoForm {
  return {
    url: d.url,
    mode: d.mode,
    budget: d.budget,
    username: d.account?.username ?? "",
    demoAccount: !!d.account,
    requirements: d.requirements?.text ?? "",
    reqFile: d.requirements?.file,
  };
}

/** The account part of the scan request. */
export function accountFields(
  username: string,
  password: string,
  demoAccount: boolean,
): Pick<NewScanBody, "username" | "password" | "useDemoAccount"> {
  if (demoAccount) return { useDemoAccount: true };
  return username.trim() ? { username: username.trim(), password } : {};
}
