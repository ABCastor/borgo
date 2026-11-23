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
