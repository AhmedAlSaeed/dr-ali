/** Shape of public/content.json, produced by tools/extract.py from the PowerPoint deck. */

export type Run = {
  t: string;
  b?: boolean;
  i?: boolean;
  sz?: number | null;
  color?: string | null;
  br?: boolean;
};

export type Para = {
  lvl: number;
  runs: Run[];
  bullet: "char" | "num" | "none" | null;
  /** the bullet glyph the deck declares (• ◦ - ...) */
  char?: string | null;
  algn?: "l" | "ctr" | "r" | "just" | null;
  /** left margin and (negative) hanging indent, in inches, from the master's text styles */
  marL?: number | null;
  indent?: number | null;
  /** line spacing as a fraction of single spacing (deck default 0.9) and space-before in points */
  lnSpcPct?: number | null;
  spcBefPt?: number | null;
};

export type TextBlock = {
  role: "title" | "subtitle" | "body" | "text";
  name: string;
  ph: string | null;
  /** 0 = visible on arrival; N = appears on the Nth click (migrated from the deck's timing) */
  reveal: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** points; falls back to the layout placeholder, then to a per-role default */
  size: number | null;
  /** vertical anchor of the text box: t (top, default), ctr, b */
  anchor: "t" | "ctr" | "b";
  /** rotation in degrees as written in the deck (e.g. 270 for the vertical row labels) */
  rot?: number;
  /** the deck's wrap mode; "none" means the text must stay on one line (image captions) */
  wrap?: "square" | "none";
  /** the deck's own normAutofit font scale (1 = none) and line-spacing reduction */
  fontScale?: number;
  lnSpcReduction?: number;
  paras: Para[];
};

export type Picture = {
  src: string;
  alt: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type ChromeItem = {
  kind: "rect" | "roundRect" | "ellipse" | "image";
  x: number;
  y: number;
  w: number;
  h: number;
  fill?: string;
  alpha?: number;
  src?: string;
  alt?: string;
};

export type Slide = {
  pos: number;
  part: string;
  title: string;
  texts: TextBlock[];
  pictures: Picture[];
  /** layout-inherited bars, stripes, logos and overlays, in spTree order (behind content) */
  chrome: ChromeItem[];
  ownContent?: boolean;
  table: string[][] | null;
  tableBox: { x: number; y: number; w: number; h: number } | null;
  fromLayout?: boolean;
  notes: string;
  reveal: string[];
  bg: string | null;
};

export type CaseEntry = {
  n: number;
  start: number;
  end: number;
  slides: number[];
  vignette: string;
  diagnosis: string;
  companion: string | null;
  slideTitles: string[];
};

export type Conference = {
  title: string;
  speaker: string;
  date: string;
  institution: string;
  providedBy?: string;
  logo?: string | null;
};

export type ConflictOfInterest = {
  title: string;
  subtitle: string;
  columns: string[];
  rows: string[][];
  footnotes: string[];
};

export type Accreditation = {
  title: string;
  sections: { heading: string; body: string }[];
};

export type Deck = {
  deck: string;
  conference?: Conference;
  conflictOfInterest?: ConflictOfInterest;
  accreditation?: Accreditation;
  slideCount: number;
  indexSlideToSkip: number | null;
  cases: CaseEntry[];
  slides: Slide[];
};

export const SLIDE_W = 13.333; // inches — the deck is 16:9 at 12192000 x 6858000 EMU
export const SLIDE_H = 7.5;

export async function loadDeck(): Promise<Deck> {
  const res = await fetch(`${import.meta.env.BASE_URL}content.json`);
  if (!res.ok) throw new Error(`could not load content.json (${res.status})`);
  return (await res.json()) as Deck;
}

/** front matter is everything before the first case that still carries content */
export function frontMatter(deck: Deck): Slide[] {
  const firstCase = Math.min(...deck.cases.map((c) => c.start));
  return deck.slides.filter((s) => s.pos < firstCase && s.pos !== deck.indexSlideToSkip);
}

/** the closing slide (after the last case) keeps its artwork in the layout, so it has no text */
export function backMatter(deck: Deck): Slide[] {
  const lastCase = Math.max(...deck.cases.map((c) => c.end));
  return deck.slides.filter((s) => s.pos > lastCase);
}

export function stepsInSlide(slide: Slide): number {
  return Math.max(0, ...slide.texts.map((t) => t.reveal));
}

export function slideOfCase(deck: Deck, caseN: number, index: number): Slide {
  const entry = deck.cases.find((c) => c.n === caseN)!;
  const pos = entry.slides[Math.max(0, Math.min(index, entry.slides.length - 1))];
  return deck.slides.find((s) => s.pos === pos)!;
}

export function plainText(block: TextBlock): string {
  return block.paras
    .map((p) => p.runs.map((r) => (r.br ? " " : r.t)).join(""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

export function slideHasContent(slide: Slide): boolean {
  return slide.texts.length > 0 || slide.pictures.length > 0;
}
