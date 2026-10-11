import { useCallback, useEffect, useState } from "react";

const KEY = "alifellow.progress.v1";

export type Progress = {
  /** case number -> completed */
  done: Record<number, boolean>;
  /** where the presenter left off */
  last?: { caseN: number; index: number };
};

const empty: Progress = { done: {} };

function read(): Progress {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Progress;
    return { done: parsed.done ?? {}, last: parsed.last };
  } catch {
    return empty;
  }
}

/** Completion state, persisted so a session can be resumed. A case is marked done either
 *  automatically (reaching its last slide) or by hand. */
export function useProgress() {
  const [state, setState] = useState<Progress>(() => read());

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setState(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const save = useCallback((next: Progress) => {
    setState(next);
    localStorage.setItem(KEY, JSON.stringify(next));
  }, []);

  const setDone = useCallback(
    (n: number, done: boolean) =>
      save({ ...read(), done: { ...read().done, [n]: done } }),
    [save],
  );

  const toggle = useCallback(
    (n: number) => setDone(n, !read().done[n]),
    [setDone],
  );

  const setLast = useCallback(
    (caseN: number, index: number) => save({ ...read(), last: { caseN, index } }),
    [save],
  );

  const reset = useCallback(() => save(empty), [save]);

  const count = Object.values(state.done).filter(Boolean).length;
  return { ...state, count, setDone, toggle, setLast, reset };
}
