// Report notes (P3, D44): short plain-language facts for the top of the report. Today: page text aimed at
// AI or automated tools (a prompt-injection attempt). Witness never acts on it — page content is untrusted
// data in every prompt (CLAUDE.md rule 7) and verdicts come from checks and replays — but a tester should
// see that it was there and was ignored, rather than have it skipped silently. Found by code, not by an LLM.
import { pageText } from "../verify/facts";

/** Words that address an automated reader… */
const ADDRESSED =
  /\b(to|for|attention|dear|hey|hello|if you are an?|note to|message to)\b[^.!?]{0,40}\b(ai|a\.i\.|automated|llms?|language models?|agents?|assistants?|bots?|crawlers?|scanners?|testing tools?|testers?)\b/i;
/** …and tell it what to do. */
const INSTRUCTS =
  /\b(ignore|disregard|do not|don't|stop|end your|skip|report no|must not|pretend|forget|override|instead)\b/i;

export function injectionAttempts(
  pages: { route: string; snapshot: string }[],
): { route: string; quote: string }[] {
  const out: { route: string; quote: string }[] = [];
  const seen = new Set<string>();
  for (const p of pages) {
    for (const line of pageText(p.snapshot, 400)) {
      const text = line.replace(/^[a-z]+: /, "");
      if (!ADDRESSED.test(text) || !INSTRUCTS.test(text)) continue;
      const quote = text.length > 220 ? `${text.slice(0, 219)}…` : text;
      if (seen.has(quote)) continue;
      seen.add(quote);
      out.push({ route: p.route, quote });
    }
  }
  return out;
}

export function injectionNotes(pages: { route: string; snapshot: string }[]): string[] {
  return injectionAttempts(pages)
    .slice(0, 3)
    .map(
      (a) =>
        `Page text on ${a.route} is addressed to AI or automated tools, and Witness ignored it (it can't change any finding or verdict): "${a.quote}"`,
    );
}
