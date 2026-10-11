/**
 * Renders the site's slides next to the same slides from the ORIGINAL deck
 * (alifellow-work/orig.pdf, produced from AliFellow.pptx.bak by LibreOffice) so the two can be
 * eyeballed. Site slide position P maps to deck page P-1 (the deck has an extra index slide at 4).
 */
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const BASE = process.argv[2] ?? "http://localhost:4187";
const DECK_PDF = "/home/ahmed/Downloads/alifellow-work/orig.pdf";
const OUT = "/tmp/compare";
const targets = process.argv.slice(3).map((t) => t.split(":"));   // route:slideIndex

const browser = await puppeteer.launch({
  executablePath: "/usr/bin/chromium",
  headless: "shell",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1200 });

for (const [route, idxRaw] of targets) {
  const idx = Number(idxRaw);
  await page.goto(`${BASE}/#/${route === "front" ? "front" : `c/${route}`}`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate((i) => document.querySelector(`[data-slide-nav="${i}"]`)?.click(), idx);
  await new Promise((r) => setTimeout(r, 900));
  const box = await page.evaluate(() => {
    const el = document.querySelector(".slide-canvas")?.parentElement;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
  });
  const siteShot = `${OUT}/site-${route}-${idx + 1}.png`;
  await page.screenshot({ path: siteShot, clip: box });

  const deckPos = await page.evaluate(() => {
    const label = document.querySelector(".tabular-nums")?.textContent ?? "";
    return label;
  });
  console.log(`  ${route} slide ${idx + 1} -> site shot ${siteShot}`);
}
await browser.close();
