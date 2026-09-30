const MODULE_ID = "carte-partagee";
const SETTING_KEY = "mapState";
const SOCKET = `module.${MODULE_ID}`;
const DEFAULT_STATE = { maps: [] };
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/** Une nouvelle carte est cachée aux joueurs tant que le MJ ne la révèle pas. */
function newMap(name) {
  return { id: foundry.utils.randomID(), name, image: "", hidden: true, annotations: [] };
}

/** Lit l'état et convertit l'ancien format (une seule carte) si besoin. */
function getState() {
  const raw = foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTING_KEY) ?? DEFAULT_STATE);
  if (Array.isArray(raw.maps)) return raw;
  const legacy = { ...newMap("Carte 1"), hidden: false };
  legacy.image = raw.image ?? "";
  legacy.annotations = raw.annotations ?? [];
  return { maps: legacy.image || legacy.annotations.length ? [legacy] : [] };
}

async function saveState(state) {
  await game.settings.set(MODULE_ID, SETTING_KEY, state);
}

function visibleMaps(state) {
  return game.user.isGM ? state.maps : state.maps.filter(map => !map.hidden);
}

function centroid(points = []) {
  if (!points.length) return { x: 0, y: 0 };
  const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / points.length, y: sum.y / points.length };
}

/** Point de référence d'une annotation (pointe de l'épingle ou centre de la zone). */
function anchorOf(annotation) {
  return annotation.type === "area" ? centroid(annotation.points) : annotation;
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

const FOLDER_NAME = "Carte partagée";

/** Journal personnel d'un utilisateur : seuls lui et le MJ peuvent le lire. */
function getNotesJournal(userId = game.user.id) {
  return game.journal.find(entry => entry.getFlag(MODULE_ID, "ownerId") === userId) ?? null;
}

function getNotePage(annotationId) {
  return getNotesJournal()?.pages.find(page => page.getFlag(MODULE_ID, "annotationId") === annotationId) ?? null;
}

async function getNotesFolder() {
  const existing = game.folders.find(f => f.type === "JournalEntry" && f.getFlag(MODULE_ID, "notesFolder"));
  if (existing || !game.user.isGM) return existing ?? null;
  return Folder.create({ name: FOLDER_NAME, type: "JournalEntry", flags: { [MODULE_ID]: { notesFolder: true } } });
}

async function createNotesJournal(user) {
  const folder = await getNotesFolder();
  return JournalEntry.create({
    name: `Notes de ${user.name}`,
    folder: folder?.id ?? null,
    ownership: {
      default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE,
      [user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
    },
    flags: { [MODULE_ID]: { ownerId: user.id } }
  });
}

/** Côté MJ : crée les journaux manquants et rend privés les commentaires de la v1.1. */
async function ensureNotesJournals() {
  if (game.users.activeGM !== game.user) return;
  for (const user of game.users) {
    if (!user.isGM && !getNotesJournal(user.id)) await createNotesJournal(user);
  }
  const legacy = game.journal.filter(entry =>
    entry.getFlag(MODULE_ID, "annotationId") && entry.ownership.default > CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE);
  for (const entry of legacy) {
    await entry.update({ "ownership.default": CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE });
  }
}

class CartePartageeApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "carte-partagee-app",
    classes: ["carte-partagee-app"],
    window: {
      title: "Carte partagée",
      icon: "fa-solid fa-map",
      resizable: true
    },
    position: { width: 1100, height: 780 },
    actions: {}
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/map.hbs` }
  };

  tool = "select";
  mapId = null;
  displayedMapId = null;
  editingId = null;
  drawing = [];
  dragging = null;
  panning = null;
  /** Zoom et décalage par carte, propres à ce client. */
  views = {};
  /** Saisies en cours, conservées entre deux rendus. */
  draft = { title: "", description: "", hidden: false };

  #currentMap(state) {
    const maps = visibleMaps(state);
    return maps.find(m => m.id === this.mapId) ?? maps[0] ?? null;
  }

  #view() {
    return (this.views[this.displayedMapId] ??= { zoom: 1, x: 0, y: 0 });
  }

  async _prepareContext() {
    const state = getState();
    const isGM = game.user.isGM;
    const map = this.#currentMap(state);
    this.displayedMapId = map?.id ?? null;

    const annotations = (map?.annotations ?? [])
      .filter(annotation => isGM || !annotation.hidden)
      .map(annotation => {
        const anchor = anchorOf(annotation);
        return {
          ...annotation,
          left: `${anchor.x / 10}%`,
          top: `${anchor.y / 10}%`,
          points: annotation.points?.map(point => `${point.x},${point.y}`).join(" ") ?? "",
          hasNote: Boolean(getNotePage(annotation.id)),
          isEditing: this.editingId === annotation.id
        };
      });

    return {
      maps: visibleMaps(state).map(m => ({ id: m.id, name: m.name, hidden: m.hidden, active: m.id === map?.id })),
      hasMaps: state.maps.length > 0,
      map,
      hasImage: Boolean(map?.image),
      isGM,
      annotations,
      selectedTool: this.tool,
      draft: this.draft
    };
  }

  _onRender(_context, _options) {
    super._onRender(_context, _options);
    const root = this.element;

    root.onclick = event => this.#onClick(event);
    root.onchange = event => this.#onChange(event);
    root.oninput = event => this.#onInput(event);
    root.onpointerdown = event => this.#onPointerDown(event);
    root.onpointermove = event => this.#onPointerMove(event);
    root.onpointerup = event => this.#onPointerUp(event);
    root.onpointercancel = event => this.#onPointerUp(event);
    root.onwheel = event => this.#onWheel(event);
    this.#applyView();
  }

  #onInput(event) {
    const target = event.target;
    if (target.matches("[data-annotation-title]")) this.draft.title = target.value;
    else if (target.matches("[data-annotation-description]")) this.draft.description = target.value;
  }

  async #onClick(event) {
    const actionEl = event.target.closest("[data-action]");
    const toolButton = event.target.closest("button[data-tool]");

    if (toolButton && game.user.isGM) {
      this.tool = toolButton.dataset.tool;
      this.render();
      return;
    }
    if (!actionEl) return;

    const { action } = actionEl.dataset;
    const annotationId = actionEl.dataset.annotationId;

    switch (action) {
      case "select-map":
        this.mapId = actionEl.dataset.mapId;
        this.editingId = null;
        this.render();
        return;
      case "zoom-in": return this.#zoomBy(1.4);
      case "zoom-out": return this.#zoomBy(1 / 1.4);
      case "zoom-reset": return this.#resetView();
      case "focus-annotation": return this.#focusAnnotation(annotationId);
      case "open-note": return this.#openNote(annotationId);
    }
    if (!game.user.isGM) return;

    switch (action) {
      case "add-map": return this.#addMap();
      case "delete-map": return this.#deleteMap();
      case "toggle-map-hidden": return this.#updateMap(map => { map.hidden = !map.hidden; });
      case "show-players": return this.#showToPlayers();
      case "choose-image": this.element.querySelector("[data-image-file]")?.click(); return;
      case "set-image-url": {
        const image = this.element.querySelector("[data-image-url]")?.value.trim();
        if (image) await this.#setImage(image);
        return;
      }
      case "toggle-draft-secret": this.draft.hidden = !this.draft.hidden; this.render(); return;
      case "toggle-annotation-secret":
        return this.#updateMap(map => {
          const annotation = map.annotations.find(a => a.id === annotationId);
          if (annotation) annotation.hidden = !annotation.hidden;
        });
      case "edit-annotation": this.editingId = annotationId; this.render(); return;
      case "cancel-edit": this.editingId = null; this.render(); return;
      case "save-annotation": return this.#saveAnnotation(annotationId);
      case "delete-annotation": return this.#deleteAnnotation(annotationId);
    }
  }

  async #onChange(event) {
    if (!game.user.isGM) return;

    if (event.target.matches("[data-map-name]")) {
      const name = event.target.value.trim();
      if (name) await this.#updateMap(map => { map.name = name; });
      return;
    }

    if (!event.target.matches("[data-image-file]")) return;
    const [file] = event.target.files ?? [];
    if (!file) return;

    try {
      const picker = foundry.applications.apps.FilePicker.implementation;
      const folder = `worlds/${game.world.id}/${MODULE_ID}`;
      await picker.createDirectory("data", folder).catch(() => {}); // existe déjà
      const result = await picker.upload("data", folder, file);
      await this.#setImage(result.path);
      ui.notifications.info("Carte importée.");
    } catch (error) {
      console.error(`${MODULE_ID} | Échec de l'import de la carte`, error);
      ui.notifications.error("Impossible d'importer cette image. Vérifiez les droits d'écriture du dossier de données.");
    }
  }

  /* -------------------------------------------- */
  /*  Zoom et déplacement                          */
  /* -------------------------------------------- */

  #applyView() {
    const stage = this.element?.querySelector(".cp-map-stage");
    if (!stage) return;
    const { zoom, x, y } = this.#view();
    stage.style.setProperty("--zoom", zoom);
    stage.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    const label = this.element.querySelector("[data-zoom-label]");
    if (label) label.textContent = `${Math.round(zoom * 100)} %`;
  }

  /** Zoome en gardant fixe le point de l'écran situé sous (clientX, clientY). */
  #zoomAt(clientX, clientY, factor) {
    const stage = this.element.querySelector(".cp-map-stage");
    if (!stage) return;
    const view = this.#view();
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
    if (zoom === MIN_ZOOM) {
      Object.assign(view, { zoom, x: 0, y: 0 });
    } else {
      const rect = stage.getBoundingClientRect();
      const ratio = zoom / view.zoom;
      view.x += (clientX - rect.left) * (1 - ratio);
      view.y += (clientY - rect.top) * (1 - ratio);
      view.zoom = zoom;
    }
    this.#applyView();
  }

  #zoomBy(factor) {
    const frame = this.element.querySelector(".cp-map-frame");
    if (!frame) return;
    const rect = frame.getBoundingClientRect();
    this.#zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
  }

  #resetView() {
    Object.assign(this.#view(), { zoom: 1, x: 0, y: 0 });
    this.#applyView();
  }

  #onWheel(event) {
    if (!event.target.closest(".cp-map-frame") || !this.element.querySelector(".cp-map-stage")) return;
    event.preventDefault();
    this.#zoomAt(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.0015));
  }

  #startPan(event, frame) {
    event.preventDefault();
    frame.setPointerCapture(event.pointerId);
    frame.dataset.panning = "";
    this.panning = { frame, x: event.clientX, y: event.clientY };
  }

  /* -------------------------------------------- */
  /*  Mise en évidence                             */
  /* -------------------------------------------- */

  #flash(element) {
    if (!element) return;
    element.classList.remove("cp-flash");
    void element.getBoundingClientRect(); // relance l'animation
    element.classList.add("cp-flash");
    setTimeout(() => element.classList.remove("cp-flash"), 1600);
  }

  /** Depuis le panneau : centre la vue sur l'annotation (si zoomée) et la fait clignoter. */
  #focusAnnotation(annotationId) {
    const annotation = this.#currentMap(getState())?.annotations.find(a => a.id === annotationId);
    const stage = this.element.querySelector(".cp-map-stage");
    const frame = this.element.querySelector(".cp-map-frame");
    if (!annotation || !stage || !frame) return;

    const view = this.#view();
    if (view.zoom > 1) {
      const anchor = anchorOf(annotation);
      const rect = stage.getBoundingClientRect();
      const bounds = frame.getBoundingClientRect();
      view.x += bounds.left + bounds.width / 2 - (rect.left + (rect.width * anchor.x) / 1000);
      view.y += bounds.top + bounds.height / 2 - (rect.top + (rect.height * anchor.y) / 1000);
      this.#applyView();
    }
    for (const element of stage.querySelectorAll(`[data-annotation-id="${CSS.escape(annotationId)}"]`)) {
      this.#flash(element);
    }
  }

  /** Depuis la carte : fait défiler le panneau jusqu'à la fiche de l'annotation. */
  #focusCard(annotationId) {
    const card = this.element.querySelector(`.cp-annotation[data-annotation-id="${CSS.escape(annotationId)}"]`);
    if (!card) return;
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    this.#flash(card);
  }

  /* -------------------------------------------- */
  /*  Pointeur                                     */
  /* -------------------------------------------- */

  #mapPoint(event, stage) {
    const bounds = stage.getBoundingClientRect();
    const clamp = value => Math.round(Math.max(0, Math.min(1000, value)) * 10) / 10;
    return {
      x: clamp(((event.clientX - bounds.left) / bounds.width) * 1000),
      y: clamp(((event.clientY - bounds.top) / bounds.height) * 1000)
    };
  }

  async #onPointerDown(event) {
    const frame = event.target.closest(".cp-map-frame");
    if (!frame || event.target.closest(".cp-zoom-controls")) return;
    const stage = frame.querySelector(".cp-map-stage");
    if (!stage) return;

    // Clic molette : déplacement quel que soit l'outil.
    if (event.button === 1) return this.#startPan(event, frame);
    if (event.button !== 0) return;

    const isGM = game.user.isGM;
    const onStage = Boolean(event.target.closest(".cp-map-stage"));
    const marker = event.target.closest(".cp-pin, .cp-area-label");

    if (marker && this.tool === "select") {
      if (isGM && marker.matches(".cp-pin")) {
        event.preventDefault();
        stage.setPointerCapture(event.pointerId);
        this.dragging = { id: marker.dataset.annotationId, element: marker, stage, startX: event.clientX, startY: event.clientY, moved: false };
      } else {
        this.#focusCard(marker.dataset.annotationId);
      }
      return;
    }

    if (isGM && onStage && this.tool === "pin") {
      await this.#addAnnotation({ type: "pin", ...this.#mapPoint(event, stage) }, "Nouvelle épingle");
      return;
    }

    if (isGM && onStage && this.tool === "area") {
      event.preventDefault();
      stage.setPointerCapture(event.pointerId);
      this.drawing = [this.#mapPoint(event, stage)];
      return;
    }

    if (this.tool === "select") this.#startPan(event, frame);
  }

  #onPointerMove(event) {
    if (this.panning) {
      const view = this.#view();
      view.x += event.clientX - this.panning.x;
      view.y += event.clientY - this.panning.y;
      this.panning.x = event.clientX;
      this.panning.y = event.clientY;
      this.#applyView();
      return;
    }

    if (this.dragging) {
      const drag = this.dragging;
      if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
      const point = this.#mapPoint(event, drag.stage);
      drag.element.style.left = `${point.x / 10}%`;
      drag.element.style.top = `${point.y / 10}%`;
      drag.point = point;
      drag.moved = true;
      return;
    }

    if (!this.drawing.length) return;
    const stage = event.target.closest(".cp-map-stage");
    if (!stage) return;
    const point = this.#mapPoint(event, stage);
    const last = this.drawing.at(-1);
    if (Math.hypot(point.x - last.x, point.y - last.y) < 3) return;
    this.drawing.push(point);

    const preview = this.element.querySelector("[data-drawing-preview]");
    if (preview) preview.setAttribute("points", this.drawing.map(point => `${point.x},${point.y}`).join(" "));
  }

  async #onPointerUp() {
    if (this.panning) {
      delete this.panning.frame.dataset.panning;
      this.panning = null;
      return;
    }

    if (this.dragging) {
      const { id, moved, point } = this.dragging;
      this.dragging = null;
      if (!moved) {
        this.#focusCard(id);
        return;
      }
      await this.#updateMap(map => {
        const annotation = map.annotations.find(a => a.id === id);
        if (annotation) Object.assign(annotation, point);
      });
      return;
    }

    if (!this.drawing.length) return;
    const points = this.drawing;
    this.drawing = [];
    if (points.length < 3) {
      this.render();
      return;
    }
    await this.#addAnnotation({ type: "area", points }, "Nouvelle zone");
  }

  /* -------------------------------------------- */
  /*  Données                                      */
  /* -------------------------------------------- */

  /** Applique une modification à la carte affichée puis enregistre. */
  async #updateMap(mutate) {
    const state = getState();
    const map = this.#currentMap(state);
    if (!map) return;
    mutate(map, state);
    await saveState(state);
  }

  async #addAnnotation(data, defaultTitle) {
    const title = this.draft.title.trim() || defaultTitle;
    const description = this.draft.description.trim();
    const hidden = this.draft.hidden;
    await this.#updateMap(map => {
      map.annotations.push({ id: foundry.utils.randomID(), title, description, hidden, ...data });
    });
    // Le mode secret reste actif pour éviter de révéler par erreur l'annotation suivante.
    this.draft = { title: "", description: "", hidden };
    this.tool = "select";
    this.render();
  }

  async #saveAnnotation(annotationId) {
    const card = this.element.querySelector(`.cp-annotation[data-annotation-id="${CSS.escape(annotationId)}"]`);
    const title = card?.querySelector("[data-edit-title]")?.value.trim();
    const description = card?.querySelector("[data-edit-description]")?.value.trim() ?? "";
    if (!title) {
      ui.notifications.warn("Le titre ne peut pas être vide.");
      return;
    }
    this.editingId = null;
    await this.#updateMap(map => {
      const annotation = map.annotations.find(a => a.id === annotationId);
      if (annotation) Object.assign(annotation, { title, description });
    });
    this.render();
  }

  async #deleteAnnotation(annotationId) {
    const confirmed = await DialogV2.confirm({
      window: { title: "Supprimer l'annotation" },
      content: "<p>Supprimer cette annotation ? Les notes des joueurs restent dans leur journal.</p>"
    });
    if (!confirmed) return;
    await this.#updateMap(map => {
      map.annotations = map.annotations.filter(a => a.id !== annotationId);
    });
    this.render();
  }

  async #addMap() {
    const state = getState();
    const map = newMap(`Carte ${state.maps.length + 1}`);
    state.maps.push(map);
    await saveState(state);
    this.mapId = map.id;
    this.render();
  }

  async #deleteMap() {
    const state = getState();
    const map = this.#currentMap(state);
    if (!map) return;
    const confirmed = await DialogV2.confirm({
      window: { title: "Supprimer la carte" },
      content: `<p>Supprimer la carte « ${escapeHTML(map.name)} » et toutes ses annotations ? Les notes des joueurs restent dans leur journal.</p>`
    });
    if (!confirmed) return;
    state.maps = state.maps.filter(m => m.id !== map.id);
    await saveState(state);
    this.mapId = null;
    this.render();
  }

  async #setImage(image) {
    const state = getState();
    let map = this.#currentMap(state);
    if (!map) {
      map = newMap("Carte 1");
      state.maps.push(map);
      this.mapId = map.id;
    }
    map.image = image;
    await saveState(state);
    this.render();
  }

  /** Révèle la carte si besoin et l'ouvre chez tous les joueurs connectés. */
  async #showToPlayers() {
    const map = this.#currentMap(getState());
    if (!map) return;
    const wasHidden = map.hidden;
    if (wasHidden) await this.#updateMap(m => { m.hidden = false; });
    game.socket.emit(SOCKET, { action: "show", mapId: map.id });
    ui.notifications.info(wasHidden
      ? `« ${map.name} » est maintenant visible et s'ouvre chez les joueurs.`
      : `« ${map.name} » s'ouvre chez les joueurs.`);
  }

  /** Ouvre la page de notes du joueur pour cette annotation, en la créant au besoin. */
  async #openNote(annotationId) {
    const existing = getNotePage(annotationId);
    if (existing) {
      existing.parent.sheet.render({ force: true, pageId: existing.id });
      return;
    }

    const map = this.#currentMap(getState());
    const annotation = map?.annotations.find(item => item.id === annotationId);
    if (!annotation) return;

    let journal = getNotesJournal();
    if (!journal && (game.user.isGM || game.user.can("JOURNAL_CREATE"))) journal = await createNotesJournal(game.user);
    if (!journal) {
      ui.notifications.warn("Votre journal de notes n'existe pas encore : le MJ doit se connecter une fois avec le module activé.");
      return;
    }

    try {
      const [page] = await journal.createEmbeddedDocuments("JournalEntryPage", [{
        name: `${annotation.title} (${map.name})`,
        type: "text",
        text: { format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML, content: "" },
        flags: { [MODULE_ID]: { annotationId, mapId: map.id } }
      }]);
      page.sheet.render({ force: true }); // ouvre directement l'éditeur de la page
    } catch (error) {
      console.error(`${MODULE_ID} | Échec de création de la page de notes`, error);
      ui.notifications.error("Impossible de créer la page dans votre journal.");
    }
  }
}

