const MODULE_ID = "carte-partagee";
const SETTING_KEY = "mapState";
const DEFAULT_STATE = { image: "", annotations: [] };

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

function getState() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTING_KEY) ?? DEFAULT_STATE);
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
    position: { width: 1050, height: 760 },
    actions: {}
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/map.hbs` }
  };

  tool = "select";
  drawing = [];

  async _prepareContext() {
    const state = getState();
    const annotations = state.annotations.map(annotation => ({
      ...annotation,
      left: `${annotation.x / 10}%`,
      top: `${annotation.y / 10}%`,
      points: annotation.points?.map(point => `${point.x},${point.y}`).join(" ") ?? "",
      comments: getComments(annotation.id)
    }));

    return {
      image: state.image,
      hasImage: Boolean(state.image),
      isGM: game.user.isGM,
      annotations,
      selectedTool: this.tool
    };
  }

  _onRender(_context, _options) {
    super._onRender(_context, _options);
    const root = this.element;

    root.onclick = event => this.#onClick(event);
    root.onchange = event => this.#onChange(event);
    root.onpointerdown = event => this.#onPointerDown(event);
    root.onpointermove = event => this.#onPointerMove(event);
    root.onpointerup = event => this.#onPointerUp(event);
  }

  async #onClick(event) {
    const toolButton = event.target.closest("button[data-tool]");
    if (toolButton && game.user.isGM) {
      this.tool = toolButton.dataset.tool;
      this.render();
      return;
    }

    const uploadButton = event.target.closest('[data-action="choose-image"]');
    if (uploadButton && game.user.isGM) {
      this.element.querySelector("[data-image-file]")?.click();
      return;
    }

    const setImageButton = event.target.closest('[data-action="set-image-url"]');
    if (setImageButton && game.user.isGM) {
      const image = this.element.querySelector("[data-image-url]")?.value.trim();
      if (image) await this.#setImage(image);
      return;
    }

    const commentButton = event.target.closest('[data-action="save-comment"]');
    if (commentButton) await this.#createComment(commentButton.dataset.annotationId);
  }

  async #onChange(event) {
    if (!event.target.matches("[data-image-file]") || !game.user.isGM) return;
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
    if (!game.user.isGM || !event.target.closest(".cp-map-stage")) return;
    if (event.target.closest(".cp-pin")) return;

    const stage = event.target.closest(".cp-map-stage");
    if (this.tool === "pin") {
      const point = this.#mapPoint(event, stage);
      const title = this.element.querySelector("[data-annotation-title]")?.value.trim() || "Nouvelle épingle";
      const description = this.element.querySelector("[data-annotation-description]")?.value.trim() || "";
      const state = getState();
      state.annotations.push({ id: foundry.utils.randomID(), type: "pin", title, description, ...point });
      await saveState(state);
      this.tool = "select";
      this.render();
      return;
    }

    if (this.tool !== "area") return;
    event.preventDefault();
    stage.setPointerCapture(event.pointerId);
    this.drawing = [this.#mapPoint(event, stage)];
  }

  #onPointerMove(event) {
    if (!this.drawing.length) return;
    const stage = event.target.closest(".cp-map-stage");
    if (!stage) return;
    this.drawing.push(this.#mapPoint(event, stage));

    const preview = this.element.querySelector("[data-drawing-preview]");
    if (preview) preview.setAttribute("points", this.drawing.map(point => `${point.x},${point.y}`).join(" "));
  }

  async #onPointerUp() {
    if (this.drawing.length < 3) {
      this.drawing = [];
      return;
    }

    const title = this.element.querySelector("[data-annotation-title]")?.value.trim() || "Nouvelle zone";
    const description = this.element.querySelector("[data-annotation-description]")?.value.trim() || "";
    const state = getState();
    state.annotations.push({ id: foundry.utils.randomID(), type: "area", title, description, points: this.drawing });
    this.drawing = [];
    await saveState(state);
    this.tool = "select";
    this.render();
  }

  async #setImage(image) {
    const state = getState();
    state.image = image;
    await saveState(state);
    this.render();
  }

  async #createComment(annotationId) {
    const annotation = getState().annotations.find(item => item.id === annotationId);
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
            commentText: text,
            authorName: game.user.name
          }
        }
      });
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
    default: DEFAULT_STATE
  });
});

Hooks.once("ready", () => {
  game.modules.get(MODULE_ID).api = { openMap };
  createButton();
});