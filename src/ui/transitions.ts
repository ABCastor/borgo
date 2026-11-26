export function transitionView(update: () => void, host: Pick<Document, 'startViewTransition'> = document, reduced = matchMedia('(prefers-reduced-motion: reduce)').matches): void {
  if (reduced || !host.startViewTransition) update();
  else {
    const transition = host.startViewTransition(update);
    // Rapid navigation may skip a snapshot; the update still runs.
    void transition?.ready.catch(() => {});
    void transition?.finished.catch(() => {});
  }
}

/** Native disclosure keyboard handling, with a plain, labelled button face. */
export function enhanceDisclosures(root: ParentNode = document): void {
  root.querySelectorAll('details > summary').forEach(summary => {
    summary.setAttribute('role', 'button');
    summary.setAttribute('aria-expanded', String((summary.parentElement as HTMLDetailsElement).open));
  });
}

/** The cards' reorder motion, shared by every list that slides to a new order. */
export const FLIP: KeyframeAnimationOptions = { duration: 420, easing: "cubic-bezier(.45,0,.55,1)" };

/**
 * Runs `update`, then slides each `[data-flip-row]` that changed place in its list's order from where it was to where it
 * is now (First, Last, Invert, Play). Positions are taken inside each row's own list, and a row whose place in the order
 * is the same does not move: a row opening above it pushes it down at once, as any page does.
 */
export function flipRows(update: () => void, root: ParentNode = document, reduced = matchMedia("(prefers-reduced-motion: reduce)").matches): void {
  if (reduced) return update();
  const at = (el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const p = el.parentElement!.getBoundingClientRect();
    return { x: r.left - p.left, y: r.top - p.top };
  };
  const first = new Map<string, { x: number; y: number; i: number }>();
  root.querySelectorAll<HTMLElement>("[data-flip-row]").forEach((el, i) => first.set(el.dataset.flipRow!, { ...at(el), i }));
  update();
  const after = [...root.querySelectorAll<HTMLElement>("[data-flip-row]")];
  // Its place among the rows both before and after share: a row added or taken away elsewhere moves the rest only if it was above them.
  const kept = after.filter((el) => first.has(el.dataset.flipRow!));
  const before = [...first.entries()].filter(([k]) => kept.some((el) => el.dataset.flipRow === k)).sort((x, y) => x[1].i - y[1].i).map(([k]) => k);
  for (const el of after) {
    const a = first.get(el.dataset.flipRow!);
    if (!a) continue;
    const moved = before.indexOf(el.dataset.flipRow!) !== kept.indexOf(el) || a.i !== after.indexOf(el);
    if (!moved) continue;
    const b = at(el);
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
    el.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], FLIP);
  }
}
