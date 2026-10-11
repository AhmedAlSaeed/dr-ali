import { useEffect, useRef, useState, type ReactNode } from "react";
import { ZoomIn } from "lucide-react";
import type { Picture, Slide, TextBlock } from "@/lib/deck";
import { CANVAS_H, CANVAS_W, PX_PER_IN } from "@/components/Stage";
import { cn } from "@/lib/utils";

const ROLE_PT: Record<TextBlock["role"], number> = { title: 32, subtitle: 20, body: 16, text: 16 };
const BULLET_FALLBACK: Record<number, string> = { 0: "\u2022", 1: "\u25e6", 2: "\u25aa" };

function luminance(hex: string) {
  const n = parseInt(hex, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** null/`dark` means "no explicit background" — the master's background is tx1, i.e. black. */
export function slideTheme(slide: Slide) {
  const hex = slide.bg && /^[0-9a-fA-F]{6}$/.test(slide.bg) ? slide.bg : null;
  const light = hex ? luminance(hex) > 0.6 : slide.bg === "light";
  return {
    light,
    background: hex ? `#${hex}` : light ? "#ffffff" : "#000000",
    foreground: light ? "#0f172a" : "#ffffff",
    muted: light ? "#475569" : "#cbd5e1",
  };
}

/** Keep a block inside the slide, honouring rotation: a rotated box is placed by its centre so
 *  that its rotated bounding box (not the raw box) stays within the slide. */
function boxInSlide(block: TextBlock) {
  const maxW = CANVAS_W / PX_PER_IN;
  const maxH = CANVAS_H / PX_PER_IN;
  let w = block.w > 0 ? block.w : maxW - Math.max(0, block.x) - 0.4;
  let h = block.h > 0 ? block.h : maxH - Math.max(0, block.y) - 0.2;
  w = Math.min(w, maxW - 0.05);
  h = Math.min(h, maxH - 0.05);
  const rot = block.rot ?? 0;
  const rad = (rot * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const bw = w * cos + h * sin;                 // size of the rotated bounding box
  const bh = w * sin + h * cos;
  let cx = block.x + (block.w > 0 ? block.w : w) / 2;
  let cy = block.y + (block.h > 0 ? block.h : h) / 2;
  cx = Math.max(bw / 2, Math.min(cx, maxW - bw / 2));
  cy = Math.max(bh / 2, Math.min(cy, maxH - bh / 2));
  return { x: cx - w / 2, y: cy - h / 2, w, h, rot };
}

/** PowerPoint shrinks text that does not fit its placeholder; so do we, but only as a safety
 *  net — the deck's own normAutofit scale is applied first. */
function AutoFit({
  boxH,
  deps,
  children,
}: {
  boxH: number;
  deps: string;
  children: (scale: number) => ReactNode;
}) {
  const inner = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useEffect(() => setScale(1), [deps]);

  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    const need = el.scrollHeight;
    if (need > boxH + 1 && scale > 0.55) {
      setScale(Math.max(0.55, scale * Math.max(0.7, boxH / need)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boxH, scale, deps]);

  return (
    <div ref={inner} style={{ display: "flex", flexDirection: "column" }}>
      {children(scale)}
    </div>
  );
}

/** uniform entrance timing: same duration/easing for every element, staggered by position */
const STAGGER_MS = 45;
const stagger = (i: number) => ({ animationDelay: `${Math.min(i, 8) * STAGGER_MS}ms` });

export function SlideView({
  slide,
  step,
  onImageClick,
}: {
  slide: Slide;
  step: number;
  /** called for a tap/click on a picture — opening it, never advancing the slide */
  onImageClick?: (picture: Picture) => void;
}) {
  const theme = slideTheme(slide);

  return (
    <div
      key={slide.pos}
      className="slide-in slide-canvas-root relative h-full w-full"
      style={{ background: theme.background, color: theme.foreground }}
    >
      {slide.chrome.map((c, i) =>
        c.kind === "image" ? (
          <img
            key={`chrome-${i}`}
            src={`${import.meta.env.BASE_URL}media/${c.src}`}
            alt=""
            className="absolute object-fill"
            style={{ left: c.x * PX_PER_IN, top: c.y * PX_PER_IN, width: c.w * PX_PER_IN, height: c.h * PX_PER_IN }}
          />
        ) : (
          <div
            key={`chrome-${i}`}
            className="absolute"
            style={{
              left: c.x * PX_PER_IN,
              top: c.y * PX_PER_IN,
              width: c.w * PX_PER_IN,
              height: c.h * PX_PER_IN,
              background: `#${c.fill}`,
              opacity: c.alpha ?? 1,
              borderRadius: c.kind === "roundRect" ? "0.35rem" : c.kind === "ellipse" ? "9999px" : undefined,
            }}
          />
        ),
      )}

      {slide.pictures.map((p, i) => (
        // keyed by slide so every slide change re-runs the same entrance animation
        <div
          key={`${slide.pos}-${p.src}-${i}`}
          data-block="picture"
          onClick={
            onImageClick
              ? (e) => {
                  e.stopPropagation();       // a click on an image must not advance the slide
                  onImageClick(p);
                }
              : undefined
          }
          className={cn("reveal-shown group absolute", onImageClick && "cursor-zoom-in")}
          style={{
            ...stagger(i),
            left: p.x * PX_PER_IN,
            top: p.y * PX_PER_IN,
            width: p.w * PX_PER_IN,
            height: p.h * PX_PER_IN,
          }}
        >
          <img
            src={`${import.meta.env.BASE_URL}media/${p.src}`}
            alt={p.alt}
            loading="lazy"
            className="h-full w-full object-fill"
          />
          {onImageClick && (
            <button
              type="button"
              aria-label={`Enlarge image ${i + 1}`}
              onClick={(e) => {
                e.stopPropagation();
                onImageClick(p);
              }}
              className="absolute right-2 top-2 rounded-md bg-black/55 p-1.5 text-white/90 backdrop-blur transition-opacity hover:bg-black/75 focus-visible:opacity-100 md:opacity-0 md:group-hover:opacity-100"
            >
              <ZoomIn className="size-4" />
            </button>
          )}
        </div>
      ))}

      {slide.table && slide.tableBox && (
        <table
          data-block="table"
          className="reveal-shown absolute border-collapse text-[15px]"
          style={{
            left: slide.tableBox.x * PX_PER_IN,
            top: slide.tableBox.y * PX_PER_IN,
            width: slide.tableBox.w * PX_PER_IN,
            height: slide.tableBox.h * PX_PER_IN,
            color: theme.foreground,
          }}
        >
          <tbody>
            {slide.table.map((row, r) => (
              <tr key={r}>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={cn(
                      "border px-3 py-2 align-middle",
                      r === 0 ? "font-semibold" : "",
                      r === 0 && c > 0 ? "text-center" : "",
                    )}
                    style={{ borderColor: theme.light ? "#cbd5e1" : "#475569", width: `${100 / row.length}%` }}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {slide.texts.map((t, i) => {
        const hidden = t.reveal > step;
        const box = boxInSlide(t);
        const boxH = box.h * PX_PER_IN;
        const blockPt = t.size ?? ROLE_PT[t.role];
        const fontScale = t.fontScale ?? 1;
        // the deck sets line spacing per level (90%) and a per-level space-before
        const lnReduction = t.lnSpcReduction ?? 0;

        return (
          <div
            key={`${slide.pos}-${t.name}-${i}`}
            data-block="text"
            className={cn("absolute", hidden ? "reveal-hidden" : "reveal-shown")}
            style={{
              ...stagger(i),
              left: box.x * PX_PER_IN,
              top: box.y * PX_PER_IN,
              width: box.w * PX_PER_IN,
              height: boxH,
              display: "flex",
              flexDirection: "column",
              justifyContent: t.anchor === "ctr" ? "center" : t.anchor === "b" ? "flex-end" : "flex-start",
              transform: box.rot ? `rotate(${box.rot}deg)` : undefined,
              transformOrigin: "center",
            }}
          >
            <AutoFit boxH={boxH} deps={`${slide.pos}-${i}-${step}`}>
              {(fit) =>
                t.paras.map((p, pi) => {
                  // per-level size from the shape's lstStyle ladder, scaled by the deck's
                  // normAutofit and by the auto-fit pass
                  const pt = (p.sz ?? blockPt) * fontScale * fit;
                  const bullet = p.bullet === "char" || p.bullet === "num" ? p.bullet : "none";
                  // indentation and hanging indent come from the deck (marL / indent)
                  const pad = (p.marL ?? 0.25 * (p.lvl + 1)) * PX_PER_IN;
                  const hang = (p.indent ?? -0.25) * PX_PER_IN;
                  const numbered =
                    bullet === "num"
                      ? t.paras.slice(0, pi + 1).filter((q) => q.bullet === "num" && q.lvl === p.lvl).length
                      : 0;
                  return (
                    <p
                      key={pi}
                      style={{
                        margin: 0,
                        marginBottom: "0.35em",
                        fontSize: Math.round(pt * (PX_PER_IN / 72) * 10) / 10,
                        lineHeight: 1.22 * (p.lnSpcPct ?? 1) * (1 - lnReduction),
                        marginTop: p.spcBefPt
                          ? Math.round(p.spcBefPt * (PX_PER_IN / 72) * 10) / 10
                          : undefined,
                        textAlign: p.algn === "ctr" ? "center" : p.algn === "r" ? "right" : "left",
                        whiteSpace: t.wrap === "none" ? "nowrap" : undefined,
                        paddingLeft: bullet === "none" ? 0 : pad,
                        textIndent: bullet === "none" ? 0 : hang,
                      }}
                    >
                      {bullet !== "none" && (
                        <span
                          style={{
                            marginRight: "0.4em",
                            color: p.bulletColor ? `#${p.bulletColor}` : theme.muted,
                          }}
                        >
                          {numbered ? `${numbered}.` : (p.char || BULLET_FALLBACK[Math.min(p.lvl, 2)])}
                        </span>
                      )}
                      {p.runs.map((r, ri) =>
                        r.br ? (
                          <br key={ri} />
                        ) : (
                          <span
                            key={ri}
                            style={{
                              fontWeight: r.b ? 700 : undefined,
                              fontStyle: r.i ? "italic" : undefined,
                              fontSize: r.sz
                                ? Math.round(r.sz * fontScale * fit * (PX_PER_IN / 72) * 10) / 10
                                : undefined,
                              color: r.color ? `#${r.color}` : undefined,
                            }}
                          >
                            {r.t}
                          </span>
                        ),
                      )}
                    </p>
                  );
                })
              }
            </AutoFit>
          </div>
        );
      })}
    </div>
  );
}
