/* Casselin CRM — Application (routing + vues + logique métier). Vanilla JS, hors ligne. */
(function () {
  "use strict";

  var DB = window.CasselinDB;
  var view = document.getElementById("view");
  var toastEl = document.getElementById("toast");
  var headerSalon = document.getElementById("header-salon");

  var TYPES = ["Revendeur", "Distributeur", "Client", "Prospect", "Autre"];
  var INTERETS = ["Faible", "Moyen", "Fort"];
  var ACTIONS = ["Rien", "À contacter", "Catalogue", "Tarif", "Devis", "Relance"];

  /* ---------- Utilitaires ---------- */
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function toast(msg, kind) {
    toastEl.textContent = msg;
    toastEl.className = "toast is-show" + (kind ? " toast--" + kind : "");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { toastEl.className = "toast"; }, 2400);
  }

  function initials(c) {
    var a = (c.prenom || "").trim().charAt(0);
    var b = (c.nom || "").trim().charAt(0);
    var s = (a + b).toUpperCase();
    if (s) return s;
    return (c.entreprise || "?").trim().charAt(0).toUpperCase() || "?";
  }

  function fullName(c) {
    var n = ((c.prenom || "") + " " + (c.nom || "")).trim();
    return n || c.entreprise || "Contact sans nom";
  }

  function fmtDate(iso) {
    if (!iso) return "";
    var parts = String(iso).slice(0, 10).split("-");
    if (parts.length !== 3) return iso;
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  }

  function todayISO() {
    var d = new Date();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return d.getFullYear() + "-" + m + "-" + day;
  }

  function needsRelance(c) {
    return !!c.prochaineAction && c.prochaineAction !== "Rien" && !c.relanceFaite;
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function download(filename, content, mime) {
    var blob = new Blob([content], { type: mime || "application/octet-stream" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { document.body.removeChild(a); URL.revokeObjectURL(url); }, 100);
  }

  function slug(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "export";
  }

  /* ---------- Router ---------- */
  var routes = [];
  function route(pattern, handler) {
    var keys = [];
    var rx = new RegExp("^" + pattern.replace(/:[^/]+/g, function (m) {
      keys.push(m.slice(1));
      return "([^/]+)";
    }) + "$");
    routes.push({ rx: rx, keys: keys, handler: handler });
  }

  function currentPath() {
    var h = location.hash.replace(/^#/, "");
    if (!h || h === "/") return "/";
    return h;
  }

  function navigate() {
    var path = currentPath();
    for (var i = 0; i < routes.length; i++) {
      var m = path.match(routes[i].rx);
      if (m) {
        var params = {};
        routes[i].keys.forEach(function (k, idx) { params[k] = decodeURIComponent(m[idx + 1]); });
        Promise.resolve(routes[i].handler(params)).catch(function (err) {
          console.error(err);
          view.innerHTML = '<p class="empty">Erreur : ' + esc(err.message || err) + "</p>";
        });
        updateTabs(path);
        view.focus();
        window.scrollTo(0, 0);
        return;
      }
    }
    location.hash = "#/";
  }

  function updateTabs(path) {
    var map = { "/": "dashboard" };
    var active = "dashboard";
    if (path === "/") active = "dashboard";
    else if (path.indexOf("/contact/new") === 0) active = "new";
    else if (path.indexOf("/contact") === 0) active = "contacts";
    else if (path.indexOf("/contacts") === 0) active = "contacts";
    else if (path.indexOf("/salon") === 0) active = "salons";
    else if (path.indexOf("/relances") === 0) active = "relances";
    else if (path.indexOf("/export") === 0) active = "";
    document.querySelectorAll(".tabbar__item").forEach(function (el) {
      el.classList.toggle("is-active", el.getAttribute("data-route") === active);
    });
  }

  function go(path) { location.hash = "#" + path; }

  /* ---------- Salon actif dans le header ---------- */
  function refreshHeaderSalon() {
    return DB.getMeta("activeSalonId").then(function (id) {
      if (!id) return DB.getSalon(null);
      return DB.getSalon(id);
    }).then(function (s) {
      if (s) {
        headerSalon.innerHTML = '<span class="salon-dot" aria-hidden="true"></span>' + esc(s.nom);
        headerSalon.classList.remove("is-empty");
      } else {
        headerSalon.textContent = "";
        headerSalon.classList.add("is-empty");
      }
    });
  }

  /* ---------- Vue : Dashboard ---------- */
  route("/", function () {
    return Promise.all([DB.getAllContacts(), DB.getMeta("activeSalonId"), DB.getAllSalons()])
      .then(function (res) {
        var contacts = res[0], activeId = res[1], salons = res[2];
        var total = contacts.length;
        var aRelancer = contacts.filter(needsRelance).length;
        var forts = contacts.filter(function (c) { return c.interet === "Fort"; }).length;
        var activeSalon = salons.filter(function (s) { return s.id === activeId; })[0];
        var salonName = activeSalon ? activeSalon.nom : "Aucun salon sélectionné";
        var salonContacts = activeSalon ? contacts.filter(function (c) { return c.salonId === activeId; }).length : 0;

        view.innerHTML =
          '<h1 class="view__title">Tableau de bord</h1>' +
          '<div class="stat-grid">' +
            '<a class="stat" href="#/contacts"><div class="stat__value">' + total + '</div><div class="stat__label">Contacts</div></a>' +
            '<a class="stat stat--warn" href="#/relances"><div class="stat__value">' + aRelancer + '</div><div class="stat__label">À relancer</div></a>' +
            '<a class="stat stat--hi" href="#/contacts?interet=Fort"><div class="stat__value">' + forts + '</div><div class="stat__label">Intérêt fort</div></a>' +
            '<a class="stat" href="#/salons"><div class="stat__value">' + salons.length + '</div><div class="stat__label">Salons</div></a>' +
            '<a class="stat stat--full" href="#/salons"><div class="stat__value">' + esc(salonName) + '</div><div class="stat__label">Salon actif' + (activeSalon ? " · " + salonContacts + " contact" + (salonContacts > 1 ? "s" : "") : "") + '</div></a>' +
          '</div>' +
          '<a class="cta" href="#/contact/new"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Nouveau contact</a>' +
          '<a class="btn btn--block btn--ghost" style="margin-top:12px" href="#/export">Export &amp; sauvegarde</a>';
      });
  });

  /* ---------- Vue : Liste contacts ---------- */
  var listState = { q: "", type: "", interet: "", sort: "recent" };

  route("/contacts", function () {
    // paramètres de requête éventuels (#/contacts?interet=Fort)
    var qs = location.hash.split("?")[1] || "";
    var params = new URLSearchParams(qs);
    if (params.get("interet")) listState.interet = params.get("interet");
    if (params.get("salon")) listState.salon = params.get("salon");
    return renderContacts();
  });

  function renderContacts() {
    return Promise.all([DB.getAllContacts(), DB.getAllSalons()]).then(function (res) {
      var contacts = res[0], salons = res[1];
      var salonMap = {};
      salons.forEach(function (s) { salonMap[s.id] = s; });

      view.innerHTML =
        '<h1 class="view__title">Contacts</h1>' +
        '<div class="toolbar">' +
          '<input class="search" id="q" type="search" inputmode="search" placeholder="Rechercher nom, entreprise, ville…" value="' + esc(listState.q) + '" />' +
          '<div class="chips" id="type-chips">' +
            typeChip("", "Tous") + TYPES.map(function (t) { return typeChip(t, t); }).join("") +
          '</div>' +
          '<div class="chips">' +
            interetChip("", "Intérêt : tous") +
            INTERETS.slice().reverse().map(function (t) { return interetChip(t, t); }).join("") +
            '<select class="select-inline" id="sort">' +
              opt("recent", "Récents", listState.sort) +
              opt("nom", "Nom A→Z", listState.sort) +
              opt("entreprise", "Entreprise A→Z", listState.sort) +
              opt("interet", "Intérêt", listState.sort) +
            '</select>' +
          '</div>' +
        '</div>' +
        '<div id="list"></div>';

      document.getElementById("q").addEventListener("input", debounce(function (e) {
        listState.q = e.target.value;
        paintList(contacts, salonMap);
      }, 120));
      document.getElementById("type-chips").addEventListener("click", function (e) {
        var c = e.target.closest(".chip"); if (!c) return;
        listState.type = c.getAttribute("data-v");
        document.querySelectorAll("#type-chips .chip").forEach(function (x) { x.classList.toggle("is-active", x === c); });
        paintList(contacts, salonMap);
      });
      view.querySelectorAll(".chip[data-interet]").forEach(function (c) {
        c.addEventListener("click", function () {
          listState.interet = c.getAttribute("data-interet");
          view.querySelectorAll(".chip[data-interet]").forEach(function (x) { x.classList.toggle("is-active", x === c); });
          paintList(contacts, salonMap);
        });
      });
      document.getElementById("sort").addEventListener("change", function (e) {
        listState.sort = e.target.value;
        paintList(contacts, salonMap);
      });

      paintList(contacts, salonMap);
    });
  }

  function typeChip(val, label) {
    return '<button class="chip' + (listState.type === val ? " is-active" : "") + '" data-v="' + esc(val) + '">' + esc(label) + "</button>";
  }
  function interetChip(val, label) {
    return '<button class="chip' + (listState.interet === val ? " is-active" : "") + '" data-interet="' + esc(val) + '">' + esc(label) + "</button>";
  }
  function opt(val, label, cur) {
    return '<option value="' + val + '"' + (cur === val ? " selected" : "") + ">" + esc(label) + "</option>";
  }

  function paintList(contacts, salonMap) {
    var q = listState.q.trim().toLowerCase();
    var out = contacts.filter(function (c) {
      if (listState.type && c.type !== listState.type) return false;
      if (listState.interet && c.interet !== listState.interet) return false;
      if (listState.salon && c.salonId !== listState.salon) return false;
      if (q) {
        var hay = [c.prenom, c.nom, c.entreprise, c.ville, c.pays, c.fonction, c.email, c.telephone, c.produits]
          .join(" ").toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });

    out.sort(function (a, b) {
      if (listState.sort === "nom") return fullName(a).localeCompare(fullName(b), "fr");
      if (listState.sort === "entreprise") return (a.entreprise || "").localeCompare(b.entreprise || "", "fr");
      if (listState.sort === "interet") return INTERETS.indexOf(b.interet) - INTERETS.indexOf(a.interet);
      return (b.updatedAt || "").localeCompare(a.updatedAt || "");
    });

    var listEl = document.getElementById("list");
    if (!out.length) {
      listEl.innerHTML = emptyState(contacts.length ? "Aucun contact ne correspond à la recherche." : "Aucun contact pour l'instant.",
        contacts.length ? "" : "Appuyez sur + pour enregistrer votre premier contact.");
      return;
    }
    listEl.innerHTML =
      '<p class="count-note">' + out.length + " contact" + (out.length > 1 ? "s" : "") + "</p>" +
      '<div class="list">' + out.map(function (c) { return contactCard(c, salonMap); }).join("") + "</div>";
  }

  function contactCard(c, salonMap) {
    var meta = [c.entreprise, c.fonction].filter(Boolean).join(" · ");
    var loc = [c.ville, c.pays].filter(Boolean).join(", ");
    var tags = "";
    if (c.type) tags += '<span class="badge badge--type">' + esc(c.type) + "</span>";
    if (c.interet === "Fort") tags += '<span class="badge badge--fort">Intérêt fort</span>';
    else if (c.interet === "Moyen") tags += '<span class="badge badge--moyen">Intérêt moyen</span>';
    if (needsRelance(c)) tags += '<span class="badge badge--action">' + esc(c.prochaineAction) + "</span>";
    var salon = c.salonId && salonMap[c.salonId] ? salonMap[c.salonId].nom : "";
    if (salon) tags += '<span class="badge">' + esc(salon) + "</span>";
    return '<a class="card" href="#/contact/' + esc(c.id) + '">' +
      '<div class="avatar">' + esc(initials(c)) + "</div>" +
      '<div class="card__body">' +
        '<div class="card__name">' + esc(fullName(c)) + "</div>" +
        (meta ? '<div class="card__meta">' + esc(meta) + "</div>" : "") +
        (loc ? '<div class="card__meta">' + esc(loc) + "</div>" : "") +
        (tags ? '<div class="card__tags">' + tags + "</div>" : "") +
      "</div></a>";
  }

  function emptyState(title, sub) {
    return '<div class="empty">' +
      '<svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>' +
      "<p>" + esc(title) + "</p>" + (sub ? "<p>" + esc(sub) + "</p>" : "") + "</div>";
  }

  /* ---------- Vue : Formulaire contact (new / edit) ---------- */
  route("/contact/new", function () { return renderContactForm(null); });
  route("/contact/:id/edit", function (p) {
    return DB.getContact(p.id).then(function (c) {
      if (!c) { toast("Contact introuvable", "err"); go("/contacts"); return; }
      return renderContactForm(c);
    });
  });

  function renderContactForm(contact) {
    return Promise.all([DB.getAllSalons(), DB.getMeta("activeSalonId")]).then(function (res) {
      var salons = res[0], activeId = res[1];
      var isNew = !contact;
      var c = contact || {
        type: "Prospect", interet: "Moyen", prochaineAction: "À contacter",
        salonId: activeId || "", dateRencontre: todayISO()
      };

      var salonOptions = '<option value="">— Aucun —</option>' + salons.map(function (s) {
        return '<option value="' + esc(s.id) + '"' + (c.salonId === s.id ? " selected" : "") + ">" + esc(s.nom) + "</option>";
      }).join("");

      view.innerHTML =
        '<button class="back" id="back"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg> Retour</button>' +
        '<h1 class="view__title">' + (isNew ? "Nouveau contact" : "Modifier le contact") + "</h1>" +
        '<form class="form" id="contact-form" autocomplete="off">' +
          '<div class="row2">' +
            fieldInput("prenom", "Prénom", c.prenom, "text", "given-name") +
            fieldInput("nom", "Nom", c.nom, "text", "family-name") +
          "</div>" +
          fieldInput("entreprise", "Entreprise", c.entreprise, "text", "organization") +
          fieldInput("fonction", "Fonction", c.fonction, "text", "organization-title") +
          '<div class="row2">' +
            fieldInput("email", "Email", c.email, "email", "email") +
            fieldInput("telephone", "Téléphone", c.telephone, "tel", "tel") +
          "</div>" +
          '<div class="row2">' +
            fieldInput("ville", "Ville", c.ville, "text", "address-level2") +
            fieldInput("pays", "Pays", c.pays, "text", "country-name") +
          "</div>" +
          '<div class="field"><label>Type</label><select name="type">' +
            TYPES.map(function (t) { return '<option' + (c.type === t ? " selected" : "") + ">" + t + "</option>"; }).join("") +
          "</select></div>" +
          '<div class="field"><label>Intérêt</label>' + segment("interet", INTERETS, c.interet || "Moyen", "seg--interet") + "</div>" +
          fieldTextarea("produits", "Produits intéressants", c.produits) +
          fieldTextarea("notes", "Notes", c.notes) +
          '<div class="field"><label>Prochaine action</label><select name="prochaineAction">' +
            ACTIONS.map(function (t) { return '<option' + (c.prochaineAction === t ? " selected" : "") + ">" + t + "</option>"; }).join("") +
          "</select></div>" +
          '<div class="row2">' +
            fieldInput("dateRelance", "Date de relance", c.dateRelance, "date") +
            fieldInput("dateRencontre", "Date de rencontre", c.dateRencontre, "date") +
          "</div>" +
          '<div class="field"><label>Salon</label><select name="salonId">' + salonOptions + "</select></div>" +
          formActions(isNew) +
        "</form>";

      document.getElementById("back").addEventListener("click", function () { history.back(); });

      var form = document.getElementById("contact-form");
      form.addEventListener("submit", function (e) { e.preventDefault(); });

      document.getElementById("save").addEventListener("click", function () {
        submitContact(form, c, false);
      });
      var saveNew = document.getElementById("save-new");
      if (saveNew) saveNew.addEventListener("click", function () { submitContact(form, c, true); });
    });
  }

  function submitContact(form, base, andNew) {
    var data = collectForm(form, base);
    // Rien d'obligatoire : on n'enregistre que si au moins une info utile existe.
    var hasSomething = data.prenom || data.nom || data.entreprise || data.email || data.telephone;
    if (!hasSomething) { toast("Renseignez au moins un nom, une entreprise ou un contact.", "err"); return; }
    DB.saveContact(data).then(function (saved) {
      if (andNew) {
        toast("Enregistré · nouveau contact", "ok");
        // Repartir sur un formulaire vierge en conservant le salon.
        DB.setMeta("lastSalonId", saved.salonId || "");
        renderContactForm(null);
        view.scrollIntoView();
        var firstInput = view.querySelector('input[name="prenom"]');
        if (firstInput) firstInput.focus();
      } else {
        toast("Contact enregistré", "ok");
        go("/contact/" + saved.id);
      }
    }).catch(function (err) { toast("Erreur : " + (err.message || err), "err"); });
  }

  function collectForm(form, base) {
    var d = Object.assign({}, base);
    ["prenom", "nom", "entreprise", "fonction", "email", "telephone", "ville", "pays",
     "type", "produits", "notes", "prochaineAction", "dateRelance", "dateRencontre", "salonId"]
      .forEach(function (name) {
        var el = form.elements[name];
        if (el) d[name] = el.value.trim ? el.value.trim() : el.value;
      });
    d.interet = form.getAttribute("data-interet") || base.interet || "Moyen";
    return d;
  }

  function fieldInput(name, label, val, type, autocomplete) {
    return '<div class="field"><label for="f-' + name + '">' + esc(label) + "</label>" +
      '<input id="f-' + name + '" name="' + name + '" type="' + (type || "text") + '"' +
      (autocomplete ? ' autocomplete="' + autocomplete + '"' : "") +
      ' value="' + esc(val) + '" /></div>';
  }
  function fieldTextarea(name, label, val) {
    return '<div class="field"><label for="f-' + name + '">' + esc(label) + "</label>" +
      '<textarea id="f-' + name + '" name="' + name + '">' + esc(val) + "</textarea></div>";
  }
  function segment(name, values, current, extra) {
    return '<div class="seg ' + (extra || "") + '" data-seg="' + name + '">' +
      values.map(function (v) {
        return '<button type="button" data-v="' + esc(v) + '"' + (v === current ? ' class="is-active"' : "") + ">" + esc(v) + "</button>";
      }).join("") + "</div>";
  }
  function formActions(isNew) {
    if (isNew) {
      return '<div class="form-actions">' +
        '<button type="button" class="btn" id="save">Enregistrer</button>' +
        '<button type="button" class="btn btn--primary" id="save-new">Enregistrer &amp; nouveau</button>' +
        "</div>";
    }
    return '<div class="form-actions form-actions--single">' +
      '<button type="button" class="btn btn--primary" id="save">Enregistrer</button></div>';
  }

  // Gestion des segments (intérêt) : on stocke la valeur sur le <form>.
  view.addEventListener("click", function (e) {
    var btn = e.target.closest(".seg button");
    if (!btn) return;
    var seg = btn.closest(".seg");
    var form = btn.closest("form");
    seg.querySelectorAll("button").forEach(function (b) { b.classList.toggle("is-active", b === btn); });
    if (form && seg.getAttribute("data-seg") === "interet") {
      form.setAttribute("data-interet", btn.getAttribute("data-v"));
    }
  });

  /* ---------- Vue : Détail contact ---------- */
  route("/contact/:id", function (p) {
    return Promise.all([DB.getContact(p.id), DB.getAllSalons()]).then(function (res) {
      var c = res[0], salons = res[1];
      if (!c) { view.innerHTML = emptyState("Contact introuvable."); return; }
      var salon = salons.filter(function (s) { return s.id === c.salonId; })[0];

      function row(k, v, isHtml) {
        if (!v) return "";
        return '<div class="info__row"><span class="info__key">' + esc(k) + '</span><span class="info__val">' + (isHtml ? v : esc(v)) + "</span></div>";
      }

      var interetLabel = c.interet || "";
      var relanceBadge = needsRelance(c)
        ? '<span class="badge badge--action">' + esc(c.prochaineAction) + "</span>"
        : (c.prochaineAction && c.prochaineAction !== "Rien" ? '<span class="badge badge--done">Fait</span>' : "");

      view.innerHTML =
        '<button class="back" id="back"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg> Contacts</button>' +
        '<div class="detail__head">' +
          '<div class="avatar" style="width:52px;height:52px;font-size:20px">' + esc(initials(c)) + "</div>" +
          "<div><div class=\"detail__name\">" + esc(fullName(c)) + "</div>" +
          (c.entreprise ? '<div class="detail__company">' + esc(c.entreprise) + (c.fonction ? " · " + esc(c.fonction) : "") + "</div>" : "") +
          "</div></div>" +
        (relanceBadge ? '<div class="card__tags" style="margin:6px 0 0">' + relanceBadge + "</div>" : "") +
        '<div class="info">' +
          row("Type", c.type) +
          row("Intérêt", interetLabel) +
          row("Email", c.email ? '<a href="mailto:' + esc(c.email) + '">' + esc(c.email) + "</a>" : "", true) +
          row("Téléphone", c.telephone ? '<a href="tel:' + esc(c.telephone.replace(/\s/g, "")) + '">' + esc(c.telephone) + "</a>" : "", true) +
          row("Localisation", [c.ville, c.pays].filter(Boolean).join(", ")) +
          row("Produits", c.produits) +
          row("Notes", c.notes) +
          row("Prochaine action", c.prochaineAction && c.prochaineAction !== "Rien" ? c.prochaineAction : "") +
          row("Date de relance", fmtDate(c.dateRelance)) +
          row("Salon", salon ? salon.nom : "") +
          row("Rencontré le", fmtDate(c.dateRencontre)) +
        "</div>" +
        '<div class="detail__actions">' +
          (needsRelance(c) ? '<button class="btn btn--primary" id="mark-done">Marquer relance faite</button>' : "") +
          (c.email ? '<a class="btn" href="mailto:' + esc(c.email) + '">Email</a>' : "") +
          (c.telephone ? '<a class="btn" href="tel:' + esc(c.telephone.replace(/\s/g, "")) + '">Appeler</a>' : "") +
          '<a class="btn" href="#/contact/' + esc(c.id) + '/edit">Modifier</a>' +
          '<button class="btn btn--danger" id="del">Supprimer</button>' +
        "</div>";

      document.getElementById("back").addEventListener("click", function () { go("/contacts"); });
      var md = document.getElementById("mark-done");
      if (md) md.addEventListener("click", function () {
        c.relanceFaite = true;
        DB.saveContact(c).then(function () { toast("Relance marquée comme faite", "ok"); navigate(); });
      });
      document.getElementById("del").addEventListener("click", function () {
        if (!confirm("Supprimer définitivement ce contact ?")) return;
        DB.deleteContact(c.id).then(function () { toast("Contact supprimé", "ok"); go("/contacts"); });
      });
    });
  });

  /* ---------- Vue : Salons ---------- */
  var salonShowArchived = false;

  function salonCard(s, counts, activeId) {
    var isActive = s.id === activeId;
    var isArchived = !!s.archived;
    var dates = [fmtDate(s.dateDebut), fmtDate(s.dateFin)].filter(Boolean).join(" → ");
    var loc = [s.ville, s.pays].filter(Boolean).join(", ");
    var n = counts[s.id] || 0;
    var kebab = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="12" cy="19" r="1.6"/></svg>';
    return '<div class="salon-card' + (isActive ? " is-active" : "") + (isArchived ? " is-archived" : "") + '">' +
      '<div class="salon-card__top">' +
        "<div class=\"salon-card__head\"><div class=\"salon-card__name\">" + esc(s.nom) + "</div>" +
        (loc ? '<div class="salon-card__meta">' + esc(loc) + "</div>" : "") +
        (dates ? '<div class="salon-card__meta">' + esc(dates) + "</div>" : "") +
        "</div>" +
        '<div class="salon-card__badges">' +
          (isActive ? '<span class="pill-active">Actif</span>' : "") +
          (isArchived ? '<span class="pill-archived">Archivé</span>' : "") +
          '<details class="menu"><summary class="menu__btn" aria-label="Actions du salon">' + kebab + "</summary>" +
            '<div class="menu__list">' +
              '<a class="menu__item" href="#/salon/' + esc(s.id) + '/edit">Modifier</a>' +
              '<button class="menu__item" data-archive="' + esc(s.id) + '" data-archived="' + (isArchived ? "1" : "0") + '">' +
                (isArchived ? "Désarchiver" : "Archiver") + "</button>" +
              '<button class="menu__item menu__item--danger" data-del="' + esc(s.id) + '">Supprimer</button>' +
            "</div>" +
          "</details>" +
        "</div>" +
      "</div>" +
      '<div class="salon-card__count">' + n + " contact" + (n > 1 ? "s" : "") + "</div>" +
      '<div class="salon-card__actions">' +
        (isActive || isArchived ? "" : '<button class="btn btn--sm btn--primary" data-activate="' + esc(s.id) + '">Sélectionner</button>') +
        '<a class="btn btn--sm" href="#/contacts?salon=' + esc(s.id) + '">Voir contacts</a>' +
      "</div></div>";
  }

  route("/salons", function () {
    return Promise.all([DB.getAllSalons(), DB.getAllContacts(), DB.getMeta("activeSalonId")])
      .then(function (res) {
        var salons = res[0], contacts = res[1], activeId = res[2];
        var counts = {};
        contacts.forEach(function (c) { if (c.salonId) counts[c.salonId] = (counts[c.salonId] || 0) + 1; });
        salons.sort(function (a, b) { return (b.dateDebut || "").localeCompare(a.dateDebut || ""); });
        var actifs = salons.filter(function (s) { return !s.archived; });
        var archives = salons.filter(function (s) { return s.archived; });

        view.innerHTML =
          '<h1 class="view__title">Salons</h1>' +
          '<a class="cta" href="#/salon/new"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg> Nouveau salon</a>' +
          (actifs.length
            ? actifs.map(function (s) { return salonCard(s, counts, activeId); }).join("")
            : emptyState("Aucun salon actif.", "Créez un salon pour regrouper vos contacts.")) +
          (archives.length
            ? '<button class="btn btn--ghost btn--block" id="toggle-archived" style="margin-top:16px">' +
                (salonShowArchived ? "Masquer" : "Afficher") + " les salons archivés (" + archives.length + ")</button>" +
              (salonShowArchived
                ? '<div class="section-title">Archivés</div>' + archives.map(function (s) { return salonCard(s, counts, activeId); }).join("")
                : "")
            : "");

        view.querySelectorAll("[data-activate]").forEach(function (b) {
          b.addEventListener("click", function () {
            DB.setMeta("activeSalonId", b.getAttribute("data-activate"))
              .then(refreshHeaderSalon).then(function () { toast("Salon actif mis à jour", "ok"); navigate(); });
          });
        });
        view.querySelectorAll("[data-archive]").forEach(function (b) {
          b.addEventListener("click", function () {
            var id = b.getAttribute("data-archive");
            var willArchive = b.getAttribute("data-archived") !== "1";
            DB.setSalonArchived(id, willArchive).then(function () {
              // Un salon archivé ne peut pas rester le salon actif.
              if (willArchive) {
                return DB.getMeta("activeSalonId").then(function (a) {
                  if (a === id) return DB.setMeta("activeSalonId", null);
                });
              }
            }).then(refreshHeaderSalon).then(function () {
              toast(willArchive ? "Salon archivé" : "Salon désarchivé", "ok");
              navigate();
            });
          });
        });
        view.querySelectorAll("[data-del]").forEach(function (b) {
          b.addEventListener("click", function () {
            var id = b.getAttribute("data-del");
            if (!confirm("Supprimer ce salon ? Les contacts associés seront conservés dans le CRM.")) return;
            DB.deleteSalon(id).then(function () {
              return DB.getMeta("activeSalonId").then(function (a) {
                if (a === id) return DB.setMeta("activeSalonId", null);
              });
            }).then(refreshHeaderSalon).then(function () { toast("Salon supprimé · contacts conservés", "ok"); navigate(); });
          });
        });
        var tgl = document.getElementById("toggle-archived");
        if (tgl) tgl.addEventListener("click", function () { salonShowArchived = !salonShowArchived; navigate(); });
      });
  });

  route("/salon/new", function () { return renderSalonForm(null); });
  route("/salon/:id/edit", function (p) {
    return DB.getSalon(p.id).then(function (s) {
      if (!s) { go("/salons"); return; }
      return renderSalonForm(s);
    });
  });

  function renderSalonForm(salon) {
    var isNew = !salon;
    var s = salon || { dateDebut: todayISO() };
    view.innerHTML =
      '<button class="back" id="back"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg> Salons</button>' +
      '<h1 class="view__title">' + (isNew ? "Nouveau salon" : "Modifier le salon") + "</h1>" +
      '<form class="form" id="salon-form">' +
        fieldInput("nom", "Nom du salon", s.nom) +
        '<div class="row2">' +
          fieldInput("ville", "Ville", s.ville) +
          fieldInput("pays", "Pays", s.pays) +
        "</div>" +
        '<div class="row2">' +
          fieldInput("dateDebut", "Date de début", s.dateDebut, "date") +
          fieldInput("dateFin", "Date de fin", s.dateFin, "date") +
        "</div>" +
        '<div class="form-actions form-actions--single"><button type="button" class="btn btn--primary" id="save">Enregistrer</button></div>' +
      "</form>";
    document.getElementById("back").addEventListener("click", function () { go("/salons"); });
    document.getElementById("salon-form").addEventListener("submit", function (e) { e.preventDefault(); });
    document.getElementById("save").addEventListener("click", function () {
      var form = document.getElementById("salon-form");
      var rec = Object.assign({}, s);
      ["nom", "ville", "pays", "dateDebut", "dateFin"].forEach(function (n) { rec[n] = form.elements[n].value.trim(); });
      if (!rec.nom) { toast("Le nom du salon est requis.", "err"); return; }
      DB.saveSalon(rec).then(function (saved) {
        // Le premier salon créé devient automatiquement actif.
        return DB.getMeta("activeSalonId").then(function (a) {
          if (!a) return DB.setMeta("activeSalonId", saved.id);
        });
      }).then(refreshHeaderSalon).then(function () {
        toast("Salon enregistré", "ok"); go("/salons");
      }).catch(function (err) { toast("Erreur : " + (err.message || err), "err"); });
    });
  }

  /* ---------- Vue : Relances ---------- */
  route("/relances", function () {
    return Promise.all([DB.getAllContacts(), DB.getAllSalons()]).then(function (res) {
      var contacts = res[0], salons = res[1];
      var salonMap = {}; salons.forEach(function (s) { salonMap[s.id] = s; });
      var todo = contacts.filter(needsRelance);
      var done = contacts.filter(function (c) { return c.prochaineAction && c.prochaineAction !== "Rien" && c.relanceFaite; });

      todo.sort(function (a, b) {
        var da = a.dateRelance || "9999", db = b.dateRelance || "9999";
        if (da !== db) return da.localeCompare(db);
        return INTERETS.indexOf(b.interet) - INTERETS.indexOf(a.interet);
      });

      function relanceRow(c, isDone) {
        var loc = [c.entreprise, c.ville].filter(Boolean).join(" · ");
        return '<div class="card">' +
          '<a class="card" style="flex:1;border:none;padding:0;background:none" href="#/contact/' + esc(c.id) + '">' +
            '<div class="avatar">' + esc(initials(c)) + "</div>" +
            '<div class="card__body">' +
              '<div class="card__name">' + esc(fullName(c)) + "</div>" +
              (loc ? '<div class="card__meta">' + esc(loc) + "</div>" : "") +
              '<div class="card__tags">' +
                '<span class="badge ' + (isDone ? "badge--done" : "badge--action") + '">' + esc(c.prochaineAction) + "</span>" +
                (c.dateRelance ? '<span class="badge">' + fmtDate(c.dateRelance) + "</span>" : "") +
                (c.interet === "Fort" ? '<span class="badge badge--fort">Fort</span>' : "") +
              "</div></div></a>" +
          '<button class="btn btn--sm ' + (isDone ? "" : "btn--primary") + '" data-toggle="' + esc(c.id) + '" data-done="' + (isDone ? "1" : "0") + '">' +
            (isDone ? "Rouvrir" : "Fait") + "</button>" +
          "</div>";
      }

      view.innerHTML =
        '<h1 class="view__title">Relances</h1>' +
        '<div class="section-title">À faire (' + todo.length + ")</div>" +
        (todo.length ? '<div class="list">' + todo.map(function (c) { return relanceRow(c, false); }).join("") + "</div>"
                     : '<p class="count-note">Aucune relance en attente.</p>') +
        (done.length ? '<div class="section-title">Fait (' + done.length + ")</div><div class=\"list\">" +
            done.map(function (c) { return relanceRow(c, true); }).join("") + "</div>" : "");

      view.querySelectorAll("[data-toggle]").forEach(function (b) {
        b.addEventListener("click", function () {
          var id = b.getAttribute("data-toggle");
          var isDone = b.getAttribute("data-done") === "1";
          DB.getContact(id).then(function (c) {
            c.relanceFaite = !isDone;
            return DB.saveContact(c);
          }).then(function () {
            toast(isDone ? "Relance rouverte" : "Relance faite", "ok");
            navigate();
          });
        });
      });
    });
  });

  /* ---------- Vue : Export / Import ---------- */
  route("/export", function () {
    return Promise.all([DB.getAllSalons(), DB.getAllContacts()]).then(function (res) {
      var salons = res[0], contacts = res[1];
      var salonOpts = '<option value="">Tous les salons</option>' + salons.map(function (s) {
        return '<option value="' + esc(s.id) + '">' + esc(s.nom) + "</option>";
      }).join("");

      view.innerHTML =
        '<h1 class="view__title">Export &amp; sauvegarde</h1>' +
        '<div class="panel">' +
          "<h3>Export CSV (Excel)</h3>" +
          "<p>Exportez vos contacts au format CSV, ouvrable directement dans Excel.</p>" +
          '<div class="field"><label>Contacts à exporter</label><select id="csv-salon">' + salonOpts + "</select></div>" +
          '<button class="btn btn--primary btn--block" id="csv-btn">Télécharger le CSV</button>' +
          '<p class="hint">' + contacts.length + " contact" + (contacts.length > 1 ? "s" : "") + " au total.</p>" +
        "</div>" +
        '<div class="panel">' +
          "<h3>Sauvegarde JSON</h3>" +
          "<p>Sauvegarde complète (contacts + salons) pour archivage ou transfert vers un autre appareil.</p>" +
          '<button class="btn btn--block" id="json-btn">Télécharger la sauvegarde</button>' +
        "</div>" +
        '<div class="panel">' +
          "<h3>Restaurer une sauvegarde</h3>" +
          "<p>Importez un fichier JSON. Les données sont fusionnées avec l'existant (même identifiant = mise à jour).</p>" +
          '<input type="file" id="json-file" accept="application/json,.json" style="display:none" />' +
          '<button class="btn btn--block" id="import-btn">Choisir un fichier…</button>' +
          '<p class="hint">Aucune donnée n\'est envoyée sur Internet : tout reste sur cet appareil.</p>' +
        "</div>";

      document.getElementById("csv-btn").addEventListener("click", function () {
        var sid = document.getElementById("csv-salon").value;
        exportCSV(contacts, salons, sid);
      });
      document.getElementById("json-btn").addEventListener("click", exportJSON);
      var fileInput = document.getElementById("json-file");
      document.getElementById("import-btn").addEventListener("click", function () { fileInput.click(); });
      fileInput.addEventListener("change", function () {
        var f = fileInput.files[0];
        if (!f) return;
        importJSON(f);
      });
    });
  });

  function csvCell(v) {
    var s = v == null ? "" : String(v);
    if (/[";\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function exportCSV(contacts, salons, salonId) {
    var salonMap = {}; salons.forEach(function (s) { salonMap[s.id] = s; });
    var rows = contacts;
    var suffix = "tous";
    if (salonId) {
      rows = contacts.filter(function (c) { return c.salonId === salonId; });
      suffix = slug(salonMap[salonId] ? salonMap[salonId].nom : "salon");
    }
    if (!rows.length) { toast("Aucun contact à exporter pour cette sélection.", "err"); return; }
    var headers = ["Prénom", "Nom", "Entreprise", "Fonction", "Email", "Téléphone", "Ville", "Pays",
      "Type", "Intérêt", "Produits", "Notes", "Prochaine action", "Date relance", "Relance faite",
      "Salon", "Date rencontre"];
    var lines = [headers.map(csvCell).join(";")];
    rows.forEach(function (c) {
      lines.push([
        c.prenom, c.nom, c.entreprise, c.fonction, c.email, c.telephone, c.ville, c.pays,
        c.type, c.interet, c.produits, c.notes, c.prochaineAction, fmtDate(c.dateRelance),
        c.relanceFaite ? "Oui" : "Non",
        c.salonId && salonMap[c.salonId] ? salonMap[c.salonId].nom : "",
        fmtDate(c.dateRencontre)
      ].map(csvCell).join(";"));
    });
    // BOM + "sep=;" pour une ouverture propre dans Excel (FR).
    var content = "﻿" + "sep=;\r\n" + lines.join("\r\n");
    download("casselin-contacts-" + suffix + "-" + todayISO() + ".csv", content, "text/csv;charset=utf-8");
    toast(rows.length + " contact" + (rows.length > 1 ? "s" : "") + " exporté(s)", "ok");
  }

  function exportJSON() {
    DB.exportAll().then(function (data) {
      download("casselin-crm-sauvegarde-" + todayISO() + ".json", JSON.stringify(data, null, 2), "application/json");
      toast("Sauvegarde téléchargée", "ok");
    });
  }

  function importJSON(file) {
    var reader = new FileReader();
    reader.onload = function () {
      var data;
      try { data = JSON.parse(reader.result); }
      catch (e) { toast("Fichier JSON illisible.", "err"); return; }
      var n = (data.contacts || []).length, s = (data.salons || []).length;
      if (!confirm("Importer " + n + " contact(s) et " + s + " salon(s) ? Les données seront fusionnées avec l'existant.")) return;
      DB.importAll(data, "merge").then(function () {
        return refreshHeaderSalon();
      }).then(function () {
        toast("Sauvegarde restaurée", "ok");
        go("/");
      }).catch(function (err) { toast("Erreur : " + (err.message || err), "err"); });
    };
    reader.onerror = function () { toast("Lecture du fichier impossible.", "err"); };
    reader.readAsText(file);
  }

  /* ---------- Lien Export depuis le dashboard (pas de tab dédié) ---------- */
  // On ajoute un accès Export via le header salon long-press ? Non : lien dans dashboard.

  /* ---------- Démarrage ---------- */
  window.addEventListener("hashchange", navigate);
  refreshHeaderSalon().then(navigate);

  // Enregistrement du service worker (offline / installable).
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function (e) { console.warn("SW:", e); });
    });
  }
})();
