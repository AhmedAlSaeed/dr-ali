/** The primary control: label and destination at each point of a case. */
import puppeteer from "puppeteer-core";
const BASE = process.argv[2] ?? "http://localhost:4187";
const b = await puppeteer.launch({ executablePath: "/usr/bin/chromium", headless: "shell", args: ["--no-sandbox"] });
const p = await b.newPage();
await p.setViewport({ width: 1280, height: 900 });
const settle = (ms = 700) => new Promise((r) => setTimeout(r, ms));
const ok = (l, pass, extra = "") => console.log(`  ${pass ? "PASS" : "FAIL"}  ${l}${extra ? "  " + extra : ""}`);
const label = async () => {
  await p.waitForSelector("[data-forward]", { timeout: 8000 });
  return p.$eval("[data-forward]", (e) => e.getAttribute("aria-label") ?? "");
};
const clickForward = () => p.click("[data-forward]");
const hash = () => p.evaluate(() => location.hash);
const slideIndex = () => p.$eval("[data-slide-index]", (e) => e.getAttribute("data-slide-index"));
const hasCaseMenu = async () => !!(await p.$('button[aria-haspopup="listbox"]'));

await p.goto(`${BASE}/#/c/3`, { waitUntil: "networkidle0" });
await settle(1100);
ok("mid-case the header control says Next", (await label()) === "Next", await label());
ok("the header keeps the case menu for jumping between cases", await hasCaseMenu());

// press until the case is finished: one more press would move into the next case
let endLabel = "";
for (let i = 0; i < 30; i++) {
  endLabel = await label();
  if (endLabel === "Next case") break;
  await p.keyboard.press("ArrowRight");
  await settle(140);
}
ok("at the end it says Next case", endLabel === "Next case", endLabel);
ok("and the forward control is the only Next case affordance", (await p.$$('[data-forward]')).length === 1);

await clickForward();
await settle(800);
ok("clicking it opens the next case at its first slide",
   (await hash()) === "#/c/4" && (await slideIndex()) === "0",
   `${await hash()} slide index ${await slideIndex()}`);

// the last case has nowhere to go next
await p.goto(`${BASE}/#/c/12`, { waitUntil: "networkidle0" });
await settle(900);
// walk to the end of the last case: further presses would leave it, so stop at the last slide
let lastLabel = "";
for (let i = 0; i < 30; i++) {
  lastLabel = await label();
  if (lastLabel === "Back to index" || lastLabel === "Next case") break;
  await p.keyboard.press("ArrowRight");
  await settle(140);
}
ok("on the last case it says Back to index", lastLabel === "Back to index", lastLabel);
await clickForward();
await settle(700);
ok("clicking it returns to the index", (await hash()) === "#/", await hash());

// completed case: the diagnosis now uses the exact names
await p.evaluate(() => localStorage.setItem("alifellow.progress.v1", JSON.stringify({ done: { 1: true, 2: true, 12: true }, last: { caseN: 1, index: 0 } })));
await p.goto(`${BASE}/#/`, { waitUntil: "networkidle0" });
await p.reload({ waitUntil: "networkidle0" });   // the store is read on mount
await settle(900);
const names = await p.$$eval("[data-case-card]", (els) => els.map((e) => (e.textContent ?? "").replace(/\s+/g, " ").trim()));
ok("index shows the new names once complete",
   names[0].includes("Acute Necrotizing Encephalopathy") && names[1].includes("Reperfusion Injury") && names[11].includes("Thyroglossal Duct Cyst Ca"),
   `${names[0].slice(0, 40)} | ${names[1].slice(0, 26)} | ${names[11].slice(0, 30)}`);
await b.close().catch(() => {});
process.exit(0);
