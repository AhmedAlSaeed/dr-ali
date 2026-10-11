/** The progress bars must reach 100%: the index when all cases are done, and a case when its
 *  last slide has been fully revealed. */
import puppeteer from "puppeteer-core";
const BASE = process.argv[2] ?? "http://localhost:4187";
const b = await puppeteer.launch({ executablePath: "/usr/bin/chromium", headless: "shell", args: ["--no-sandbox"] });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 900 });
const settle = (ms = 500) => new Promise((r) => setTimeout(r, ms));
const ok = (l, pass, extra = "") => console.log(`  ${pass ? "PASS" : "FAIL"}  ${l}${extra ? "  " + extra : ""}`);
const barWidths = () =>
  p.evaluate(() =>
    [...document.querySelectorAll('[role="progressbar"]')].map((el) => {
      const inner = el.firstElementChild;
      return {
        aria: el.getAttribute("aria-valuenow"),
        pct: Math.round((inner.getBoundingClientRect().width / el.getBoundingClientRect().width) * 100),
      };
    }),
  );

// index with every case complete
await p.goto(`${BASE}/#/`, { waitUntil: "networkidle0" });
await p.evaluate(() => {
  const done = {};
  for (let i = 1; i <= 12; i++) done[i] = true;
  localStorage.setItem("alifellow.progress.v1", JSON.stringify({ done, last: { caseN: 12, index: 0 } }));
});
await p.reload({ waitUntil: "networkidle0" });
await settle();
const idx = await barWidths();
ok("index bar full when all 12 cases are complete", idx[0]?.pct === 100 && idx[0]?.aria === "100", JSON.stringify(idx[0]));

// a case: exhaust the last slide
await p.evaluate(() => localStorage.removeItem("alifellow.progress.v1"));
await p.goto(`${BASE}/#/c/5`, { waitUntil: "networkidle0" });
await settle();
const total = await p.$$eval("[data-slide-nav]", (els) => els.length);
await p.evaluate((n) => document.querySelector(`[data-slide-nav="${n - 1}"]`)?.click(), total);
await settle(400);
let bar = (await barWidths()).at(-1);
ok("case bar not full on its last slide before the reveal", (bar?.pct ?? 0) < 100, JSON.stringify(bar));
for (let i = 0; i < 4; i++) {
  await p.keyboard.press("ArrowRight");
  await settle(250);
}
bar = (await barWidths()).at(-1);
ok("case bar reaches 100% once the last slide is exhausted", bar?.pct === 100, JSON.stringify(bar));
await b.close();
