# Fellow Case Conference — website

**Live: <https://ahmedalsaeed.github.io/dr-ali/>** · repo: `AhmedAlSaeed/dr-ali`

A small static site for the twelve-case neuroradiology conference, built from
`AliFellow.pptx`. Replaces the macro-driven PowerPoint flow: no `.pptm`, no macro prompts,
works in any browser.

## Run it

```bash
npm install
npm ci               # in a fresh clone
npm run extract      # deck -> public/content.json + public/media + public/brand (needs the .pptx)
                     # the deck path is overridable:  DECK=~/somewhere/AliFellow.pptx npm run extract
npm run dev          # http://localhost:5173
npm run build        # -> dist/ (static; serve over HTTP, hash routing)
npm run preview      # serve dist/
npm run typecheck
```

`public/content.json` and `public/media/` are **committed** (the 39 MB `.pptx` is not), so a clone
builds and deploys without the deck. Re-run `npm run extract` after editing the deck.

The site needs an HTTP server — `file://` won't work (it fetches `content.json` and uses hash
routing). `dist/` is fully static, so any web server or static host works; `base: "./"` means it
also runs from a subpath.

## Pages

**Index** — masthead with the Emory logo and the name on one row (logo · “Fellow Case
Conference” · **Ali H Yusuf** · date), then one card per case. Progress is a single slim line
that **only appears once there is some**, and takes no space otherwise. Slide numbers, page
ranges and slide counts are not shown anywhere.

- an **outstanding** case shows **only its number** (`Case 7`) — no spoiler
- a **completed** case **reveals its diagnosis** (`Cavernous Sinus Thrombosis`) plus its
  companion case
- no vignettes or other case content on the index — the case itself is where the content lives
- **Accreditation & disclosures** sits **above the case list**: the deck's Conflict of Interest
  and Accreditation slides re-authored as web content (not screenshots), from
  `tools/deck-meta.json`. Shown once per device — after the first index view it is tucked
  away (reset clears it along with progress)

**Case view** — the slides, plus:

- a **case dropdown in the header**, so you can jump between cases without going back to the index
- the primary control follows the case: **Next** while slides remain, then **Next case** at the end
  (or **Back to index** on case 12), so a case flows straight into the next one
- a numberless position indicator (click to jump), speaker notes, click-to-zoom images, progress
  that reaches 100% exactly when the last slide is exhausted
- a case is marked complete **the moment its last slide is displayed**, and the index then
  reveals its diagnosis. Stored in `localStorage`; resume/reset on the index.

**Present mode** (`f`, or the ⤢ button) — real fullscreen, the slide scaled to fill the whole
space, and a **minimal header whose background matches the slide** with a bottom border: case
dropdown, prev/next, exit. Fullscreen is requested on `<html>` synchronously from the gesture, so
**presentation continues when you move to the next case** (the overlay is not the fullscreen
element, and the case component is not remounted). Where the API is missing — iOS Safari has no
`Element.requestFullscreen` — the overlay alone fills the viewport, using `dvh`. `esc` leaves
fullscreen first, a second `esc` returns to the index.

**Touch** — swiping horizontally moves between slides (a vertical drag still scrolls), and tapping
an image opens it rather than advancing.

## Keyboard (presenting)

| Key | Action |
|---|---|
| click / `space` / `→` | next step, then next slide |
| `←` | back a step / previous slide |
| `esc` / `home` | back to the index (leaves fullscreen first) |
| `n` / `p` | next / previous case |
| `f` | present mode (real fullscreen) |

## Animation

One system, defined once in `src/index.css` (`--entrance-duration`, `--entrance-ease`):

- every slide change fades in (`.slide-in`), then each element appears with the same 340ms
  ease-out entrance, staggered 45ms by position
- the deck's only animation — **click-triggered “Appear” entrances** on the case-intro vignettes —
  is migrated as real reveal steps: the title shows first, a click reveals the vignette, the next
  click advances. The source deck gated 11 of its 12 case intros and showed one (case 3)
  immediately; the extractor normalises that so **all 12 behave identically**.
- the entrance animates the independent `translate` property, not `transform`, so a shape's own
  rotation from the deck survives the animation
- `prefers-reduced-motion` disables it

## Fidelity