let mapApp;

function openMap(mapId) {
  mapApp ??= new CartePartageeApp();
  if (mapId) mapApp.mapId = mapId;
  mapApp.render({ force: true });
  if (mapApp.minimized) mapApp.maximize();
}

/** Rafraîchit la fenêtre ouverte, sauf pendant un tracé ou un déplacement. */
function refreshMap() {
  if (!mapApp?.rendered || mapApp.drawing.length || mapApp.dragging || mapApp.panning) return;
  mapApp.render();
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, SETTING_KEY, {
    name: "État de la carte partagée",
    scope: "world",
    config: false,
    type: Object,
    default: DEFAULT_STATE,
    onChange: refreshMap
  });
});

Hooks.once("ready", () => {
  game.modules.get(MODULE_ID).api = { openMap };
  game.socket.on(SOCKET, data => {
    if (data?.action === "show" && !game.user.isGM) openMap(data.mapId);
  });
  ensureNotesJournals();
});

// Bouton dans les outils de scène (barre de gauche, groupe Jetons).
Hooks.on("getSceneControlButtons", controls => {
  const tokens = controls.tokens ?? controls.token;
  if (!tokens?.tools) return;
  tokens.tools[MODULE_ID] = {
    name: MODULE_ID,
    title: "Carte partagée",
    icon: "fa-solid fa-map",
    order: Object.keys(tokens.tools).length,
    button: true,
    visible: true,
    onChange: () => openMap()
  };
});

// Bouton dans l'onglet Journaux de la barre latérale (utile aussi sans scène active).
Hooks.on("renderJournalDirectory", (_app, html) => {
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".cp-directory-button")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cp-directory-button";
  button.innerHTML = '<i class="fa-solid fa-map" aria-hidden="true"></i> Carte partagée';
  button.addEventListener("click", () => openMap());
  const target = root.querySelector(".header-actions") ?? root.querySelector(".directory-header");
  target?.append(button);
});

Hooks.on("createUser", () => ensureNotesJournals());

for (const hook of ["createJournalEntryPage", "deleteJournalEntryPage"]) {
  Hooks.on(hook, page => {
    if (page.getFlag(MODULE_ID, "annotationId")) refreshMap();
  });
}
