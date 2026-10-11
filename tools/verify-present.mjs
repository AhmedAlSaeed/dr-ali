/**
 * Verifies case switching and the present (fullscreen) mode in a real browser.
 */
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] ?? "http://localhost:5173";
const OUT = process.argv[3] ?? "/tmp";

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--window-size=1440,900"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
const errors = [];
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(String(e)));
const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms));
const ok = (label, pass, extra = "") =>
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${extra ? "  " + extra : ""}`);

// ---------- regression: switching case must reset slide/step ----------
await page.goto(`${BASE}/#/c/3`, { waitUntil: "networkidle0" });
await settle();
for (let i = 0; i < 4; i++) {
  await page.keyboard.press("ArrowRight");
  await new Promise((r) => setTimeout(r, 80));
}
const beforeSwitch = await page.$eval("[data-slide-index]", (e) => e.getAttribute("data-slide-index"));
const menu = await page.$('button[aria-haspopup="listbox"]');
await menu?.click();
await settle(250);
const optionCount = await page.$$eval('[role="option"]', (e) => e.length);
await page.$$eval('[role="option"]', (els) => els[4]?.click());   // Case 5
await settle(500);
const afterSwitch = await page.$eval("[data-slide-index]", (e) => e.getAttribute("data-slide-index"));
ok("case dropdown lists all 12 cases", optionCount === 12, `(${optionCount} options)`);
ok("switching case resets to the first slide", afterSwitch === "0" && beforeSwitch !== "0",
   `index ${beforeSwitch} -> ${afterSwitch}`);

// ---------- present mode ----------
await page.keyboard.press("f");
await settle(600);
const presentState = await page.evaluate(() => {
  const header = document.querySelector("header");
  const canvas = document.querySelector(".slide-canvas");
  const box = canvas?.getBoundingClientRect();
  const fixed = header ? getComputedStyle(header) : null;
  return {
    fullscreenEl: document.fullscreenElement ? document.fullscreenElement.tagName : null,
    headerBorderBottom: fixed?.borderBottomWidth ?? null,
    headerBg: fixed?.backgroundColor ?? null,
    canvasScale: box ? Math.round((box.width / 1280) * 1000) / 1000 : null,
    canvasH: box ? Math.round(box.height) : null,
    viewportH: window.innerHeight,
    fills: box ? box.height <= window.innerHeight && box.height > window.innerHeight * 0.75 : false,
  };
});
ok("present mode enters real fullscreen", presentState.fullscreenEl !== null, String(presentState.fullscreenEl));
ok("present header has a bottom border", parseFloat(presentState.headerBorderBottom ?? "0") > 0, `${presentState.headerBorderBottom}`);
ok("present header background matches the slide", /rgb\(0, 0, 0\)|oklch\(0 0 0\)/.test(presentState.headerBg ?? ""), String(presentState.headerBg));
const overlay = await page.evaluate(() => {
  const el = document.querySelector(".fixed.inset-0");
  const r = el?.getBoundingClientRect();
  return r ? { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight } : null;
});
ok("present overlay covers the viewport", !!overlay && overlay.w === overlay.vw && overlay.h === overlay.vh,
   JSON.stringify(overlay));
ok("slide fills the fullscreen space", presentState.fills,
   `canvas ${presentState.canvasH}px of ${presentState.viewportH}px viewport (scale ${presentState.canvasScale})`);
await page.screenshot({ path: `${OUT}/site-present.png` });

// Esc leaves fullscreen but stays on the slide; a second Esc goes to the index
await page.keyboard.press("Escape");
await settle(500);
const stillCase = await page.evaluate(() => location.hash);
ok("esc exits present mode, stays in the case", stillCase.startsWith("#/c/"), stillCase);

await browser.close().catch(() => {});
process.exit(0);