Slides render on the deck's own geometry: the extractor reports each shape's position in inches
and everything is drawn on a 1280×720 canvas (96px/in) that scales to fit, so imaging grids,
bullets, table and the Emory footer/logo sit where they do in PowerPoint. Inherited chrome (bars,
stripes, logos, the translucent overlay on the closing slide) is extracted too, including rotated
and alpha-blended shapes.

Text inherited its **size, alignment, bullets, hanging indents, line spacing (90%) and
space-before from the master's `txStyles`** — without that, body text lost its bullets and titles
were centred and the wrong size. `normAutofit fontScale` is applied, and as a safety net any block
still taller than its placeholder is shrunk, like PowerPoint's “shrink text on overflow”.

Two more normalisations the deck needed:

- **Grouped shapes.** 47 images across 12 slides sit inside `<p:grpSp>` groups, whose child
  coordinates are not slide coordinates. The extractor composes the group transform (nested
  groups included) — without it, a grid's second row landed on top of its first.
- **Image crops.** PowerPoint draws only the `<a:srcRect>` region of a picture inside its frame —
  72 of the deck's pictures are cropped that way. The crop is **baked into the extracted WebP**
  (not applied with CSS), and the picture then fills its frame exactly as the deck does, so aspect
  ratios come out right (median frame-vs-file mismatch 0.03%).
- **Image grids.** On 16 slides the grids are rebuilt: rows share a top and height, columns share
  x positions across rows, gaps are uniform (0.08in), the block is centred and scaled to fit
  inside the slide, and it stays clear of text beside it (case 6 keeps text left, images right).
- **Rotated text** (`rot="270deg"` row labels) is rendered rotated, placed by its rotated bounding
  box.

`tools/audit-slides.mjs` asserts nothing escapes its box or the slide: currently **0 problems
across all 78 slides**.

## Deploy

Live at **<https://ahmedalsaeed.github.io/dr-ali/>**, deployed from `main` by
`.github/workflows/deploy-pages.yml` (typecheck → build → upload → deploy) — currently
[GitHub Pages](https://github.com/AhmedAlSaeed/dr-ali/deployments) with **Source: GitHub Actions**.

It works as a *project* page (served from `/<repo>/`, not the domain root) because routing is
hash-based and assets are referenced relatively — no SPA 404 rewrite is needed. No deck is needed
in CI: `public/content.json` and `public/media/` are committed.

Note GitHub Pages serves **public** repositories on the free plan; a private repo needs a paid
plan. For a private repo, Cloudflare Pages (or Netlify/Vercel) builds the same `dist/` for free.

## Layout

```
tools/extract.py          deck -> content.json (+ media + logo). The only deck-aware code.
tools/cases.json          case names as specified by the presenter (+ companion labels)
tools/deck-meta.json      conference identity + Conflict of Interest / Accreditation content
tools/audit-slides.mjs    every slide: text overflow / outside-slide check
tools/verify-site.mjs     behaviour: index, spoilers, reveal, images, completion, counter
tools/verify-animation.mjs  one animation system; the deck's click-step still gates content
tools/verify-present.mjs  case switching resets, fullscreen, header, fills the space, continuity
tools/verify-forward.mjs  the forward control's label and destination at each point of a case
tools/verify-mobile.mjs   touch: no Fullscreen API, image taps, header nav, swipe
tools/compare-with-deck.mjs  screenshots a slide for side-by-side comparison with the deck PDF
src/lib/deck.ts           types + helpers
src/lib/progress.ts       completion state (localStorage)
src/components/           Stage (scaled canvas), SlideView, CasePage, IndexPage, Masthead,
                          Disclosures, CaseMenu, Lightbox
src/components/ui/        shadcn-style primitives (button, card, badge, progress, separator)
```

Regenerating content after the deck changes:

```bash
python3 tools/extract.py ~/Downloads/AliFellow.pptx public
```

## Not done (deliberately)

- Not pixel-identical: web fonts substitute for Calibri/Trebuchet, so some lines wrap a little
  differently. Sizes, spacing and colours come from the file.
- LibreOffice renders level-2 bullets as `◦`; the file itself says `•` at both levels, which is
  what the site uses.
- No presenter-notes window, PDF export, analytics or backend — it is a static site.
