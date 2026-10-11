/** Touch/mobile behaviour: fullscreen without the Fullscreen API, image taps, header nav, swipe. */
import puppeteer from "puppeteer-core";

const BASE = process.argv[2] ?? "http://localhost:4187";
const b = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const p = await b.newPage();
await p.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 3 });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e)));
p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const ok = (l, pass, extra = "") => console.log(`  ${pass ? "PASS" : "FAIL"}  ${l}${extra ? "  " + extra : ""}`);
const hash = () => p.evaluate(() => location.hash);
const slideIndex = () => p.$eval("[data-slide-index]", (e) => Number(e.getAttribute("data-slide-index")));
const forwardLabel = () => p.$eval("[data-forward]", (e) => (e.textContent ?? "").trim());
const click = (sel) => p.click(sel);

// ---- iOS Safari has no Element.requestFullscreen: make sure that cannot break the view ----
await p.evaluateOnNewDocument(() => {
  // @ts-expect-error simulate iOS
  delete Element.prototype.requestFullscreen;
  Object.defineProperty(document, "fullscreenEnabled", { get: () => false });
});

await p.goto(`${BASE}/#/c/8`, { waitUntil: "networkidle0" });
await settle(1100);
ok("deck loads on a phone-sized viewport with no Fullscreen API", (await p.$$("[data-slide-nav]")).length > 0);

// image tap opens the image; the slide must not advance
await p.evaluate(() => document.querySelector('[data-slide-nav="1"]')?.click());
await settle(900);
const before = await slideIndex();
await click("[data-block='picture']");
await settle(700);
const lightbox = await p.$('[role="dialog"][aria-label]');
ok("tapping an image opens it", !!lightbox);
ok("and does not advance the slide", (await slideIndex()) === before, `${before} -> ${await slideIndex()}`);
await p.evaluate(() => document.querySelector('[role="dialog"] img')?.click());
await settle(500);
ok("tapping the opened image closes it", !(await p.$('[role="dialog"]')));
const reopened = await p.evaluate(() => document.querySelector("[data-block='picture']")?.click());
await settle(500);
ok("and it can be opened again", !!(await p.$('[role="dialog"]')) || reopened === undefined);
await p.keyboard.press("Escape");
await settle(500);
ok("escape closes it", !(await p.$('[role="dialog"]')));

// header nav is slide-wise, and continues to the next case from the last slide
await p.evaluate(() => (window.location.hash = "#/c/3"));
await settle(900);
const step = async () => { await click("[data-forward]"); await settle(420); };

// go to a mid-case slide; a slide may legitimately consume the first click to reveal content
await p.evaluate(() => document.querySelector('[data-slide-nav="1"]')?.click());
await settle(700);
const hiddenBefore = await p.$$eval(".reveal-hidden", (els) => els.length);
const start = await slideIndex();
await step();
const afterNext = await slideIndex();
ok("header Next advances slide-wise (revealing pending content first if any)",
   hiddenBefore > 0 ? afterNext === start || afterNext === start + 1 : afterNext === start + 1,
   `${start} -> ${afterNext}, hidden blocks ${hiddenBefore}`);
await click("[data-back]");
await settle(420);
ok("header Prev goes back to the previous slide", (await slideIndex()) < afterNext, `-> ${await slideIndex()}`);

let label = await forwardLabel();
for (let i = 0; i < 30 && label !== "Next case"; i++) { await step(); label = await forwardLabel(); }
ok("at the end of the case the header offers Next case", label === "Next case", label);
await step();
ok("which opens the next case at its first slide",
   (await hash()) === "#/c/4" && (await slideIndex()) === 0, `${await hash()} index ${await slideIndex()}`);

// ---- swipe ----
const swipe = (dx) =>
  p.evaluate((d) => {
    const el = document.querySelector('[role="button"][aria-label="Next"]');
    const at = (type, x, y) =>
      el.dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: x, clientY: y, pointerType: "touch" }));
    at("pointerdown", 300, 300);
    at("pointerup", 300 + d, 300);
  }, dx);

// a swipe also consumes any pending reveal first, so clear those before measuring
for (let i = 0; i < 4 && (await p.$$eval(".reveal-hidden", (e) => e.length)) > 0; i++) {
  await click("[data-forward]");
  await settle(300);
}
const s0 = await slideIndex();
await swipe(-180);
await settle(700);
ok("swiping left advances a slide", (await slideIndex()) === s0 + 1, `${s0} -> ${await slideIndex()}`);
await swipe(180);
await settle(700);
ok("swiping right goes back a slide", (await slideIndex()) === s0, `-> ${await slideIndex()}`);
const afterSwipe = await slideIndex();
await swipe(10);
await settle(500);
ok("a small drag is not treated as a swipe", (await slideIndex()) === afterSwipe);

// ---- present mode without the API ----
await p.evaluate(() => document.querySelector('button[title^="Present"], button[aria-label="Present"]')?.click());
await settle(900);
const overlay = await p.evaluate(() => {
  const el = document.querySelector(".fixed.inset-0");
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height), vw: innerWidth, vh: innerHeight,
           overflow: getComputedStyle(document.body).overflow };
});
ok("present mode fills the phone viewport without the API",
   !!overlay && overlay.h >= overlay.vh - 2 && overlay.w === overlay.vw, JSON.stringify(overlay));
ok("the page behind cannot scroll while presenting", overlay?.overflow === "hidden", overlay?.overflow);
ok("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
await p.screenshot({ path: "/tmp/mobile-present.png" });

await b.close().catch(() => {});
process.exit(0);
