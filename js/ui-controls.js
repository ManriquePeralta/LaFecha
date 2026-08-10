import { SELECTABLE_SEASONS, SPLIT_SEASON_MIN_YEAR } from "./config.js";
import { state } from "./state.js";
import { torneoSwitch, liveOnlyInput, liveOnlyWrap, seasonSelect } from "./dom.js";
import { seasonTypeCache } from "./season-types.js";

function populateSeasonSelect() {
  seasonSelect.innerHTML = SELECTABLE_SEASONS.map((y) => `<option value="${y}">${y}</option>`).join("");
  seasonSelect.value = String(state.season);
}

function syncTorneoControls() {
  const isPrimera = state.category === "primera";
  torneoSwitch.style.display = isPrimera ? "flex" : "none";
  if (!isPrimera) return;

  const isSplit = state.season >= SPLIT_SEASON_MIN_YEAR;
  const aperturaBtn = torneoSwitch.querySelector('[data-torneo="apertura"]');
  const clausuraBtn = torneoSwitch.querySelector('[data-torneo="clausura"]');

  const discovered = seasonTypeCache.get(`${state.category}:${state.season}`);

  aperturaBtn.disabled = false;
  clausuraBtn.disabled = !isSplit;

  // Solo deshabilitamos un boton puntual si ya terminamos el descubrimiento
  // y la fuente realmente no tiene ese torneo por separado (onlyOneAvailable).
  if (isSplit && discovered?.onlyOneAvailable) {
    aperturaBtn.disabled = discovered.apertura === null;
    clausuraBtn.disabled = discovered.clausura === null;
  }

  if (clausuraBtn.disabled && state.torneo === "clausura") state.torneo = "apertura";
  else if (aperturaBtn.disabled && state.torneo === "apertura") state.torneo = "clausura";

  setActiveButtons("[data-torneo]", "torneo", state.torneo);
}

function syncLiveOnlyAvailability() {
  const applicable = state.view === "resultados";
  liveOnlyInput.disabled = !applicable;
  liveOnlyWrap.classList.toggle("disabled-toggle", !applicable);
  if (!applicable && liveOnlyInput.checked) {
    liveOnlyInput.checked = false;
    state.liveOnly = false;
  }
}

function setActiveButtons(group, key, value) {
  document.querySelectorAll(group).forEach((btn) => {
    const active = btn.dataset[key] === value;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });
}

export { populateSeasonSelect, syncTorneoControls, syncLiveOnlyAvailability, setActiveButtons };
