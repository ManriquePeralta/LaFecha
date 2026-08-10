import { CURRENT_SEASON, defaultTorneo } from "./config.js";

const db = {
  primera: { resultados: [], proximos: [], allMatches: [], tabla: [], zonas: [], annual: [], averages: [] },
  segunda: { resultados: [], proximos: [], allMatches: [], tabla: [], zonas: [], annual: [], averages: [] }
};

const state = {
  category: "primera",
  season: CURRENT_SEASON,
  torneo: defaultTorneo(),
  view: "resultados",
  search: "",
  liveOnly: false,
  isLoading: false,
  source: "fallback",
  lastUpdated: null,
  loaded: {}
};

function cacheKey() {
  return `${state.category}:${state.season}:${state.torneo}`;
}

export { db, state, cacheKey };
