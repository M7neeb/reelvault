/** Tells the Books shelf to read itself again (after a backup is restored). Pure. */

const listeners = new Set<() => void>();

export function onBooksChanged(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function booksChanged(): void {
  for (const fn of listeners) fn();
}
