/**
 * Text-over-picture audit: walks every slide and measures the *rendered* glyphs of each text
 * block against every picture frame, in slide inches. Boxes can overlap innocently (a title box is
 * taller than its single line), so this measures the lines themselves — the geometry the eye sees.
 *
 * Run against a dev server or a preview:  node tools/audit-overlap.mjs http://localhost:5173
 */
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] ?? "http://localhost:5173";
const MIN_IN = Number(process.argv[3] ?? 0.03);   // ignore sub-3px touches (rounding, antialiasing)

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));

await page.goto(`${BASE}/#/`, { waitUntil: "networkidle0" });
await settle(1200);
const cases = await page.$$eval("[data-case-card]", (els) => els.map((e) => Number(e.getAttribute("data-case-card"))));

/**
 * Lines of every text block and the frames of every picture, in slide inches (96px/in), with the
 * canvas's own scale taken out so the numbers are directly comparable to content.json.
 */
const measure = () =>
  page.evaluate(() => {
    const canvas = document.querySelector(".slide-canvas");
    if (!canvas) return null;
    const scale = canvas.getBoundingClientRect().width / 1280;
    const toIn = (r) => ({
      x: (r.left - canvas.getBoundingClientRect().left) / scale / 96,
      y: (r.top - canvas.getBoundingClientRect().top) / scale / 96,
      w: r.width / scale / 96,
      h: r.height / scale / 96,
    });

    const lines = [];
    for (const block of document.querySelectorAll('[data-block="text"]')) {
      const text = (block.textContent ?? "").replace(/\s+/g, " ").trim();
      const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
      const rects = [];
      let node;
      while ((node = walker.nextNode())) {
        if (!node.nodeValue?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        for (const r of range.getClientRects()) {
          if (r.width > 0.5 && r.height > 0.5) rects.push(r);
        }
      }
      for (const r of rects) lines.push({ text, hidden: block.classList.contains("reveal-hidden"), ...toIn(r) });
    }

    const pictures = [...document.querySelectorAll('[data-block="picture"]')].map((el) => {
      const img = el.querySelector("img");
      return { src: (img?.getAttribute("src") ?? "").split("/").pop(), ...toIn(el.getBoundingClientRect()) };
    });
    return { lines, pictures };
  });

const problems = [];
for (const n of cases) {
  await page.evaluate((c) => (window.location.hash = `#/c/${c}`), n);
  await settle(700);
  const last = await page.$$eval("[data-slide-nav]", (els) => els.length - 1);
  for (let i = 0; i <= last; i++) {
    await page.evaluate((idx) => document.querySelector(`[data-slide-nav="${idx}"]`)?.click(), i);
    await settle(450);
    const m = await measure();
    if (!m) continue;
    for (const t of m.lines) {
      for (const p of m.pictures) {
        const ox = Math.min(t.x + t.w, p.x + p.w) - Math.max(t.x, p.x);
        const oy = Math.min(t.y + t.h, p.y + p.h) - Math.max(t.y, p.y);
        const overlap = Math.min(ox, oy);
        if (ox > MIN_IN && oy > MIN_IN && overlap > MIN_IN) {
          problems.push({
            case: n,
            nav: i,
            src: p.src,
            overlap: Number(overlap.toFixed(3)),
            text: t.text.slice(0, 48),
            textBox: [t.x, t.y, t.w, t.h].map((v) => Number(v.toFixed(3))),
            pic: [p.x, p.y, p.w, p.h].map((v) => Number(v.toFixed(3))),
          });
        }
      }
    }
  }
}

console.log(`\n  text over picture: ${problems.length} overlap(s) over ${MIN_IN}in\n`);
for (const p of problems) {
  console.log(
    `  case ${p.case} slide ${p.nav + 1}  ${p.overlap}in  "${p.text}"  over ${p.src}\n` +
      `      text [${p.textBox.join(", ")}]  picture [${p.pic.join(", ")}]`,
  );
}
await browser.close().catch(() => {});
process.exit(problems.length ? 1 : 0);
