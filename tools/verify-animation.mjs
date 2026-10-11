/** Every slide change must use the same entrance animation, and the deck's click-steps must
 *  still hold content back. */
import puppeteer from "puppeteer-core";
const BASE = process.argv[2] ?? "http://localhost:4187";
const browser = await puppeteer.launch({ executablePath: "/usr/bin/chromium", headless: "shell", args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });
const settle = (ms = 650) => new Promise((r) => setTimeout(r, ms));
const ok = (l, p, e = "") => console.log(`  ${p ? "PASS" : "FAIL"}  ${l}${e ? "  " + e : ""}`);
await page.goto(`${BASE}/#/c/1`, { waitUntil: "networkidle0" });
await settle();

const anims = [];
for (let i = 0; i < 4; i++) {
  await page.evaluate((n) => document.querySelector(`[data-slide-nav="${n}"]`)?.click(), i);
  await settle(400);
  const info = await page.evaluate(() => {
    // content the deck holds back until a click has no animation yet, by design
    const els = [...document.querySelectorAll(".slide-canvas [data-block]:not(.reveal-hidden), .slide-canvas .slide-in")];
    return els.map((e) => {
      const cs = getComputedStyle(e);
      return { anim: cs.animationName, dur: cs.animationDuration, ease: cs.animationTimingFunction };
    });
  });
  anims.push(info);
}
const names = new Set(anims.flat().map((a) => a.anim).filter((n) => n !== "none"));
const durs = new Set(anims.flat().map((a) => a.dur));
const eases = new Set(anims.flat().map((a) => a.ease));
ok("every animated element uses the same keyframes", names.size <= 2, [...names].join(","));
ok("same duration everywhere", durs.size === 1, [...durs].join(","));
ok("same easing everywhere", eases.size === 1, [...eases].join(","));

// the deck's click-step still gates the vignette
await page.evaluate(() => document.querySelector("[data-slide-nav=\"0\"]")?.click());
await settle();
const held = await page.evaluate(() =>
  [...document.querySelectorAll('[data-block="text"]')].some((e) => e.classList.contains("reveal-hidden")),
);
await page.keyboard.press("ArrowRight");
await settle();
const released = await page.evaluate(() =>
  [...document.querySelectorAll('[data-block="text"]')].every((e) => e.classList.contains("reveal-shown")),
);
ok("deck's click-step still holds the vignette, then reveals it", held && released, `held=${held} released=${released}`);
await browser.close();
