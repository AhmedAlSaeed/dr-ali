import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The deck is 13.333in x 7.5in. Everything is laid out on a fixed 1280x720 canvas
 *  (96px per inch — exactly the slide geometry the extractor reports), then scaled to fit.
 *  fit="width" keeps the 16:9 box as wide as its container (inline view);
 *  fit="contain" fits the whole slide inside the box, centred (present mode). */
export const CANVAS_W = 1280;
export const CANVAS_H = 720;
export const PX_PER_IN = 96;

export function Stage({
  children,
  className,
  fit = "width",
}: {
  children: ReactNode;
  className?: string;
  fit?: "width" | "contain";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const { clientWidth: w, clientHeight: h } = el;
      if (!w) return;
      setScale(fit === "contain" && h > 0 ? Math.min(w / CANVAS_W, h / CANVAS_H) : w / CANVAS_W);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const w = CANVAS_W * scale;
  const h = CANVAS_H * scale;

  return (
    <div
      ref={ref}
      className={cn(
        "relative",
        fit === "width" && "w-full overflow-hidden rounded-xl border bg-black shadow-sm",
        fit === "contain" && "flex h-full w-full items-center justify-center overflow-hidden",
        className,
      )}
      style={fit === "width" ? { aspectRatio: `${CANVAS_W} / ${CANVAS_H}` } : undefined}
    >
      <div className="relative overflow-hidden" style={{ width: w, height: h }}>
        <div
          className="slide-canvas absolute left-0 top-0 origin-top-left"
          style={{ width: CANVAS_W, height: CANVAS_H, transform: `scale(${scale})` }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
