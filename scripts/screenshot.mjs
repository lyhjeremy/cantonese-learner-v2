// Capture showcase screenshots into docs/. Best-effort: needs Playwright.
import { chromium } from "playwright";
import { startServer } from "./serve.mjs";
import { fileURLToPath } from "node:url";

const docs = (name) => fileURLToPath(new URL(`../docs/${name}`, import.meta.url));
const { server, port } = await startServer(0);
const base = `http://localhost:${port}/`;
const browser = await chromium.launch();

async function shot(theme) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(base, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => window.__CFL_READY === true, { timeout: 15000 });
  if (theme === "dark") await page.click("#theme-btn");
  await page.waitForTimeout(300);
  await page.screenshot({ path: docs(`list-${theme}.png`) });
  await page.click("#cards .card:first-child");
  await page.waitForTimeout(400);
  await page.screenshot({ path: docs(`reader-${theme}.png`) });
  await page.close();
}

await shot("light");
await shot("dark");
await browser.close();
server.close();
console.log("screenshots written to docs/");
