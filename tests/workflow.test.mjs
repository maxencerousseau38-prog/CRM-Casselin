// Test de bout en bout du workflow complet + fonctionnement hors ligne.
// Lance un serveur statique local, pilote Chromium via Playwright.
import { chromium } from "playwright";
import { spawn } from "child_process";
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8137;
const BASE = `http://localhost:${PORT}/index.html`;

let passed = 0, failed = 0;
function ok(cond, msg) {
  if (cond) { passed++; console.log("  ✓ " + msg); }
  else { failed++; console.error("  ✗ " + msg); }
}

const server = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: root, stdio: "ignore" });
await new Promise((r) => setTimeout(r, 800));

const userDataDir = mkdtempSync(join(tmpdir(), "casselin-test-"));
let context = await chromium.launchPersistentContext(userDataDir, {
  executablePath: "/opt/pw-browsers/chromium",
  acceptDownloads: true,
});

async function newPage() {
  const page = await context.newPage();
  page.on("dialog", (d) => d.accept());
  return page;
}

let backupJson = null;

try {
  let page = await newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });

  // ---------- 1. Dashboard initial ----------
  console.log("\n[1] Dashboard");
  ok((await page.locator(".view__title").textContent()).includes("Tableau de bord"), "Dashboard affiché");

  // ---------- 2. Créer un salon ----------
  console.log("\n[2] Créer un salon");
  await page.click('.tabbar__item[data-route="salons"]');
  await page.click('a.cta[href="#/salon/new"]');
  await page.fill('input[name="nom"]', "Sirha Lyon 2026");
  await page.fill('input[name="ville"]', "Lyon");
  await page.fill('input[name="pays"]', "France");
  await page.click("#save");
  await page.waitForSelector(".salon-card");
  ok((await page.locator(".salon-card__name").first().textContent()).includes("Sirha"), "Salon créé et listé");
  ok(await page.locator(".salon-card.is-active .pill-active").count() > 0, "Salon devenu actif automatiquement");
  ok((await page.locator("#header-salon").textContent()).includes("Sirha"), "Salon actif visible dans le header");

  // ---------- 3. Créer contacts (Enregistrer & nouveau) ----------
  console.log("\n[3] Enregistrement rapide de contacts");
  async function fillContact({ prenom, nom, entreprise, ville, interet }) {
    await page.fill('input[name="prenom"]', prenom);
    await page.fill('input[name="nom"]', nom);
    await page.fill('input[name="entreprise"]', entreprise);
    await page.fill('input[name="ville"]', ville || "");
    if (interet) await page.click(`.seg--interet button[data-v="${interet}"]`);
  }

  await page.click('.tabbar__item[data-route="new"]');
  await page.waitForSelector('input[name="prenom"]');
  // Le salon actif doit être présélectionné
  ok(await page.locator('select[name="salonId"]').evaluate((el) => el.selectedIndex > 0), "Salon actif présélectionné dans le formulaire");

  async function saveAndNew() {
    await page.click("#save-new");
    // Attendre que le toast confirme puis que le formulaire soit réinitialisé.
    await page.waitForFunction(() => {
      var t = document.getElementById("toast");
      var p = document.querySelector('input[name="prenom"]');
      return t && t.textContent.includes("nouveau") && p && p.value === "";
    });
  }

  await fillContact({ prenom: "Marie", nom: "Durand", entreprise: "Bistrot du Port", ville: "Marseille", interet: "Fort" });
  await saveAndNew();
  ok(true, "Contact 1 enregistré via 'Enregistrer & nouveau' (toast + formulaire vierge)");
  ok((await page.locator('input[name="prenom"]').inputValue()) === "", "Formulaire réinitialisé pour le contact suivant");

  await fillContact({ prenom: "Karim", nom: "Benali", entreprise: "Resto Group", ville: "Lyon", interet: "Moyen" });
  await saveAndNew();

  await fillContact({ prenom: "Sophie", nom: "Martin", entreprise: "Hôtel Alpin", ville: "Grenoble", interet: "Fort" });
  await page.click("#save"); // dernier : enregistrer simple → détail
  await page.waitForFunction(() => {
    var v = document.getElementById("view");
    return v && v.querySelector(".detail__name") && v.textContent.includes("Sophie");
  });
  ok(true, "3e contact enregistré, fiche détail Sophie ouverte");

  // ---------- 4. Liste + recherche ----------
  console.log("\n[4] Liste et recherche instantanée");
  await page.click('.tabbar__item[data-route="contacts"]');
  await page.waitForSelector(".card");
  ok(await page.locator(".list .card").count() === 3, "3 contacts dans la liste");
  await page.fill("#q", "durand");
  await page.waitForTimeout(200);
  ok(await page.locator(".list .card").count() === 1, "Recherche 'durand' → 1 résultat");
  await page.fill("#q", "");
  await page.waitForTimeout(200);
  // Filtre intérêt Fort
  await page.click('.chip[data-interet="Fort"]');
  await page.waitForTimeout(150);
  ok(await page.locator(".list .card").count() === 2, "Filtre intérêt Fort → 2 résultats");
  await page.click('.chip[data-interet=""]');
  await page.waitForTimeout(150);

  // ---------- 5. Modifier un contact ----------
  console.log("\n[5] Modification");
  await page.fill("#q", "karim");
  await page.waitForTimeout(200);
  await page.click(".list .card");
  await page.waitForSelector(".detail__name");
  await page.click('a.btn[href$="/edit"]');
  await page.waitForSelector('input[name="fonction"]');
  await page.fill('input[name="fonction"]', "Directeur achats");
  await page.fill('input[name="email"]', "karim@resto-group.fr");
  await page.click("#save");
  await page.waitForSelector(".info");
  ok((await page.locator("#view").textContent()).includes("Directeur achats"), "Modification enregistrée (fonction)");
  ok((await page.locator("#view").textContent()).includes("karim@resto-group.fr"), "Modification enregistrée (email)");

  // ---------- 6. Relances ----------
  console.log("\n[6] Relances");
  await page.click('.tabbar__item[data-route="relances"]');
  await page.waitForSelector(".view__title");
  const relanceCount = await page.locator('.list .card > button[data-done="0"]').count();
  ok(relanceCount >= 1, `Contacts à relancer présents (${relanceCount})`);
  await page.locator('button[data-toggle][data-done="0"]').first().click();
  await page.waitForSelector('button[data-toggle][data-done="1"]');
  ok(await page.locator('button[data-toggle][data-done="1"]').count() >= 1, "Relance marquée comme faite (passe en section Fait)");

  // ---------- 7. Persistance : fermer et rouvrir le contexte ----------
  console.log("\n[7] Persistance après fermeture complète");
  await context.close();
  context = await chromium.launchPersistentContext(userDataDir, {
    executablePath: "/opt/pw-browsers/chromium",
    acceptDownloads: true,
  });
  page = await newPage();
  await page.goto(BASE, { waitUntil: "networkidle" });
  await page.click('.tabbar__item[data-route="contacts"]');
  await page.waitForSelector(".card");
  ok(await page.locator(".list .card").count() === 3, "3 contacts retrouvés après fermeture/réouverture");
  ok((await page.locator("#header-salon").textContent()).includes("Sirha"), "Salon actif conservé");

  // Helpers de navigation robustes (via l'UI de l'app, jamais goto sur un hash).
  async function openExport() {
    await page.click('.tabbar__item[data-route="dashboard"]');
    await page.waitForFunction(() => document.querySelector(".view__title")?.textContent.includes("Tableau de bord"));
    await page.click('a[href="#/export"]');
    await page.waitForSelector("#csv-btn");
  }
  async function openContacts() {
    await page.click('.tabbar__item[data-route="contacts"]');
    await page.waitForSelector("#q");
    await page.fill("#q", ""); // réinitialise toute recherche persistante
    await page.waitForFunction(() => !!document.querySelector("#list"));
  }
  const countCards = () => page.locator("#list .card").count();

  // ---------- 8. Export CSV ----------
  console.log("\n[8] Export CSV");
  await openExport();
  const [csvDl] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#csv-btn"),
  ]);
  const csvPath = join(userDataDir, "export.csv");
  await csvDl.saveAs(csvPath);
  const csv = (await import("fs")).readFileSync(csvPath, "utf8");
  ok(csv.includes("Durand") && csv.includes("Benali") && csv.includes("Martin"), "CSV contient les 3 contacts");
  ok(csv.includes("sep=;") && csv.charCodeAt(0) === 0xFEFF, "CSV a le BOM + sep=; (Excel FR)");
  ok(csv.split(/\r?\n/).length >= 5, "CSV a bien les lignes attendues");

  // ---------- 9. Sauvegarde JSON ----------
  console.log("\n[9] Sauvegarde JSON");
  const [jsonDl] = await Promise.all([
    page.waitForEvent("download"),
    page.click("#json-btn"),
  ]);
  const jsonPath = join(userDataDir, "backup.json");
  await jsonDl.saveAs(jsonPath);
  backupJson = (await import("fs")).readFileSync(jsonPath, "utf8");
  const parsed = JSON.parse(backupJson);
  ok(parsed.contacts.length === 3 && parsed.salons.length === 1, "Sauvegarde JSON complète (3 contacts, 1 salon)");

  // ---------- 10. Restauration JSON ----------
  console.log("\n[10] Restauration JSON après suppression");
  // Supprimer Sophie
  await openContacts();
  await page.fill("#q", "sophie");
  await page.waitForFunction(() => document.querySelectorAll("#list .card").length === 1);
  await page.click("#list .card");
  await page.waitForSelector("#del");
  await page.click("#del"); // confirm auto-accepté → retour liste
  await openContacts();
  await page.waitForFunction(() => document.querySelectorAll("#list .card").length === 2);
  ok(await countCards() === 2, "Contact supprimé → 2 restants");

  // Réimporter la sauvegarde
  const restorePath = join(userDataDir, "restore.json");
  writeFileSync(restorePath, backupJson);
  await openExport();
  await page.setInputFiles("#json-file", restorePath); // confirm auto-accepté → go dashboard
  await page.waitForFunction(() => document.querySelector(".view__title")?.textContent.includes("Tableau de bord"));
  await openContacts();
  await page.waitForFunction(() => document.querySelectorAll("#list .card").length === 3);
  ok(await countCards() === 3, "Restauration JSON → 3 contacts retrouvés");

  // ---------- 11. Hors ligne ----------
  console.log("\n[11] Fonctionnement hors ligne");
  // S'assurer que le SW est actif
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.waitForTimeout(500);
  await context.setOffline(true);
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".view__title", { timeout: 5000 });
  ok((await page.locator(".view__title").textContent()).includes("Tableau de bord"), "App chargée HORS LIGNE (app shell en cache)");
  await page.click('.tabbar__item[data-route="contacts"]');
  await page.waitForSelector("#q");
  await page.fill("#q", "");
  await page.waitForFunction(() => document.querySelectorAll("#list .card").length === 3);
  ok(await page.locator("#list .card").count() === 3, "Données lisibles HORS LIGNE (IndexedDB)");
  await context.setOffline(false);

  // ---------- 12. Gestion des salons (modifier / archiver / désarchiver / supprimer) ----------
  console.log("\n[12] Gestion complète des salons");
  async function openSalonMenu() {
    const d = page.locator(".salon-card .menu").first();
    await d.locator(".menu__btn").click();
    await d.locator(".menu__list").waitFor({ state: "visible" });
    return d;
  }
  async function openSalons() {
    await page.click('.tabbar__item[data-route="salons"]');
    await page.waitForSelector(".salon-card, .empty");
  }

  // Modifier
  await openSalons();
  let menu = await openSalonMenu();
  await menu.locator('a.menu__item[href$="/edit"]').click();
  await page.waitForSelector('input[name="ville"]');
  await page.fill('input[name="ville"]', "Villeurbanne");
  await page.click("#save");
  await page.waitForSelector(".salon-card");
  ok((await page.locator(".salon-card").first().textContent()).includes("Villeurbanne"), "Salon modifié (ville mise à jour)");

  // Archiver le salon actif
  menu = await openSalonMenu();
  await menu.locator("button[data-archive]").click();
  await page.waitForFunction(() => document.getElementById("toggle-archived"));
  ok((await page.locator("#view").textContent()).includes("Aucun salon actif"), "Salon archivé → retiré de la liste active");
  ok(!(await page.locator("#header-salon").textContent()).includes("Sirha"), "Salon actif désélectionné après archivage");
  ok(await page.locator("#toggle-archived").count() === 1, "Bouton d'affichage des archivés présent");

  // Afficher les archivés + désarchiver
  await page.click("#toggle-archived");
  await page.waitForSelector(".salon-card.is-archived");
  ok(await page.locator(".salon-card.is-archived").count() === 1, "Salon visible dans la section Archivés");
  menu = await openSalonMenu();
  await menu.locator("button[data-archive]").click();
  await page.waitForFunction(() => !document.querySelector(".salon-card.is-archived") && document.querySelector(".salon-card"));
  ok(await page.locator(".salon-card.is-archived").count() === 0, "Salon désarchivé → revenu dans la liste active");
  ok(await page.locator("#toggle-archived").count() === 0, "Plus aucun salon archivé");

  // Supprimer le salon (contacts conservés)
  menu = await openSalonMenu();
  await menu.locator("button[data-del]").click(); // confirm auto-accepté
  await page.waitForFunction(() => document.querySelector("#view").textContent.includes("Aucun salon actif"));
  ok((await page.locator("#view").textContent()).includes("Aucun salon actif"), "Salon supprimé");

  // Les contacts existent toujours et ne sont plus associés au salon supprimé
  await openContacts();
  await page.waitForFunction(() => document.querySelectorAll("#list .card").length === 3);
  ok(await countCards() === 3, "Contacts CONSERVÉS après suppression du salon (3 restants)");
  ok(!(await page.locator("#list").textContent()).includes("Sirha Lyon 2026"), "Contacts détachés du salon supprimé (aucun badge salon)");

} catch (err) {
  failed++;
  console.error("\nERREUR DE TEST:", err);
  try {
    const pages = context.pages();
    if (pages.length) console.error("VIEW HTML:\n", (await pages[pages.length - 1].locator("#view").innerHTML()).slice(0, 600));
  } catch {}
} finally {
  await context.close();
  server.kill();
  try { rmSync(userDataDir, { recursive: true, force: true }); } catch {}
}

console.log(`\n==== Résultat : ${passed} réussis, ${failed} échoués ====`);
process.exit(failed ? 1 : 0);
