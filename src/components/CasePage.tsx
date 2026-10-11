import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  House,
  Info,
  ListChecks,
  Maximize2,
  Minimize2,
  Undo2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { CaseMenu } from "@/components/CaseMenu";
import { Lightbox } from "@/components/Lightbox";
import { SlideView, slideTheme } from "@/components/SlideView";
import { Stage } from "@/components/Stage";
import { stepsInSlide, type CaseEntry, type Deck, type Picture } from "@/lib/deck";
import { useProgress } from "@/lib/progress";
import { cn } from "@/lib/utils";

export function CasePage({
  deck,
  cases,
  positions,
  label,
  caseN,
  onExit,
  nextHref,
  prevHref,
}: {
  deck: Deck;
  cases: CaseEntry[];
  positions: number[];
  label: string;
  caseN?: number;
  onExit: () => void;
  nextHref?: string | null;
  prevHref?: string | null;
}) {
  const progress = useProgress();
  const [index, setIndex] = useState(0);
  const [step, setStep] = useState(0);
  const [zoom, setZoom] = useState<Picture | null>(null);
  const [showNotes, setShowNotes] = useState(false);
  // Already fullscreen (a case was just finished, or the page is being presented)? Then a case
  // opens straight into the present overlay instead of the inline view — the fullscreen stays put.
  const [present, setPresent] = useState(
    () => typeof document !== "undefined" && !!document.fullscreenElement,
  );
  const presentRef = useRef<HTMLDivElement>(null);

  const slide = useMemo(
    () => deck.slides.find((s) => s.pos === positions[Math.min(index, positions.length - 1)])!,
    [deck, positions, index],
  );
  const steps = stepsInSlide(slide);
  const atEnd = index === positions.length - 1 && step >= steps;
  const done = caseN ? !!progress.done[caseN] : false;
  const theme = slideTheme(slide);
  const hairline = theme.light ? "rgba(15,23,42,0.14)" : "rgba(255,255,255,0.16)";
  const entry = caseN ? cases.find((c) => c.n === caseN) : undefined;

  const next = useCallback(() => {
    if (step < steps) setStep(step + 1);
    else if (index < positions.length - 1) {
      setIndex(index + 1);
      setStep(0);
    }
  }, [step, steps, index, positions.length]);

  const prev = useCallback(() => {
    if (step > 0) setStep(step - 1);
    else if (index > 0) {
      const target = positions[index - 1];
      const s = deck.slides.find((x) => x.pos === target)!;
      setIndex(index - 1);
      setStep(stepsInSlide(s));
    }
  }, [step, index, positions, deck]);

  // The single forward action used by the button, by tapping the slide and by swiping: advance
  // while the case has slides left, then finish the case by returning to the main page — a case
  // never runs into the next one on its own (`n` is the deliberate way to keep going).
  // Presentation is left alone: the index simply appears inside fullscreen, ready for the next
  // case to be picked.
  const forwardLabel = atEnd ? "Back to index" : "Next";
  const forward = useCallback(() => {
    if (!atEnd) next();
    else onExit();
  }, [atEnd, next, onExit]);

  const goTo = useCallback((i: number) => {
    setIndex(i);
    setStep(0);
  }, []);

  const pickCase = useCallback((n: number) => {
    window.location.hash = `#/c/${n}`;
  }, []);

  // ---- swipe (touch) and click-to-advance -----------------------------------
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const suppressClick = useRef(false);
  const markSuppressed = () => {
    suppressClick.current = true;
    window.setTimeout(() => (suppressClick.current = false), 400);
  };
  const consumed = () => {
    if (!suppressClick.current) return false;
    suppressClick.current = false;
    return true;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse") return;
    swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const start = swipe.current;
    swipe.current = null;
    if (!start || e.pointerType === "mouse") return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    // horizontal only, so a vertical drag still scrolls the page
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    markSuppressed();
    if (dx < 0) forward();      // swiping past the last slide continues to the next case
    else prev();
  };
  const tapToAdvance = () => {
    if (consumed()) return;
    forward();
  };
  const openImage = (picture: Picture) => {
    if (consumed()) return;           // the tap that ended a swipe must not also zoom
    setZoom(picture);
  };

  // ---- fullscreen -----------------------------------------------------------
  // The present layout does not exist until React commits, so the fullscreen request has to
  // wait for the ref — calling it straight from the click handler was a no-op.
  // Fullscreen the document itself, synchronously from the click/keypress that asked for it:
  // the request needs the user gesture, and <html> never unmounts, so presentation continues when
  // moving between cases. Where the API is missing (iOS Safari) the overlay alone fills the
  // viewport. The overlay is deliberately not the fullscreen element.
  const enterPresent = useCallback(() => {
    setPresent(true);
    const el = document.documentElement;
    const canFullscreen =
      typeof el.requestFullscreen === "function" && document.fullscreenEnabled === true;
    if (canFullscreen && !document.fullscreenElement) {
      el.requestFullscreen().catch(() => {
        /* refused (policy / no gesture): the overlay still covers the viewport */
      });
    }
  }, []);

  // keep the page behind from scrolling under the overlay on touch devices
  useEffect(() => {
    if (!present) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [present]);

  const exitPresent = useCallback(async () => {
    setPresent(false);
    if (document.fullscreenElement && typeof document.exitFullscreen === "function") {
      await document.exitFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setPresent(false); // left fullscreen (Esc / F11)
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // Moving to another case restarts at its first slide. Done with state rather than a React key,
  // because remounting would destroy the fullscreen element and drop out of presentation.
  useEffect(() => {
    setIndex(0);
    setStep(0);
    setZoom(null);
  }, [caseN]);

  // ---- remember position, auto-complete on the last slide --------------------
  useEffect(() => {
    if (caseN) progress.setLast(caseN, index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseN, index]);

  // "the case's last slide is on screen" is the completion rule - whether or not that slide
  // has a click-to-reveal step (the deck's own last slides do not)
  useEffect(() => {
    if (caseN && index === positions.length - 1) progress.setDone(caseN, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseN, index, positions.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "ArrowRight":
        case "ArrowDown":
        case "PageDown":
        case " ":
        case "Enter":
          e.preventDefault();
          forward();
          break;
        case "ArrowLeft":
        case "ArrowUp":
        case "PageUp":
        case "Backspace":
          e.preventDefault();
          prev();
          break;
        case "Escape":
        case "Home":
          e.preventDefault();
          // in present mode Esc leaves fullscreen first, a second press goes to the index
          if (present) exitPresent();
          else onExit();
          break;
        case "n":
          if (nextHref) window.location.hash = nextHref;
          break;
        case "p":
          if (prevHref) window.location.hash = prevHref;
          break;
        case "f":
          if (present) exitPresent();
          else enterPresent();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [forward, prev, onExit, nextHref, prevHref, present, enterPresent, exitPresent]);

  const stepDots = steps > 0 && (
    <span className="flex items-center gap-1">
      {Array.from({ length: steps + 1 }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "size-1.5 rounded-full transition-colors",
            i <= step ? "bg-brand" : present ? "bg-current/25" : "bg-muted-foreground/30",
          )}
        />
      ))}
    </span>
  );

  /** Progress pills: one per slide in the case, filled up to where you are; click to jump.
   *  The inline view puts them below the slide, present mode in the header so the presenter
   *  can see at a glance how far into the case they are. */
  const slidePills = (tone: "page" | "slide") => (
    <div className="flex flex-wrap items-center gap-1.5" data-slide-pills>
      {positions.map((p, i) => (
        <button
          key={p}
          data-slide-nav={i}
          data-pill={i}
          data-filled={i <= index}
          aria-label={`Go to position ${i + 1}`}
          title={`Slide ${i + 1}`}
          onClick={() => goTo(i)}
          className={cn(
            "h-2 w-7 rounded-full transition-colors",
            i === index
              ? "bg-brand"
              : i < index
                ? "bg-brand/45 hover:bg-brand/70"
                : tone === "slide"
                  ? "bg-current/20 hover:bg-current/40"
                  : "bg-muted-foreground/20 hover:bg-muted-foreground/40",
          )}
        />
      ))}
    </div>
  );

  // ============================ present mode ================================
  if (present) {
    return (
      <div
        ref={presentRef}
        data-slide-index={index}
        className="fixed inset-0 z-50 flex h-screen w-screen flex-col"
        style={{
          background: theme.background,
          color: theme.foreground,
          // dvh where supported so mobile browser chrome doesn't clip the slide; the class
          // above stays as the fallback when the value is unsupported
          height: "100dvh",
        }}
      >
        <header
          className="flex shrink-0 items-center gap-3 border-b px-3 py-2"
          style={{ borderColor: hairline, background: theme.background }}
        >
          <CaseMenu
            cases={cases}
            current={caseN}
            done={progress.done}
            onPick={pickCase}
            label={label}
            tone="slide"
          />

          {caseN && done && (
            <span className="text-xs opacity-60">{entry?.diagnosis}</span>
          )}
          <span className="ml-auto flex min-w-0 items-center gap-3 text-xs opacity-70">
            {slidePills("slide")}
            {stepDots}
          </span>
          <button
            type="button"
            onClick={prev}
            disabled={index === 0 && step === 0}
            aria-label="Previous slide"
            className="rounded-md p-1.5 transition-colors hover:bg-current/10 disabled:opacity-30"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            onClick={forward}
            aria-label={forwardLabel}
            data-forward
            className="rounded-md p-1.5 transition-colors hover:bg-current/10"
          >
            {!atEnd ? <ChevronRight className="size-4" /> : <House className="size-4" />}
          </button>
          <button
            type="button"
            onClick={exitPresent}
            title="Exit presentation (esc or f)"
            aria-label="Exit presentation"
            className="rounded-md p-1.5 transition-colors hover:bg-current/10"
          >
            <Minimize2 className="size-4" />
          </button>
        </header>

        <div
          className="min-h-0 flex-1 touch-pan-y"
          onClick={tapToAdvance}
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
          onKeyDown={(e) => e.key === "Enter" && tapToAdvance()}
        >
          <Stage fit="contain">
            <SlideView slide={slide} step={step} onImageClick={openImage} />
          </Stage>
        </div>

        <Lightbox picture={zoom} onClose={() => setZoom(null)} />
      </div>
    );
  }

  // ============================== inline view ===============================
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 md:px-6 md:py-8">
      <header className="flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={onExit}
          aria-label="Back to index"
          title="Back to index (esc)"
          data-back-to-index
        >
          <House className="size-4" />
        </Button>
        <Separator orientation="vertical" className="h-5" />
        <CaseMenu
          cases={cases}
          current={caseN}
          done={progress.done}
          onPick={pickCase}
          label={label}
        />
        {caseN && done && (
          <span className="text-muted-foreground hidden min-w-0 truncate text-xs sm:inline">
            {cases.find((c) => c.n === caseN)?.diagnosis}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={prev}
            disabled={index === 0 && step === 0}
            aria-label="Previous slide"
            data-back
          >
            <ChevronLeft className="size-4" />
          </Button>
          {/* arrows only: a single chevron advances, the home icon appears once the case is
              finished and takes you back to the main page */}
          <Button variant="outline" size="icon" onClick={forward} data-forward aria-label={forwardLabel}>
            {!atEnd ? <ChevronRight className="size-4" /> : <House className="size-4" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Present"
            title="Present (f) — true fullscreen"
            onClick={enterPresent}
          >
            <Maximize2 className="size-4" />
          </Button>
        </div>
      </header>

      <div
        role="button"
        tabIndex={0}
        aria-label="Next"
        onClick={tapToAdvance}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") tapToAdvance();
        }}
        className="cursor-pointer touch-pan-y focus-visible:outline-none"
      >
        <Stage>
          <SlideView slide={slide} step={step} onImageClick={openImage} />
        </Stage>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="text-muted-foreground flex items-center gap-3 text-xs">{stepDots}</div>

        {slide.notes && (
          <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setShowNotes(!showNotes)}>
            <Info className="size-4" /> Notes
          </Button>
        )}

        {/* progress as pills: one per slide, filled up to where you are. click to jump */}
        <div className="ml-auto flex flex-wrap items-center gap-1.5 text-xs" data-slide-index={index}>
          {slidePills("page")}
        </div>
      </div>

      {showNotes && slide.notes && (
        <Card>
          <CardHeader>
            <CardTitle className="text-muted-foreground flex items-center gap-2 text-xs uppercase tracking-wider">
              <ListChecks className="size-3.5" /> Speaker notes
            </CardTitle>
          </CardHeader>
          <CardContent className="text-muted-foreground text-sm">{slide.notes}</CardContent>
        </Card>
      )}

      {atEnd && caseN && (
        <Card className="border-brand/40 bg-brand/[0.04]">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Check className="text-brand size-4" /> Case {caseN} marked complete
            </CardTitle>
            <p className="text-muted-foreground text-sm">
              Stored on this device — the index shows the diagnosis once a case is complete.
            </p>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Button onClick={onExit} className="gap-2">
              <House className="size-4" /> Back to index
            </Button>
            <Button variant="ghost" className="gap-2" onClick={() => progress.setDone(caseN, false)}>
              <Undo2 className="size-4" /> Undo
            </Button>
          </CardContent>
        </Card>
      )}

      <Lightbox picture={zoom} onClose={() => setZoom(null)} />

      <p className="text-muted-foreground/70 text-center text-xs">
        click anywhere or press space to advance · ← back · esc index · n/p case · f present
      </p>
    </div>
  );
}
