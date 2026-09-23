// In-memory secret vault (SECURITY.md T5). Secrets live only here; everything else sees
// `{{secret:name}}` placeholders, and every write to disk is passed through `redact`.

const PLACEHOLDER = /\{\{secret:([a-zA-Z0-9_-]+)\}\}/g;
const REDACTED = "[redacted]";

export class SecretVault {
  readonly #secrets = new Map<string, string>();

  set(name: string, value: string): void {
    if (!value) throw new Error(`Secret "${name}" is empty`);
    this.#secrets.set(name, value);
  }

  has(name: string): boolean {
    return this.#secrets.has(name);
  }

  /** Resolves one secret by name; throws on unknown names so a typo never types the placeholder literally. */
  get(name: string): string {
    const value = this.#secrets.get(name);
    if (value === undefined) throw new Error(`Unknown secret "${name}"`);
    return value;
  }

  /** Replaces every `{{secret:name}}` in `text` with its value. Used only at the moment of typing. */
  resolve(text: string): string {
    return text.replace(PLACEHOLDER, (_m, name: string) => this.get(name));
  }

  /** True if any secret value appears in `text`. */
  leaks(text: string): boolean {
    for (const value of this.#secrets.values()) if (text.includes(value)) return true;
    return false;
  }

  /** Replaces every secret value (and its URL-encoded form) in `text`. */
  redact(text: string): string {
    let out = text;
    for (const value of this.#secrets.values()) {
      out = out.split(value).join(REDACTED);
      const encoded = encodeURIComponent(value);
      if (encoded !== value) out = out.split(encoded).join(REDACTED);
    }
    return out;
  }
}
