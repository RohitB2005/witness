// Stored locator → Playwright locator, and a plain-language description of a locator (step text).
import type { Locator as PwLocator, Page } from "playwright";
import type { Locator } from "./language";

type AriaRole = Parameters<Page["getByRole"]>[0];
type Root = Page | PwLocator;

export function toPlaywright(root: Root, loc: Locator): PwLocator {
  const scope: Root = loc.within ? toPlaywright(root, loc.within).first() : root;
  let out: PwLocator;
  switch (loc.by) {
    case "role":
      out = scope.getByRole(loc.role as AriaRole, {
        ...(loc.name !== undefined ? { name: loc.name } : {}),
        ...(loc.exact !== undefined ? { exact: loc.exact } : {}),
      });
      break;
    case "label":
      out = scope.getByLabel(loc.text, loc.exact !== undefined ? { exact: loc.exact } : {});
      break;
    case "placeholder":
      out = scope.getByPlaceholder(loc.text);
      break;
    case "testId":
      out = scope.getByTestId(loc.id);
      break;
    case "text":
      out = scope.getByText(loc.text, loc.exact !== undefined ? { exact: loc.exact } : {});
      break;
    case "css":
      out = scope.locator(loc.selector);
      break;
  }
  return loc.nth !== undefined ? out.nth(loc.nth) : out;
}

const ROLE_NOUN: Record<string, string> = {
  button: "button",
  link: "link",
  textbox: "field",
  searchbox: "search box",
  combobox: "dropdown",
  listbox: "list",
  option: "option",
  checkbox: "checkbox",
  radio: "option",
  spinbutton: "number field",
  switch: "switch",
  tab: "tab",
  menuitem: "menu item",
  heading: "heading",
  listitem: "list item",
  row: "row",
  cell: "cell",
  img: "image",
  dialog: "dialog",
  alert: "alert",
  status: "status message",
  region: "section",
  navigation: "navigation",
};

function ordinal(n: number): string {
  const k = n + 1;
  const suffix =
    k % 10 === 1 && k !== 11
      ? "st"
      : k % 10 === 2 && k !== 12
        ? "nd"
        : k % 10 === 3 && k !== 13
          ? "rd"
          : "th";
  return `${k}${suffix}`;
}

/** "the "Log in" button", "the "Email" field", "the 2nd list item in the "Results" list". */
export function describeLocator(loc: Locator): string {
  let s: string;
  switch (loc.by) {
    case "role": {
      const noun = ROLE_NOUN[loc.role] ?? loc.role;
      s = loc.name ? `the "${loc.name}" ${noun}` : `the ${noun}`;
      break;
    }
    case "label":
      s = `the "${loc.text}" field`;
      break;
    case "placeholder":
      s = `the field showing "${loc.text}"`;
      break;
    case "testId":
      s = `the element with test id "${loc.id}"`;
      break;
    case "text":
      s = `the text "${loc.text}"`;
      break;
    case "css":
      s = `the element at \`${loc.selector}\``;
      break;
  }
  if (loc.nth !== undefined) s = s.replace(/^the /, `the ${ordinal(loc.nth)} `);
  if (loc.within) s += ` in ${describeLocator(loc.within)}`;
  return s;
}
