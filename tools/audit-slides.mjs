/**
 * Walks every slide and reports text that escapes its box or the slide area,
 * measured in the browser against the 1280x720 canvas.
 */
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] ?? "http://localhost:4187";
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const settle = (ms = 260) => new Promise((r) => setTimeout(r, ms));

const collect = () =>
  page.evaluate(() => {
    const canvas = document.querySelector(".slide-canvas");
    if (!canvas) return null;
    const c = canvas.getBoundingClientRect();
    const scale = c.width / 1280;
    const blocks = [...canvas.querySelectorAll('[data-block="text"], [data-block="picture"], [data-block="table"]')];
    return blocks
      .map((el) => {
        const r = el.getBoundingClientRect();
        const rel = {
          x: (r.left - c.left) / scale,
          y: (r.top - c.top) / scale,
          w: r.width / scale,
          h: r.height / scale,
        };
        const overflowsBox = el.getAttribute("data-block") === "text"
          ? el.scrollHeight - el.clientHeight > 2
          : false;
        const text = (el.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 42);
        return {
          text,
          rel,
          contentH: el.scrollHeight / scale,
          boxH: el.clientHeight / scale,
          block: el.getAttribute("data-block"),
          overflowsBox,
          outside:
            rel.x < -1 || rel.y < -1 || rel.x + rel.w > 1281 || rel.y + rel.h > 721,
        };
      })
      .filter((b) => b.text);
  });

await page.goto(`${BASE}/#/`, { waitUntil: "networkidle0" });
const deck = await page.evaluate(async () => (await fetch("./content.json")).json());
const problems = [];
const routes = [["front", deck.slides.filter((s) => s.pos < 5 && s.pos !== deck.indexSlideToSkip).map((s) => s.pos)],
                ...deck.cases.map((c) => [`${c.n}`, c.slides])];

for (const [name, positions] of routes) {
  await page.evaluate((n) => (window.location.hash = n === "front" ? "#/front" : `#/c/${n}`), name);
  await settle(500);
  for (let i = 0; i < positions.length; i++) {
    await page.evaluate((idx) => document.querySelector(`[data-slide-nav="${idx}"]`)?.click(), i);
    await settle();
    const blocks = await collect();
    if (!blocks) continue;
    for (const b of blocks) {
      if (b.overflowsBox || b.outside) {
        problems.push({
          route: name,
          slide: positions[i],
          n: i + 1,
          kind: [b.block, b.outside ? "OUTSIDE-SLIDE" : "", b.overflowsBox ? "TEXT-TALLER-THAN-BOX" : ""]
            .filter(Boolean)
            .join("+"),
          box: `x${Math.round(b.rel.x)} y${Math.round(b.rel.y)} ${Math.round(b.rel.w)}x${Math.round(b.rel.h)}`,
          text: b.text,
          need: `${Math.round(b.contentH)}px content in ${Math.round(b.boxH)}px box`,
        });
      }
    }
  }
}

console.log(`problem text blocks: ${problems.length}\n`);
for (const p of problems) {
  console.log(`  case ${String(p.route).padStart(4)} slide ${String(p.slide).padStart(2)} (#${p.n})  ${p.kind}`);
  console.log(`      ${p.box}  ${p.need}`);
  console.log(`      "${p.text}"`);
}
if (!problems.length) console.log("  none — every text block fits its box and the slide area");
await browser.close();
