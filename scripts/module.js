const MODULE_ID = "carte-partagee";
const SETTING_KEY = "mapState";
const DEFAULT_STATE = { maps: [] };

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

function newMap(name) {
  return { id: foundry.utils.randomID(), name, image: "", annotations: [] };
}

/** Lit l'état et convertit l'ancien format (une seule carte) si besoin. */
function getState() {
  const raw = foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTING_KEY) ?? DEFAULT_STATE);
  if (Array.isArray(raw.maps)) return raw;
  const legacy = newMap("Carte 1");
  legacy.image = raw.image ?? "";
  legacy.annotations = raw.annotations ?? [];
  return { maps: legacy.image || legacy.annotations.length ? [legacy] : [] };
}

async function saveState(state) {
  await game.settings.set(MODULE_ID, SETTING_KEY, state);
}

function escapeHTML(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getComments(annotationId) {
  return game.journal
    .filter(entry => entry.getFlag(MODULE_ID, "annotationId") === annotationId)
    .map(entry => ({
      title: entry.name,
      text: entry.getFlag(MODULE_ID, "commentText") ?? "",
      author: entry.getFlag(MODULE_ID, "authorName") ?? ""
    }));
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
  editingId = null;
  drawing = [];
  dragging = null;
  /** Saisies en cours, conservées entre deux rendus. */
  draft = { title: "", description: "" };
  commentDrafts = {};

  #currentMap(state) {
    const map = state.maps.find(m => m.id === this.mapId) ?? state.maps[0] ?? null;
    this.mapId = map?.id ?? null;
    return map;
  }

  async _prepareContext() {
    const state = getState();
    const map = this.#currentMap(state);
    const annotations = (map?.annotations ?? []).map(annotation => ({
      ...annotation,
      left: `${annotation.x / 10}%`,
      top: `${annotation.y / 10}%`,
      points: annotation.points?.map(point => `${point.x},${point.y}`).join(" ") ?? "",
      comments: getComments(annotation.id),
      commentDraft: this.commentDrafts[annotation.id] ?? "",
      isEditing: this.editingId === annotation.id
    }));

    return {
      maps: state.maps.map(m => ({ id: m.id, name: m.name, active: m.id === this.mapId })),
      hasMaps: state.maps.length > 0,
      map,
      hasImage: Boolean(map?.image),
      isGM: game.user.isGM,
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
  }

  #onInput(event) {
    const target = event.target;
    if (target.matches("[data-annotation-title]")) this.draft.title = target.value;
    else if (target.matches("[data-annotation-description]")) this.draft.description = target.value;
    else if (target.matches("[data-comment]")) this.commentDrafts[target.dataset.comment] = target.value;
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

    if (action === "select-map") {
      this.mapId = actionEl.dataset.mapId;
      this.editingId = null;
      this.render();
      return;
    }
    if (action === "save-comment") return this.#createComment(annotationId);
    if (!game.user.isGM) return;

    switch (action) {
      case "add-map": return this.#addMap();
      case "delete-map": return this.#deleteMap();
      case "choose-image": this.element.querySelector("[data-image-file]")?.click(); return;
      case "set-image-url": {
        const image = this.element.querySelector("[data-image-url]")?.value.trim();
        if (image) await this.#setImage(image);
        return;
      }
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
      const folder = `worlds/${game.world.id}`;
      const result = await foundry.applications.apps.FilePicker.implementation.upload("data", folder, file);
      await this.#setImage(result.path);
      ui.notifications.info("Carte importée.");
    } catch (error) {
      console.error(`${MODULE_ID} | Échec de l'import de la carte`, error);
      ui.notifications.error("Impossible d'importer cette image. Vérifiez les droits d'écriture du dossier de données.");
    }
  }

  #mapPoint(event, stage) {
    const bounds = stage.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1000, ((event.clientX - bounds.left) / bounds.width) * 1000)),
      y: Math.max(0, Math.min(1000, ((event.clientY - bounds.top) / bounds.height) * 1000))
    };
  }

  async #onPointerDown(event) {
    if (!game.user.isGM || event.button !== 0) return;
    const stage = event.target.closest(".cp-map-stage");
    if (!stage) return;

    // Outil sélection : on peut déplacer une épingle existante.
    const pin = event.target.closest(".cp-pin");
    if (pin) {
      if (this.tool !== "select") return;
      event.preventDefault();
      stage.setPointerCapture(event.pointerId);
      this.dragging = { id: pin.dataset.annotationId, element: pin, stage, moved: false };
      return;
    }

    if (this.tool === "pin") {
      const point = this.#mapPoint(event, stage);
      await this.#addAnnotation({ type: "pin", ...point }, "Nouvelle épingle");
      return;
    }

    if (this.tool !== "area") return;
    event.preventDefault();
    stage.setPointerCapture(event.pointerId);
    this.drawing = [this.#mapPoint(event, stage)];
  }

  #onPointerMove(event) {
    if (this.dragging) {
      const { element, stage } = this.dragging;
      const point = this.#mapPoint(event, stage);
      element.style.left = `${point.x / 10}%`;
      element.style.top = `${point.y / 10}%`;
      this.dragging.point = point;
      this.dragging.moved = true;
      return;
    }

    if (!this.drawing.length) return;
    const stage = event.target.closest(".cp-map-stage");
    if (!stage) return;
    this.drawing.push(this.#mapPoint(event, stage));

    const preview = this.element.querySelector("[data-drawing-preview]");
    if (preview) preview.setAttribute("points", this.drawing.map(point => `${point.x},${point.y}`).join(" "));
  }

  async #onPointerUp() {
    if (this.dragging) {
      const { id, moved, point } = this.dragging;
      this.dragging = null;
      if (moved && point) {
        await this.#updateMap(map => {
          const annotation = map.annotations.find(a => a.id === id);
          if (annotation) Object.assign(annotation, point);
        });
      }
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

  /** Applique une modification à la carte affichée puis enregistre. */
  async #updateMap(mutate) {
    const state = getState();
    const map = this.#currentMap(state);
    if (!map) return;
    mutate(map, state);
    await saveState(state);
  }

  async #addAnnotation(data, defaultTitle) {
    if (!this.mapId) return;
    const title = this.draft.title.trim() || defaultTitle;
    const description = this.draft.description.trim();
    await this.#updateMap(map => {
      map.annotations.push({ id: foundry.utils.randomID(), title, description, ...data });
    });
    this.draft = { title: "", description: "" };
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
      content: "<p>Supprimer cette annotation ? Les commentaires déjà créés restent dans le journal.</p>"
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
      content: `<p>Supprimer la carte « ${escapeHTML(map.name)} » et toutes ses annotations ? Les commentaires restent dans le journal.</p>`
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

  async #createComment(annotationId) {
    const map = this.#currentMap(getState());
    const annotation = map?.annotations.find(item => item.id === annotationId);
    const field = this.element.querySelector(`[data-comment="${CSS.escape(annotationId)}"]`);
    const text = field?.value.trim();
    if (!annotation || !text) {
      ui.notifications.warn("Écrivez un commentaire avant de l'enregistrer.");
      return;
    }

    try {
      const safeText = escapeHTML(text).replaceAll("\n", "<br>");
      await JournalEntry.create({
        name: `${annotation.title} — ${game.user.name}`,
        pages: [{
          name: "Commentaire",
          type: "text",
          text: { format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML, content: `<p>${safeText}</p>` }
        }],
        ownership: {
          default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER,
          [game.user.id]: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER
        },
        flags: {
          [MODULE_ID]: {
            annotationId,
            mapId: map.id,
            commentText: text,
            authorName: game.user.name
          }
        }
      });
      delete this.commentDrafts[annotationId];
      this.render();
    } catch (error) {
      console.error(`${MODULE_ID} | Échec de création de l'entrée de journal`, error);
      ui.notifications.error("Foundry n'autorise pas la création d'entrées de journal pour ce rôle.");
    }
  }
}

let mapApp;

function openMap() {
  mapApp ??= new CartePartageeApp();
  mapApp.render({ force: true });
}

/** Rafraîchit la fenêtre ouverte, sauf pendant un tracé ou un déplacement. */
function refreshMap() {
  if (!mapApp?.rendered || mapApp.drawing.length || mapApp.dragging) return;
  mapApp.render();
}

function createButton() {
  if (document.getElementById("carte-partagee-button")) return;
  const button = document.createElement("button");
  button.id = "carte-partagee-button";
  button.type = "button";
  button.title = "Ouvrir la carte partagée";
  button.setAttribute("aria-label", "Ouvrir la carte partagée");
  button.innerHTML = '<i class="fa-solid fa-map" aria-hidden="true"></i>';
  button.addEventListener("click", openMap);
  document.body.append(button);
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
  createButton();
});

for (const hook of ["createJournalEntry", "updateJournalEntry", "deleteJournalEntry"]) {
  Hooks.on(hook, entry => {
    if (entry.getFlag(MODULE_ID, "annotationId")) refreshMap();
  });
}
