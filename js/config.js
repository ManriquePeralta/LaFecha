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

// Competiciones que alimentan la portada diaria. El orden es intencional:
// las dos categorías argentinas deben aparecer antes que cualquier otra.
const HOME_LEAGUES = [
  { code: "arg.1", name: "Argentina - Primera División", category: "primera", priority: 0 },
  { code: "arg.2", name: "Argentina - Primera Nacional", category: "segunda", priority: 1 },
  { code: "arg.copa", name: "Argentina - Copa Argentina", category: "espn", priority: 2 },
  { code: "conmebol.libertadores", name: "CONMEBOL Copa Libertadores", category: "espn", priority: 10 },
  { code: "conmebol.sudamericana", name: "CONMEBOL Copa Sudamericana", category: "espn", priority: 11 },
  { code: "uefa.champions", name: "UEFA Champions League", category: "espn", priority: 20 },
  { code: "uefa.europa", name: "UEFA Europa League", category: "espn", priority: 21 },
  { code: "eng.1", name: "Inglaterra - Premier League", category: "espn", priority: 30 },
  { code: "esp.1", name: "España - LaLiga", category: "espn", priority: 31 },
  { code: "ita.1", name: "Italia - Serie A", category: "espn", priority: 32 },
  { code: "ger.1", name: "Alemania - Bundesliga", category: "espn", priority: 33 },
  { code: "fra.1", name: "Francia - Ligue 1", category: "espn", priority: 34 },
  { code: "bra.1", name: "Brasil - Série A", category: "espn", priority: 35 },
  { code: "uru.1", name: "Uruguay - Primera División", category: "espn", priority: 36 },
  { code: "chi.1", name: "Chile - Primera División", category: "espn", priority: 37 },
  { code: "col.1", name: "Colombia - Liga BetPlay", category: "espn", priority: 38 }
];


// Entre enero y junio se juega el Apertura; entre julio y diciembre, el Clausura.
function defaultTorneo() {
  const month = new Date().getMonth() + 1;
  return month >= 7 ? "clausura" : "apertura";
}

const PLACEHOLDER_LOGO = "https://placehold.co/20x20/1a1a1a/ffffff.png";

export { CACHE_KEY, CACHE_TTL_MS, CURRENT_SEASON, SPLIT_SEASON_MIN_YEAR, SELECTABLE_SEASONS, LEAGUE_CODE, API, HOME_LEAGUES, PLACEHOLDER_LOGO, defaultTorneo };
