// A tiny templating helper: interpolations are escaped unless wrapped in raw(). Views return strings;
// main.ts places them and handles events by delegation (data-act attributes).

export class Raw {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
}

export const raw = (s: string) => new Raw(s);

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => ESC[c]!);

function piece(v: unknown): string {
  if (v === null || v === undefined || v === false) return "";
  if (v instanceof Raw) return v.value;
  if (Array.isArray(v)) return v.map(piece).join("");
  return esc(v);
}

export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let out = strings[0]!;
  values.forEach((v, i) => (out += piece(v) + strings[i + 1]!));
  return new Raw(out);
}
