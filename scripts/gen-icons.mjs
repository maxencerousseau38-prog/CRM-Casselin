// Génère les icônes PNG (192, 512, maskable 512) à partir du SVG, via Chromium.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const svg = readFileSync(resolve(root, "icons/icon.svg"), "utf8");

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });

async function render(size, { maskable = false } = {}) {
  const page = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
  // Pour maskable : on garde une marge de sécurité (safe zone ~80%).
  const scale = maskable ? 0.8 : 1;
  const html = `<!doctype html><html><body style="margin:0;background:#15181c">
    <div style="width:${size}px;height:${size}px;display:grid;place-items:center;background:#15181c">
      <div style="width:${Math.round(size * scale)}px;height:${Math.round(size * scale)}px">${svg}</div>
    </div></body></html>`;
  await page.setContent(html);
  const buf = await page.locator("body").screenshot({ type: "png" });
  await page.close();
  return buf;
}

writeFileSync(resolve(root, "icons/icon-192.png"), await render(192));
writeFileSync(resolve(root, "icons/icon-512.png"), await render(512));
writeFileSync(resolve(root, "icons/icon-maskable-512.png"), await render(512, { maskable: true }));

await browser.close();
console.log("Icônes PNG générées : 192, 512, maskable-512.");
