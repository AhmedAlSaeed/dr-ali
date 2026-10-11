import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import type { CaseEntry } from "@/lib/deck";
import { cn } from "@/lib/utils";

/** Jump straight to any case without going back to the index. */
export function CaseMenu({
  cases,
  current,
  done,
  onPick,
  label,
  tone = "default",
}: {
  cases: CaseEntry[];
  current?: number;
  done: Record<number, boolean>;
  onPick: (n: number) => void;
  label: string;
  tone?: "default" | "slide";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const slideTone = tone === "slide";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm font-medium transition-colors",
          slideTone
            ? "border-current/20 bg-transparent hover:bg-current/10"
            : "bg-secondary text-secondary-foreground hover:bg-secondary/80",
        )}
      >
        {label}
        <ChevronDown className={cn("size-3.5 opacity-60 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div
          role="listbox"
          className="overlay-in bg-popover text-popover-foreground absolute left-0 top-full z-50 mt-1 max-h-[70vh] w-80 overflow-auto rounded-lg border p-1 shadow-xl"
        >
          {cases.map((c) => {
            const isDone = !!done[c.n];
            return (
              <button
                key={c.n}
                role="option"
                aria-selected={c.n === current}
                onClick={() => {
                  onPick(c.n);
                  setOpen(false);
                }}
                className={cn(
                  "hover:bg-accent flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm",
                  c.n === current && "bg-accent",
                )}
              >
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full border text-[11px] font-semibold tabular-nums",
                    isDone ? "border-brand bg-brand text-brand-foreground" : "text-muted-foreground",
                  )}
                >
                  {isDone ? <Check className="size-3" /> : c.n}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {isDone ? c.diagnosis : `Case ${c.n}`}
                </span>
                {isDone && <span className="text-muted-foreground text-xs">complete</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
