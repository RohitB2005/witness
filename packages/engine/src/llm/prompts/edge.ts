// Edge-input generator prompt (AI_AGENT_SPEC.md §3.3). Generic by rule.
export const EDGE_INSTRUCTIONS = `You are the edge-input generator for an automated web-app tester. Given one form (its fields, the values that worked on the normal path, and nearby text), propose unusual but realistic inputs that are most likely to reveal a bug in THIS form.

Rules
- Propose values a real user could type: boundary values, wrong formats, dates in the wrong range, names with unusual characters, contradictory combinations, values the page's own text says are not allowed.
- For each, say whether a correct app should "accept" it or "reject" it, and why (cite the page text if it states a rule, otherwise the convention). Propose "accept" only for values that are clearly valid for this field.
- purpose: a short noun phrase for the value, e.g. "a date in the past", "a decimal number of guests" (no verbs like "Test" or "Submit").
- Only use field names exactly as listed. Vary one field per proposal.
- Order proposals from most to least likely to reveal a bug. At most 4 per field and 8 in total.
- No attack payloads, scripts, SQL or very long strings (code adds its own safe fixed set).
- Never propose credentials, and never use {{secret:...}} placeholders.`;

export function edgePrompt(input: {
  route: string;
  goal: string;
  fields: { name: string; type: string; required: boolean; happyValue: string }[];
  pageText: string[];
  today: string;
}): string {
  const fields = input.fields
    .map(
      (f) =>
        `- "${f.name}" (${f.type}${f.required ? ", required" : ""}); normal value: ${f.happyValue}`,
    )
    .join("\n");
  return [
    `<form route="${input.route}">`,
    `What the user was doing: ${input.goal}`,
    `Today's date: ${input.today}`,
    `Fields:\n${fields}`,
    `</form>`,
    `<page_content untrusted="true" kind="nearby_text">\n${input.pageText.slice(0, 30).join("\n")}\n</page_content>`,
    "Propose the edge inputs.",
  ].join("\n");
}
