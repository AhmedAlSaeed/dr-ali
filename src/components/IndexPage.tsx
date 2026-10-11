import { ArrowRight, Check, RotateCcw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Disclosures } from "@/components/Disclosures";
import { Masthead } from "@/components/Masthead";
import type { Deck } from "@/lib/deck";
import { useProgress } from "@/lib/progress";
import { cn } from "@/lib/utils";

export function IndexPage({ deck }: { deck: Deck }) {
  const progress = useProgress();
  const total = deck.cases.length;
  const pct = (progress.count / total) * 100;
  const last = progress.last;
  const lastCase = last ? deck.cases.find((c) => c.n === last.caseN) : undefined;

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10 md:py-14">
      <Masthead conference={deck.conference} meta={`${total} cases`} />

      {/* progress only appears once there is some, and stays a single slim line */}
      {progress.count > 0 && (
        <div className="mt-6 flex items-center gap-3" data-progress-summary>
          <Progress value={pct} className="h-1.5 max-w-56 flex-1" />
          <span className="text-muted-foreground text-xs tabular-nums">
            {progress.count} of {total} complete
          </span>
          {lastCase && (
            <button
              type="button"
              onClick={() => (window.location.hash = `#/c/${lastCase.n}`)}
              className="text-brand text-xs font-medium underline-offset-4 hover:underline"
            >
              Resume case {lastCase.n}
            </button>
          )}
          <button
            type="button"
            aria-label="Reset progress"
            title="Reset progress"
            onClick={() => {
              if (confirm("Clear all completion marks?")) progress.reset();
            }}
            className="text-muted-foreground hover:text-foreground ml-auto transition-colors"
          >
            <RotateCcw className="size-3.5" />
          </button>
        </div>
      )}

      <div className="mt-10">
        <Disclosures
          coi={deck.conflictOfInterest}
          accreditation={deck.accreditation}
          providedBy={deck.conference?.providedBy}
        />
      </div>

      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {deck.cases.map((c) => {
          const done = !!progress.done[c.n];
          return (
            <Card
              key={c.n}
              data-case-card={c.n}
              role="button"
              tabIndex={0}
              onClick={() => (window.location.hash = `#/c/${c.n}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  window.location.hash = `#/c/${c.n}`;
                }
              }}
              className={cn(
                "group cursor-pointer gap-0 py-4 transition-colors hover:border-brand/60 hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                done && "border-brand/40 bg-brand/[0.04]",
              )}
            >
              <CardHeader className="flex-row items-center gap-3">
                <span
                  className={cn(
                    "flex size-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums",
                    done ? "border-brand bg-brand text-brand-foreground" : "text-muted-foreground",
                  )}
                >
                  {done ? <Check className="size-3.5" /> : c.n}
                </span>
                <CardTitle className="min-w-0 flex-1 text-sm leading-snug">
                  {/* number while the case is outstanding; the diagnosis is revealed once complete */}
                  <span className="line-clamp-2">{done ? c.diagnosis : `Case ${c.n}`}</span>
                </CardTitle>
                <ArrowRight className="text-muted-foreground size-4 shrink-0 transition-transform group-hover:translate-x-0.5" />
              </CardHeader>
              {done && c.companion && (
                <CardContent className="flex items-center pl-[3.25rem] pt-1">
                  <Badge variant="brand" className="font-normal">
                    + {c.companion}
                  </Badge>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      <footer className="text-muted-foreground mt-10 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <span>{deck.conference?.institution}</span>
        <span className="ml-auto">progress is kept on this device</span>
      </footer>
    </div>
  );
}
