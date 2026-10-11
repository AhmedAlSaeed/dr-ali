/** The progress bars must reach 100%: the index when all cases are done, and a case when its
 *  last slide has been fully revealed. */
import puppeteer from "puppeteer-core";
const BASE = process.argv[2] ?? "http://localhost:4187";
const b = await puppeteer.launch({ executablePath: "/usr/bin/chromium", headless: "shell", args: ["--no-sandbox"] });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 900 });
const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));
const ok = (l, pass, extra = "") => console.log(`  ${pass ? "PASS" : "FAIL"}  ${l}${extra ? "  " + extra : ""}`);
const pills = (sel) =>
  p.$$eval(sel, (els) => ({
    total: els.length,
    filled: els.filter((e) => e.getAttribute("data-filled") === "true").length,
  }));

// index with every case complete
await p.goto(`${BASE}/#/`, { waitUntil: "networkidle0" });
await p.evaluate(() => {
  const done = {};
  for (let i = 1; i <= 12; i++) done[i] = true;
  localStorage.setItem("alifellow.progress.v1", JSON.stringify({ done, last: { caseN: 12, index: 0 } }));
});
await p.reload({ waitUntil: "networkidle0" });
await settle();
const idx = await pills("[data-case-pill]");
ok("every case pill is filled when all 12 are complete",
   idx.total === 12 && idx.filled === 12, JSON.stringify(idx));

// a case: exhaust the last slide
await p.evaluate(() => localStorage.removeItem("alifellow.progress.v1"));
await p.goto(`${BASE}/#/c/5`, { waitUntil: "networkidle0" });
await settle();
const total = await p.$$eval("[data-slide-nav]", (els) => els.length);
await p.evaluate((n) => document.querySelector(`[data-slide-nav="${n - 1}"]`)?.click(), total);
await settle(400);
let casePills = await pills("[data-pill]");
ok("the pills track the slide you are on", casePills.total === total && casePills.filled === total,
   JSON.stringify(casePills));
// advance until the case is finished (the forward control turns into "Next case"): pressing
// further would move on to the next case, which is a different progress bar
for (let i = 0; i < 12; i++) {
  const label = await p.$eval("[data-forward]", (e) => e.getAttribute("aria-label") ?? "");
  if (label === "Next case") break;
  await p.keyboard.press("ArrowRight");
  await settle(250);
}
casePills = await pills("[data-pill]");
ok("and they stay filled at the end of the case", casePills.filled === casePills.total, JSON.stringify(casePills));
await b.close();
