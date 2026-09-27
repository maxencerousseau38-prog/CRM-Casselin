# Casselin CRM — Salons

Mini-application CRM **interne**, **hors ligne** et **installable (PWA)**, conçue pour les
commerciaux Casselin pendant les salons professionnels. Elle remplace les fiches
papier : on saisit un contact en quelques secondes, on enregistre, et on passe
immédiatement au suivant.

## Points clés

- **100 % hors ligne** : aucune connexion requise après le premier chargement (service worker).
- **Aucun compte, aucun backend, aucune API** : tout reste sur l'appareil.
- **Stockage fiable via IndexedDB** : les données persistent après fermeture / rechargement.
- **PWA installable** sur téléphone, tablette et ordinateur (« Ajouter à l'écran d'accueil »).
- **Aucune donnée envoyée à un service externe.**
- **Export CSV** (compatible Excel FR) + **sauvegarde / restauration JSON**.

## Utilisation

Aucune installation, aucun build. Ouvrez `index.html` via un serveur HTTP local :

```bash
npm start        # sert le dossier sur http://localhost:8080 (python3 -m http.server)
```

Puis ouvrez `http://localhost:8080/` dans un navigateur. Pour un usage réel,
hébergez le dossier sur n'importe quel serveur statique **en HTTPS** (requis pour
l'installation PWA et le service worker) et installez l'app depuis le navigateur.

> Le premier chargement doit se faire en ligne (mise en cache). Ensuite, l'app
> fonctionne entièrement hors ligne.

## Workflow principal (rapidité avant tout)

1. **Salons** → créer / sélectionner le salon actif.
2. **+** (bouton central) → saisir les infos essentielles d'un contact.
3. **Enregistrer & nouveau** → enchaîner les contacts sans repasser par l'accueil.
4. **Contacts** → recherche instantanée, filtres (type / intérêt), tri, fiche détaillée, modification, suppression.
5. **Relances** → contacts à recontacter, bascule À faire / Fait.
6. **Export** → CSV (tous ou par salon) + sauvegarde JSON + restauration JSON.

Aucun champ n'est inutilement obligatoire : un contact peut être enregistré avec
seulement un nom, une entreprise ou un moyen de contact.

## Champs d'un contact

Prénom, Nom, Entreprise, Fonction, Email, Téléphone, Ville, Pays, Type
(Revendeur / Distributeur / Client / Prospect / Autre), Intérêt (Faible / Moyen / Fort),
Produits intéressants, Notes, Prochaine action (À contacter / Catalogue / Tarif /
Devis / Relance / Rien), Date de relance, Salon, Date de rencontre.

## Structure du projet

```
index.html              Coquille de l'app + navigation
css/styles.css          Design premium B2B (sombre, sobre, mobile-first)
js/db.js                Couche de stockage IndexedDB (contacts, salons, méta, export/import)
js/app.js               Routing, vues et logique métier (vanilla JS, sans dépendance)
sw.js                   Service worker (app shell en cache = hors ligne)
manifest.webmanifest    Manifeste PWA (installable)
icons/                  Icônes (SVG source + PNG 192/512/maskable)
scripts/gen-icons.mjs   Régénère les PNG à partir du SVG
tests/workflow.test.mjs Test de bout en bout du workflow + hors ligne (Playwright)
```

## Tests

Le test automatisé pilote un vrai navigateur (Chromium) et vérifie le workflow
complet exigé : créer salon → créer contacts (Enregistrer & nouveau) → rechercher
→ filtrer → modifier → relances → **fermer/rouvrir et retrouver les données** →
exporter CSV → sauvegarder/restaurer JSON → **fonctionnement hors ligne**.

```bash
npm test         # 25 assertions, 0 dépendance réseau externe
npm run icons    # régénère les icônes PNG depuis icons/icon.svg
```

## Sauvegarde & transfert

- **Sauvegarde JSON** : bouton dans *Export & sauvegarde*. Fichier complet
  (contacts + salons) à archiver ou transférer.
- **Restauration** : importer un fichier JSON (fusion avec l'existant, même
  identifiant = mise à jour). Idéal pour consolider les saisies de plusieurs
  appareils après un salon.
