const CACHE_KEY = "promiedos_ar_cache_v5";
const CACHE_TTL_MS = 120000;

const CURRENT_SEASON = 2026;

// El futbol argentino volvio al formato Apertura/Clausura a partir de 2024:
// cada anio tiene DOS torneos regulares. La Tabla Anual suma los puntos de
// ambos, y los Promedios suman puntos/partidos de los ultimos 3 anios
// completos (Apertura + Clausura de cada uno). Antes de 2024 era un torneo
// unico por temporada.
const SPLIT_SEASON_MIN_YEAR = 2024;
const SELECTABLE_SEASONS = [CURRENT_SEASON, CURRENT_SEASON - 1, CURRENT_SEASON - 2, CURRENT_SEASON - 3];

const LEAGUE_CODE = { primera: "arg.1", segunda: "arg.2" };

const API = {
  primera: { scoreboard: "https://site.api.espn.com/apis/site/v2/sports/soccer/arg.1/scoreboard" },
  segunda: { scoreboard: "https://site.api.espn.com/apis/site/v2/sports/soccer/arg.2/scoreboard" }
};


// Entre enero y junio se juega el Apertura; entre julio y diciembre, el Clausura.
function defaultTorneo() {
  const month = new Date().getMonth() + 1;
  return month >= 7 ? "clausura" : "apertura";
}

const PLACEHOLDER_LOGO = "https://placehold.co/20x20/1a1a1a/ffffff.png";

export { CACHE_KEY, CACHE_TTL_MS, CURRENT_SEASON, SPLIT_SEASON_MIN_YEAR, SELECTABLE_SEASONS, LEAGUE_CODE, API, PLACEHOLDER_LOGO, defaultTorneo };