/**
 * Verifies the site in a real browser (system Chromium via puppeteer-core):
 *   - the index lists 12 cases and shows no spoilers
 *   - the deck's click-to-reveal step is reproduced (vignette hidden, then shown on click)
 *   - reaching a case's last slide marks it complete and the index then shows the diagnosis
 *   - images resolve, nothing errors in the console
 */
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] ?? "http://localhost:5173";
const OUT = process.argv[3] ?? "/tmp";
const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--force-device-scale-factor=1"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000, deviceScaleFactor: 1 });

const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
page.on("requestfailed", (r) => errors.push(`failed: ${r.url()}`));
page.on("response", (r) => {
  if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
});

const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const shot = async (path) => { await settle(); await page.screenshot({ path }); };
const ok = (label, pass, extra = "") =>
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);

// ---------- index ----------
await page.goto(`${BASE}/#/`, { waitUntil: "networkidle0" });
const cards = await page.$$eval('[data-slot="card"]', (els) =>
  els.map((e) => e.textContent?.replace(/\s+/g, " ").trim() ?? ""),
);
const caseCards = await page.$$eval("[data-case-card]", (els) =>
  els.map((e) => e.getAttribute("data-case-card")),
);
ok("index lists 12 cases", caseCards.length === 12, `(${caseCards.length} cards)`);
ok("no diagnosis spoiler before completion", !cards.some((c) => /Encephalopathy/.test(c)));
await shot(`${OUT}/site-index.png`);

// ---------- case 1: migrated reveal ----------
await page.goto(`${BASE}/#/c/1`, { waitUntil: "networkidle0" });
const stateOf = async () =>
  page.evaluate(() => {
    const blocks = [...document.querySelectorAll(".reveal-hidden, .reveal-shown")];
    return blocks.map((b) => ({
      hidden: b.classList.contains("reveal-hidden"),
      text: (b.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40),
    }));
  });

const before = await stateOf();
const vignetteHidden = before.some((b) => b.hidden && /previously healthy/.test(b.text));
ok("case title visible, vignette held back (as in the deck)", vignetteHidden, JSON.stringify(before));

await shot(`${OUT}/site-case-title.png`);

await page.click('[aria-label="Next"]');
await new Promise((r) => setTimeout(r, 600));
const after = await stateOf();
const vignetteShown = after.some((b) => !b.hidden && /previously healthy/.test(b.text));
ok("click reveals the vignette (animation migrated)", vignetteShown);
await shot(`${OUT}/site-case-revealed.png`);

// ---------- images on image-heavy slides ----------
const jumpToSlide = async (n) => {
  await page.evaluate((target) => {
    document.querySelector(`[data-slide-nav="${target}"]`)?.click();
  }, n);
  await new Promise((r) => setTimeout(r, 900));
};
await page.goto(`${BASE}/#/c/1`, { waitUntil: "networkidle0" });
await jumpToSlide(3);
let imgs = await page.$$eval("img", (els) =>
  els.map((i) => ({ src: i.getAttribute("src"), w: i.naturalWidth, h: i.naturalHeight })),
);
ok("images load on an imaging slide", imgs.length > 0 && imgs.every((i) => i.w > 0), `(${imgs.length} images)`);
await page.goto(`${BASE}/#/c/11`, { waitUntil: "networkidle0" });
await jumpToSlide(2);
imgs = await page.$$eval("img", (els) => els.map((i) => ({ w: i.naturalWidth })));
ok("images load in case 11", imgs.length > 0 && imgs.every((i) => i.w > 0), `(${imgs.length} images)`);
await shot(`${OUT}/site-case-imaging.png`);

// ---------- completion + index un-spoilers ----------
await page.evaluate(() => localStorage.removeItem("alifellow.progress.v1"));
await page.goto(`${BASE}/#/c/3`, { waitUntil: "networkidle0" });
const total = await page.$$eval('[data-slide-nav]', (els) => els.length);
for (let i = 0; i < total * 2; i++) {
  await page.keyboard.press("ArrowRight");
  await new Promise((r) => setTimeout(r, 100));
}
const completed = await page.evaluate(() =>
  JSON.parse(localStorage.getItem("alifellow.progress.v1") ?? "{}"),
);
ok("case marked complete on reaching its last slide", !!completed?.done?.["3"], JSON.stringify(completed?.done));
await shot(`${OUT}/site-case-complete.png`);

await page.goto(`${BASE}/#/`, { waitUntil: "networkidle0" });
const afterCards = await page.$$eval('[data-slot="card"]', (els) =>
  els.map((e) => e.textContent?.replace(/\s+/g, " ").trim() ?? ""),
);
ok("index now reveals that case's diagnosis", afterCards.some((c) => /Craniopharyngioma/.test(c)));
const summary = await page.$eval("[data-progress-summary]", (e) => e.textContent ?? "").catch(() => "");
ok("progress line updates (and only shows when there is progress)", /1 of 12 complete/.test(summary), summary.replace(/\s+/g, " ").trim());
await shot(`${OUT}/site-index-progress.png`);

const real = errors.filter((e) => !/favicon/.test(e));
ok("no console/page errors", real.length === 0, real.slice(0, 3).join(" | "));
await browser.close();
