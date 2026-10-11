import puppeteer from "puppeteer-core";
const b = await puppeteer.launch({ executablePath: "/usr/bin/chromium", headless: "shell",
  args: ["--no-sandbox", "--disable-http-cache"] });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 900 });
const bad = [];
p.on("response", (r) => r.status() >= 400 && bad.push(`${r.status()} ${r.url()}`));
const settle = (ms) => new Promise((r) => setTimeout(r, ms));
await p.goto("https://ahmedalsaeed.github.io/dr-ali/", { waitUntil: "networkidle0" });
await settle(800);
// walk every case and every slide, counting images that failed to decode
let seen = 0, broken = 0;
for (const n of Array.from({ length: 12 }, (_, i) => i + 1)) {
  await p.goto(`https://ahmedalsaeed.github.io/dr-ali/#/c/${n}`, { waitUntil: "networkidle0" });
  await settle(500);
  const slides = await p.$$eval("[data-slide-nav]", (e) => e.length);
  for (let i = 0; i < slides; i++) {
    await p.evaluate((k) => document.querySelector(`[data-slide-nav="${k}"]`)?.click(), i);
    await settle(420);
    const r = await p.$$eval("[data-block='picture'] img, .slide-canvas img", (els) =>
      Promise.all(
        els.map(
          (e) =>
            new Promise((res) => {
              if (e.complete) return res({ w: e.naturalWidth, src: e.getAttribute("src") });
              e.addEventListener("load", () => res({ w: e.naturalWidth, src: e.getAttribute("src") }), { once: true });
              e.addEventListener("error", () => res({ w: 0, src: e.getAttribute("src") }), { once: true });
              setTimeout(() => res({ w: e.naturalWidth, src: e.getAttribute("src") }), 4000);
            }),
        ),
      ));
    for (const x of r) { seen++; if (!x.w) { broken++; bad.push(`broken ${x.src}`); } }
  }
}
console.log(`  images rendered: ${seen}, broken: ${broken}`);
console.log(`  http errors: ${bad.length}`, bad.slice(0, 3).join(" | "));
await b.close().catch(() => {});
process.exit(broken === 0 && bad.length === 0 ? 0 : 1);
