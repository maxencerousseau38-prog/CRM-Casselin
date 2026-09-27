/* Casselin CRM — Couche de stockage IndexedDB (100% local, hors ligne). */
(function (global) {
  "use strict";

  var DB_NAME = "casselin-crm";
  var DB_VERSION = 1;
  var STORE_CONTACTS = "contacts";
  var STORE_SALONS = "salons";
  var STORE_META = "meta";

  var _dbPromise = null;

  function openDB() {
    if (_dbPromise) return _dbPromise;
    _dbPromise = new Promise(function (resolve, reject) {
      if (!global.indexedDB) {
        reject(new Error("IndexedDB non disponible sur cet appareil."));
        return;
      }
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        if (!db.objectStoreNames.contains(STORE_CONTACTS)) {
          var c = db.createObjectStore(STORE_CONTACTS, { keyPath: "id" });
          c.createIndex("salonId", "salonId", { unique: false });
          c.createIndex("type", "type", { unique: false });
          c.createIndex("interet", "interet", { unique: false });
          c.createIndex("updatedAt", "updatedAt", { unique: false });
        }
        if (!db.objectStoreNames.contains(STORE_SALONS)) {
          db.createObjectStore(STORE_SALONS, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_META)) {
          db.createObjectStore(STORE_META, { keyPath: "key" });
        }
      };
      req.onsuccess = function (e) { resolve(e.target.result); };
      req.onerror = function () { reject(req.error || new Error("Ouverture IndexedDB impossible.")); };
    });
    return _dbPromise;
  }

  function tx(storeNames, mode) {
    return openDB().then(function (db) {
      var t = db.transaction(storeNames, mode);
      return t;
    });
  }

  function reqAsPromise(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror = function () { reject(request.error); };
    });
  }

  function txDone(t) {
    return new Promise(function (resolve, reject) {
      t.oncomplete = function () { resolve(); };
      t.onerror = function () { reject(t.error); };
      t.onabort = function () { reject(t.error || new Error("Transaction annulée.")); };
    });
  }

  function uuid() {
    if (global.crypto && global.crypto.randomUUID) return global.crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  /* ---------- Contacts ---------- */
  function getAllContacts() {
    return tx(STORE_CONTACTS, "readonly").then(function (t) {
      return reqAsPromise(t.objectStore(STORE_CONTACTS).getAll());
    });
  }

  function getContact(id) {
    return tx(STORE_CONTACTS, "readonly").then(function (t) {
      return reqAsPromise(t.objectStore(STORE_CONTACTS).get(id));
    });
  }

  function saveContact(contact) {
    var now = new Date().toISOString();
    var rec = Object.assign({}, contact);
    if (!rec.id) { rec.id = uuid(); rec.createdAt = now; }
    if (!rec.createdAt) rec.createdAt = now;
    rec.updatedAt = now;
    if (typeof rec.relanceFaite !== "boolean") rec.relanceFaite = false;
    return tx(STORE_CONTACTS, "readwrite").then(function (t) {
      t.objectStore(STORE_CONTACTS).put(rec);
      return txDone(t).then(function () { return rec; });
    });
  }

  function deleteContact(id) {
    return tx(STORE_CONTACTS, "readwrite").then(function (t) {
      t.objectStore(STORE_CONTACTS).delete(id);
      return txDone(t);
    });
  }

  /* ---------- Salons ---------- */
  function getAllSalons() {
    return tx(STORE_SALONS, "readonly").then(function (t) {
      return reqAsPromise(t.objectStore(STORE_SALONS).getAll());
    });
  }

  function getSalon(id) {
    if (!id) return Promise.resolve(null);
    return tx(STORE_SALONS, "readonly").then(function (t) {
      return reqAsPromise(t.objectStore(STORE_SALONS).get(id));
    });
  }

  function saveSalon(salon) {
    var now = new Date().toISOString();
    var rec = Object.assign({}, salon);
    if (!rec.id) { rec.id = uuid(); rec.createdAt = now; }
    rec.updatedAt = now;
    return tx(STORE_SALONS, "readwrite").then(function (t) {
      t.objectStore(STORE_SALONS).put(rec);
      return txDone(t).then(function () { return rec; });
    });
  }

  // Archive / désarchive un salon (les contacts et l'association ne changent pas).
  function setSalonArchived(id, archived) {
    return getSalon(id).then(function (s) {
      if (!s) return null;
      s.archived = !!archived;
      return saveSalon(s);
    });
  }

  // Supprime un salon SANS supprimer ses contacts : les contacts associés sont
  // simplement détachés (salonId vidé) et restent dans IndexedDB.
  function deleteSalon(id) {
    return openDB().then(function (db) {
      var t = db.transaction([STORE_SALONS, STORE_CONTACTS], "readwrite");
      t.objectStore(STORE_SALONS).delete(id);
      var cStore = t.objectStore(STORE_CONTACTS);
      var cursorReq = cStore.index("salonId").openCursor(IDBKeyRange.only(id));
      cursorReq.onsuccess = function (e) {
        var cur = e.target.result;
        if (!cur) return;
        var c = cur.value;
        c.salonId = "";
        c.updatedAt = new Date().toISOString();
        cur.update(c);
        cur.continue();
      };
      return txDone(t);
    });
  }

  /* ---------- Meta (salon actif, etc.) ---------- */
  function getMeta(key) {
    return tx(STORE_META, "readonly").then(function (t) {
      return reqAsPromise(t.objectStore(STORE_META).get(key));
    }).then(function (r) { return r ? r.value : null; });
  }

  function setMeta(key, value) {
    return tx(STORE_META, "readwrite").then(function (t) {
      t.objectStore(STORE_META).put({ key: key, value: value });
      return txDone(t);
    });
  }

  /* ---------- Export / Import complet ---------- */
  function exportAll() {
    return Promise.all([getAllContacts(), getAllSalons(), getMeta("activeSalonId")])
      .then(function (res) {
        return {
          app: "casselin-crm",
          version: DB_VERSION,
          exportedAt: new Date().toISOString(),
          activeSalonId: res[2] || null,
          salons: res[1],
          contacts: res[0]
        };
      });
  }

  // Versions de sauvegarde acceptées à l'import.
  var SUPPORTED_VERSIONS = [1];

  // Valide la forme d'une sauvegarde AVANT toute écriture.
  // Retourne { valid: bool, error: string|null }.
  function validateBackup(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return { valid: false, error: "Fichier de sauvegarde invalide." };
    }
    if (data.app !== "casselin-crm") {
      return { valid: false, error: "Ce fichier n'est pas une sauvegarde Casselin CRM." };
    }
    if (typeof data.version !== "number" || SUPPORTED_VERSIONS.indexOf(data.version) === -1) {
      return { valid: false, error: "Version de sauvegarde non supportée." };
    }
    if (!Array.isArray(data.contacts) || !Array.isArray(data.salons)) {
      return { valid: false, error: "Fichier de sauvegarde invalide (contacts / salons)." };
    }
    return { valid: true, error: null };
  }

  // Importe une sauvegarde. mode: "merge" (défaut) ou "replace".
  //  - merge   : upsert par id, conserve les données locales absentes du fichier.
  //  - replace : vide contacts + salons, réécrit meta (activeSalonId) depuis le fichier.
  // Valide AVANT toute écriture ; aucune écriture partielle si invalide.
  // Résout avec un récapitulatif { mode, contactsAdded, contactsUpdated, salonsAdded, salonsUpdated }.
  function importAll(data, mode) {
    var v = validateBackup(data);
    if (!v.valid) return Promise.reject(new Error(v.error));
    mode = mode === "replace" ? "replace" : "merge";
    var summary = { mode: mode, contactsAdded: 0, contactsUpdated: 0, salonsAdded: 0, salonsUpdated: 0 };

    return openDB().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction([STORE_CONTACTS, STORE_SALONS, STORE_META], "readwrite");
        var cStore = t.objectStore(STORE_CONTACTS);
        var sStore = t.objectStore(STORE_SALONS);
        var mStore = t.objectStore(STORE_META);
        var existingC = {}, existingS = {};

        cStore.getAllKeys().onsuccess = function (e1) {
          (e1.target.result || []).forEach(function (k) { existingC[k] = true; });
          sStore.getAllKeys().onsuccess = function (e2) {
            (e2.target.result || []).forEach(function (k) { existingS[k] = true; });
            applyWrites();
          };
        };

        function applyWrites() {
          if (mode === "replace") { cStore.clear(); sStore.clear(); }
          data.salons.forEach(function (s) {
            if (!s || !s.id) return;
            if (mode === "replace" || !existingS[s.id]) summary.salonsAdded++; else summary.salonsUpdated++;
            sStore.put(s);
          });
          data.contacts.forEach(function (c) {
            if (!c || !c.id) return;
            if (mode === "replace" || !existingC[c.id]) summary.contactsAdded++; else summary.contactsUpdated++;
            cStore.put(c);
          });
          if (mode === "replace") {
            if (data.activeSalonId) mStore.put({ key: "activeSalonId", value: data.activeSalonId });
            else mStore.delete("activeSalonId");
          } else if (data.activeSalonId) {
            mStore.put({ key: "activeSalonId", value: data.activeSalonId });
          }
        }

        t.oncomplete = function () { resolve(summary); };
        t.onerror = function () { reject(t.error || new Error("Import impossible.")); };
        t.onabort = function () { reject(t.error || new Error("Import annulé.")); };
      });
    });
  }

  global.CasselinDB = {
    uuid: uuid,
    getAllContacts: getAllContacts,
    getContact: getContact,
    saveContact: saveContact,
    deleteContact: deleteContact,
    getAllSalons: getAllSalons,
    getSalon: getSalon,
    saveSalon: saveSalon,
    setSalonArchived: setSalonArchived,
    deleteSalon: deleteSalon,
    getMeta: getMeta,
    setMeta: setMeta,
    exportAll: exportAll,
    validateBackup: validateBackup,
    importAll: importAll
  };
})(window);
