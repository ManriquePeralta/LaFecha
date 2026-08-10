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

function standingsBaseUrl(leagueCode, season, seasonTypeId) {
  const qs = seasonTypeId ? `&seasontype=${seasonTypeId}` : "";
  return `https://site.api.espn.com/apis/v2/sports/soccer/${leagueCode}/standings?season=${season}${qs}`;
}

function extractSeasonTypeName(raw) {
  return raw?.season?.type?.name || raw?.seasonType?.name || raw?.type?.name || raw?.name || "";
}

function tableFingerprint(parsed) {
  return (parsed.tabla || [])
    .map((r) => `${normalize(r.equipo)}:${r.pts}:${r.pj}`)
    .sort()
    .join("|");
}

function avgPj(parsed) {
  const rows = parsed.tabla || [];
  if (!rows.length) return 0;
  return rows.reduce((sum, r) => sum + Number(r.pj || 0), 0) / rows.length;
}

// No confiamos en un numero fijo de seasontype para distinguir Apertura de
// Clausura: la convencion estandar de ESPN (1/2/3 = pre/regular/postemporada)
// no aplica igual a un torneo partido en dos como el argentino. Probamos
// varios ids en paralelo y clasificamos con dos metodos, en orden:
//   1) el nombre que devuelve la propia respuesta (si viene informativo)
//   2) si no hay nombre util, comparamos partidos jugados: el torneo con
//      MENOS partidos en promedio es el que esta en curso (Clausura), el que
//      tiene MAS (cerca del total de fechas) es el que ya termino (Apertura).
// Si ambos ids devuelven exactamente la misma tabla, solo hay UN torneo
// disponible en esta fuente y lo clasificamos por cuan avanzado esta.
const seasonTypeCache = new Map();
const seasonTypeInFlight = new Map();

async function discoverSeasonTypes(category, season) {
  const key = `${category}:${season}`;
  if (seasonTypeCache.has(key)) return seasonTypeCache.get(key);
  if (seasonTypeInFlight.has(key)) return seasonTypeInFlight.get(key);

  const discoveryPromise = (async () => {
    const leagueCode = LEAGUE_CODE[category];
    const candidateIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, null];

    const result = {
      apertura: null,
      clausura: null,
      fallbackId: null,
      onlyOneAvailable: false,
      entries: []
    };

    try {
      const metaRes = await fetch(standingsBaseUrl(leagueCode, season, null));
      if (metaRes.ok) {
        const metaJson = await metaRes.json();
        const seasonEntry = (metaJson.seasons || []).find((s) => Number(s.year) === Number(season)) || metaJson.season || null;
        const seasonTypes = (seasonEntry?.types || []).filter((t) => t?.hasStandings);

        if (seasonTypes.length) {
          result.fallbackId = Number(seasonTypes[0].id);
          seasonTypes.forEach((type) => {
            const name = normalize(type.name || type.abbreviation || "");
            if (name.includes("apertura")) result.apertura = Number(type.id);
            else if (name.includes("clausura")) result.clausura = Number(type.id);
          });

          if (result.apertura === null && result.clausura === null && seasonTypes.length === 1) {
            const only = Number(seasonTypes[0].id);
            const onlyName = normalize(seasonTypes[0].name || seasonTypes[0].abbreviation || "");
            if (onlyName.includes("clausura")) result.clausura = only;
            else result.apertura = only;
            result.onlyOneAvailable = true;
          }
        }
      }
    } catch {
      // Si la metadata no responde, caemos al sondeo de ids como respaldo.
    }

    const probes = await Promise.all(
      candidateIds.map(async (id) => {
        try {
          const res = await fetch(standingsBaseUrl(leagueCode, season, id));
          if (!res.ok) return null;
          const json = await res.json();
          const parsed = parseStandings(json);
          if (!parsed.tabla.length) return null;
          return { id, name: extractSeasonTypeName(json), parsed };
        } catch {
          return null;
        }
      })
    );

    const valid = probes.filter(Boolean);
    result.entries = valid;
    if (result.fallbackId === null) result.fallbackId = valid[0]?.id ?? null;

    // Metodo 1: nombre informativo.
    valid.forEach((p) => {
      const n = normalize(p.name);
      if (n.includes("apertura")) result.apertura = p.id;
      else if (n.includes("clausura")) result.clausura = p.id;
    });

    // Metodo 2: si el nombre no sirvio, usamos partidos jugados sobre tablas
    // realmente distintas (deduplicadas por huella de datos).
    if (result.apertura === null && result.clausura === null && valid.length) {
      const distinctMap = new Map();
      valid.forEach((p) => {
        const fp = tableFingerprint(p.parsed);
        if (!distinctMap.has(fp)) distinctMap.set(fp, p);
      });
      const distinct = [...distinctMap.values()];

      if (distinct.length >= 2) {
        distinct.sort((a, b) => avgPj(a.parsed) - avgPj(b.parsed));
        result.clausura = distinct[0].id;
        result.apertura = distinct[distinct.length - 1].id;
      } else if (distinct.length === 1) {
        const only = distinct[0];
        const teamsCount = (only.parsed.tabla || []).length || 1;
        const roundsApprox = teamsCount - 1; // referencia: todos contra todos en la zona
        const pj = avgPj(only.parsed);
        result.onlyOneAvailable = true;
        if (pj > 0 && pj < roundsApprox * 0.6) {
          result.clausura = only.id;
        } else {
          result.apertura = only.id;
        }
      }
    }

    return result;
  })();

  // Cacheamos la promesa en vuelo para que llamados concurrentes (tabla
  // actual + anual/promedios pidiendo el mismo anio al mismo tiempo) reusen
  // el mismo sondeo en vez de disparar 5 fetches duplicados cada uno. El
  // resultado ya resuelto se guarda aparte para poder leerlo de forma
  // sincronica desde la UI (syncTorneoControls).
  seasonTypeInFlight.set(key, discoveryPromise);
  const result = await discoveryPromise;
  seasonTypeCache.set(key, result);
  seasonTypeInFlight.delete(key);
  return result;
}

async function fetchStandingsSafe(category, season, torneoKey) {
  const leagueCode = LEAGUE_CODE[category];
  const isSplit = category === "primera" && season >= SPLIT_SEASON_MIN_YEAR;

  if (!isSplit) {
    try {
      const res = await fetch(standingsBaseUrl(leagueCode, season, 1));
      if (!res.ok) return null;
      return parseStandings(await res.json());
    } catch {
      return null;
    }
  }

  const types = await discoverSeasonTypes(category, season);
  const seasonTypeId = types[torneoKey] ?? types.fallbackId;
  if (seasonTypeId === null || seasonTypeId === undefined) return null;

  const cached = types.entries.find((e) => e.id === seasonTypeId);
  if (cached) return cached.parsed;

  try {
    const res = await fetch(standingsBaseUrl(leagueCode, season, seasonTypeId));
    if (!res.ok) return null;
    return parseStandings(await res.json());
  } catch {
    return null;
  }
}

function summaryUrl(category, eventId) {
  return `https://site.api.espn.com/apis/site/v2/sports/soccer/${LEAGUE_CODE[category]}/summary?event=${eventId}`;
}

// Entre enero y junio se juega el Apertura; entre julio y diciembre, el Clausura.
function defaultTorneo() {
  const month = new Date().getMonth() + 1;
  return month >= 7 ? "clausura" : "apertura";
}

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

const PLACEHOLDER_LOGO = "https://placehold.co/20x20/1a1a1a/ffffff.png";

const $ = (s) => document.querySelector(s);
const matchesList = $("#matches-list");
const standingsSections = $("#standings-sections");
const playoffList = $("#playoff-list");
const playoffBox = $("#playoff-box");
const annualBody = $("#annual-body");
const averagesBody = $("#averages-body");
const annualBox = $("#annual-box");
const averagesBox = $("#averages-box");
const matchesTitle = $("#matches-title");
const liveStatus = $("#live-status");
const refreshBtn = $("#refresh-btn");
const liveOnlyInput = $("#live-only");
const liveOnlyWrap = $("#live-only-wrap");
const matchModal = $("#match-modal");
const modalContent = $("#modal-content");
const modalClose = $("#modal-close");
const detailPageRoot = $("#match-detail-page");
const detailBackBtn = $("#detail-back-btn");
const torneoSwitch = $("#torneo-switch");
const seasonSelect = $("#season-select");
const isDetailPage = Boolean(detailPageRoot);

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bySearch(teamA, teamB) {
  if (!state.search) return true;
  const needle = normalize(state.search);
  return normalize(teamA).includes(needle) || normalize(teamB || "").includes(needle);
}

function toYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// Ventana acotada (una semana para atras, un mes para adelante). Un rango
// enorme (meses) puede hacer que el endpoint de ESPN devuelva datos
// truncados o inconsistentes; esta ventana es la que realmente le sirve a
// alguien mirando resultados recientes y proximos partidos.
function getDateRangeParam() {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 7);
  const to = new Date(now);
  to.setDate(to.getDate() + 30);
  return `${toYmd(from)}-${toYmd(to)}`;
}

function fmtDateLong(iso) {
  if (!iso) return "Fecha a confirmar";
  return new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "2-digit", month: "long" }).format(new Date(iso));
}

function fmtHour(iso) {
  if (!iso) return "--:--";
  return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function setDate() {
  const now = new Date();
  $("#current-date").textContent = new Intl.DateTimeFormat("es-AR", {
    weekday: "long",
    day: "2-digit",
    month: "long"
  }).format(now);
}

function setLiveBanner(extra) {
  if (!liveStatus) return;
  const sourceText = state.source === "live" ? "Datos en vivo" : state.source === "cache" ? "Datos cache" : "Sin datos en vivo";
  const updatedText = state.lastUpdated
    ? ` | Actualizado ${new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(state.lastUpdated)}`
    : "";
  liveStatus.textContent = `${sourceText}${updatedText}${extra ? ` | ${extra}` : ""}`;
}

function saveCache() {
  try {
    localStorage.setItem(
      CACHE_KEY,
      JSON.stringify({
        savedAt: Date.now(),
        category: state.category,
        season: state.season,
        torneo: state.torneo,
        db
      })
    );
  } catch {
    // localStorage puede fallar en modo incognito o si esta lleno; no es critico, seguimos sin cache.
  }
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return false;
    const payload = JSON.parse(raw);
    if (!payload.savedAt || Date.now() - payload.savedAt > CACHE_TTL_MS || !payload.db) return false;
    if (payload.category !== state.category || payload.season !== state.season || payload.torneo !== state.torneo) return false;

    db.primera = payload.db.primera || db.primera;
    db.segunda = payload.db.segunda || db.segunda;
    state.source = "cache";
    state.lastUpdated = new Date(payload.savedAt);
    state.loaded[cacheKey()] = true;
    setLiveBanner("inicio rapido");
    return true;
  } catch {
    return false;
  }
}

function getStatValue(stats, names) {
  const found = (stats || []).find((s) => names.includes(normalize(s.name)));
  const n = Number(found?.value ?? found?.displayValue ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function parseScoreboard(raw) {
  const all = (raw.events || [])
    .map((event) => {
      const comp = event.competitions?.[0];
      if (!comp?.competitors) return null;

      const home = comp.competitors.find((c) => c.homeAway === "home") || comp.competitors[0];
      const away = comp.competitors.find((c) => c.homeAway === "away") || comp.competitors[1];
      if (!home || !away) return null;

      const statusType = comp.status?.type?.state || "pre";
      const dateIso = comp.date || event.date;

      return {
        id: String(comp.id || event.id || `${home.team?.id || home.team?.displayName}-${away.team?.id || away.team?.displayName}`),
        local: home.team?.shortDisplayName || home.team?.displayName || "Local",
        localLogo: home.team?.logo || PLACEHOLDER_LOGO,
        visitante: away.team?.shortDisplayName || away.team?.displayName || "Visitante",
        visitanteLogo: away.team?.logo || PLACEHOLDER_LOGO,
        gl: Number(home.score || 0),
        gv: Number(away.score || 0),
        estado: statusType === "in" ? "En juego" : statusType === "post" ? "Final" : "Programado",
        statusType,
        detalle: comp.status?.type?.shortDetail || comp.status?.type?.description || "",
        date: dateIso,
        fecha: fmtDateLong(dateIso),
        hora: fmtHour(dateIso)
      };
    })
    .filter(Boolean);

  return {
    all,
    resultados: all.filter((m) => m.statusType !== "pre").sort((a, b) => new Date(b.date) - new Date(a.date)),
    proximos: all.filter((m) => m.statusType === "pre").sort((a, b) => new Date(a.date) - new Date(b.date))
  };
}

function normalizeZoneName(name) {
  const raw = String(name || "").trim();
  if (/group a/i.test(raw)) return "Zona A";
  if (/group b/i.test(raw)) return "Zona B";
  if (/group/i.test(raw)) return raw.replace(/group/i, "Zona");
  return raw;
}

function parseStandingsEntries(entries) {
  return (entries || [])
    .map((entry) => {
      const stats = entry.stats || [];
      const gf = getStatValue(stats, ["pointsfor"]);
      const gc = getStatValue(stats, ["pointsagainst"]);
      return {
        equipo: entry.team?.shortDisplayName || entry.team?.displayName || "Equipo",
        logo: entry.team?.logos?.[0]?.href || PLACEHOLDER_LOGO,
        pts: getStatValue(stats, ["points"]),
        pj: getStatValue(stats, ["gamesplayed"]),
        dg: getStatValue(stats, ["pointdifferential"]),
        gf,
        gc,
        rank: getStatValue(stats, ["rank"])
      };
    })
    .sort((a, b) => {
      if (a.rank && b.rank) return a.rank - b.rank;
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.dg !== a.dg) return b.dg - a.dg;
      if (b.gf !== a.gf) return b.gf - a.gf;
      return a.equipo.localeCompare(b.equipo);
    });
}

function parseStandings(raw) {
  if (Array.isArray(raw.children) && raw.children.length) {
    const zonas = raw.children
      .map((child) => {
        const tabla = parseStandingsEntries(child.standings?.entries || []);
        if (!tabla.length) return null;
        return { nombre: normalizeZoneName(child.name || child.abbreviation || "Zona"), tabla };
      })
      .filter(Boolean);

    const seen = new Set();
    zonas.forEach((z) => {
      z.tabla = z.tabla.filter((r) => {
        const k = normalize(r.equipo);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    });

    return { zonas, tabla: zonas.flatMap((z) => z.tabla) };
  }

  const entries = raw.standings?.entries || (Array.isArray(raw.standings) ? raw.standings.flatMap((s) => s.entries || []) : []);
  const tabla = parseStandingsEntries(entries);
  return { zonas: tabla.length ? [{ nombre: "Tabla general", tabla }] : [], tabla };
}

// Suma pts/pj/dg/gf/gc de un mismo equipo a traves de varias tablas (por
// ejemplo Apertura + Clausura de un mismo anio, o de varios anios para
// promedios). Sirve tanto para la Tabla Anual (1 anio, 2 torneos) como para
// la Tabla de Promedios (3 anios, hasta 2 torneos cada uno).
function mergeStandingsTables(results) {
  const map = new Map();

  results.forEach((result) => {
    if (!result) return;
    (result.tabla || []).forEach((row) => {
      const key = normalize(row.equipo);
      if (!map.has(key)) {
        map.set(key, { equipo: row.equipo, logo: row.logo || PLACEHOLDER_LOGO, pts: 0, pj: 0, dg: 0, gf: 0, gc: 0 });
      }
      const acc = map.get(key);
      acc.pts += Number(row.pts || 0);
      acc.pj += Number(row.pj || 0);
      acc.dg += Number(row.dg || 0);
      acc.gf += Number(row.gf || 0);
      acc.gc += Number(row.gc || 0);
      if (acc.logo === PLACEHOLDER_LOGO && row.logo) acc.logo = row.logo;
    });
  });

  return [...map.values()].sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.dg !== a.dg) return b.dg - a.dg;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return a.equipo.localeCompare(b.equipo);
  });
}

function torneosForYear(year) {
  return year >= SPLIT_SEASON_MIN_YEAR ? ["apertura", "clausura"] : ["apertura"];
}

// Tabla Anual = puntos de Apertura + Clausura del anio seleccionado.
// Tabla de Promedios = puntos y partidos de los ultimos 3 anios (cada uno
// con sus torneos) divididos por el total de partidos jugados.
async function loadAnnualAndAverages(category, season) {
  if (category !== "primera") return { annual: [], averages: [] };

  const years = [season, season - 1, season - 2];
  const requests = [];

  years.forEach((year) => {
    torneosForYear(year).forEach((torneoKey) => {
      requests.push(
        fetchStandingsSafe(category, year, torneoKey).then((result) => ({ year, result }))
      );
    });
  });

  const settled = await Promise.all(requests);

  const annual = mergeStandingsTables(settled.filter((s) => s.year === season).map((s) => s.result));

  const averagesBase = mergeStandingsTables(settled.map((s) => s.result));
  const averages = averagesBase
    .map((r) => ({ ...r, prom: r.pj ? r.pts / r.pj : 0 }))
    .sort((a, b) => b.prom - a.prom);

  return { annual, averages };
}

async function loadCategoryData(category, forced = false) {
  if (state.isLoading) return;
  if (!forced && state.loaded[cacheKey()]) return;

  state.isLoading = true;
  refreshBtn.disabled = true;
  refreshBtn.textContent = "Actualizando...";

  try {
    const range = getDateRangeParam();
    const scoreboardUrl = `${API[category].scoreboard}?dates=${range}`;

    const [scoreRes, tableResult, annualAverages] = await Promise.all([
      fetch(scoreboardUrl).then((res) => {
        if (!res.ok) throw new Error("No response del scoreboard");
        return res.json();
      }),
      fetchStandingsSafe(category, state.season, state.torneo),
      loadAnnualAndAverages(category, state.season)
    ]);

    const parsedMatches = parseScoreboard(scoreRes);

    db[category].resultados = parsedMatches.resultados;
    db[category].proximos = parsedMatches.proximos;
    db[category].allMatches = parsedMatches.all;
    db[category].tabla = tableResult?.tabla || [];
    db[category].zonas = tableResult?.zonas || [];
    db[category].annual = annualAverages.annual;
    db[category].averages = annualAverages.averages;

    state.source = "live";
    state.lastUpdated = new Date();
    state.loaded[cacheKey()] = true;
    setLiveBanner();
    saveCache();
  } catch (e) {
    state.source = state.loaded[cacheKey()] ? "cache" : "fallback";
    state.lastUpdated = new Date();
    setLiveBanner("error de API");
    console.error(e);
  } finally {
    state.isLoading = false;
    if (!isDetailPage) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = "Actualizar";
      syncTorneoControls();
      renderAll();
    }
  }
}

function extractScorers(raw) {
  const events = raw?.keyEvents || raw?.commentary || [];
  return events
    .filter((e) => e?.scoringPlay || /goal/i.test(e?.type?.text || e?.type?.id || ""))
    .map((e) => ({
      minute: e?.clock?.displayValue || "",
      text: translateMatchDetailText(e?.text || e?.athletesInvolved?.[0]?.displayName || "")
    }))
    .filter((e) => e.text);
}

function extractCards(raw) {
  const events = raw?.keyEvents || raw?.commentary || [];
  return events
    .map((e) => {
      const typeText = String(e?.type?.text || e?.type?.id || "");
      const text = String(e?.text || "");
      const isYellow = /yellow card|booking|caution/i.test(typeText) || /yellow card/i.test(text);
      const isRed = /red card|sent off|sending off/i.test(typeText) || /red card|sent off|sending off/i.test(text);
      if (!isYellow && !isRed) return null;

      return {
        minute: e?.clock?.displayValue || "",
        kind: isRed ? "roja" : "amarilla",
        text: translateMatchDetailText(text || e?.athletesInvolved?.[0]?.displayName || "")
      };
    })
    .filter(Boolean);
}

function translateMatchDetailText(text) {
  const replacements = [
    [/Own Goal!/gi, "Gol en contra!"],
    [/Goal!/gi, "Gol!"],
    [/is shown the Tarjeta amarilla\.?/gi, "recibe tarjeta amarilla"],
    [/is shown the Tarjeta roja\.?/gi, "recibe tarjeta roja"],
    [/is shown the yellow card\.?/gi, "recibe tarjeta amarilla"],
    [/is shown a yellow card\.?/gi, "recibe tarjeta amarilla"],
    [/is shown the red card\.?/gi, "recibe tarjeta roja"],
    [/is shown a red card\.?/gi, "recibe tarjeta roja"],
    [/is shown the yellow card/gi, "recibe tarjeta amarilla"],
    [/is shown a yellow card/gi, "recibe tarjeta amarilla"],
    [/is shown the red card/gi, "recibe tarjeta roja"],
    [/is shown a red card/gi, "recibe tarjeta roja"],
    [/is shown the Tarjeta amarilla/gi, "recibe tarjeta amarilla"],
    [/is shown the Tarjeta roja/gi, "recibe tarjeta roja"],
    [/is shown the/gi, "recibe la"],
    [/is shown a/gi, "recibe una"],
    [/right footed shot from the centre of the box/gi, "remate de derecha desde el centro del área"],
    [/right footed shot from the center of the box/gi, "remate de derecha desde el centro del área"],
    [/left footed shot from the centre of the box/gi, "remate de izquierda desde el centro del área"],
    [/left footed shot from the center of the box/gi, "remate de izquierda desde el centro del área"],
    [/right footed shot/gi, "remate de derecha"],
    [/left footed shot/gi, "remate de izquierda"],
    [/header/gi, "cabezazo"],
    [/from the centre of the box/gi, "desde el centro del área"],
    [/from the center of the box/gi, "desde el centro del área"],
    [/from the right side of the box/gi, "desde el costado derecho del área"],
    [/from the left side of the box/gi, "desde el costado izquierdo del área"],
    [/to the bottom left corner/gi, "al rincón inferior izquierdo"],
    [/to the bottom right corner/gi, "al rincón inferior derecho"],
    [/to the top left corner/gi, "al rincón superior izquierdo"],
    [/to the top right corner/gi, "al rincón superior derecho"],
    [/assisted by/gi, "asistido por"],
    [/for a bad foul/gi, "por una falta dura"],
    [/for a foul/gi, "por una falta"],
    [/bad foul/gi, "falta dura"],
    [/\bSubstitution\b/gi, "Sustitución"],
    [/\bsubstitution\b/gi, "sustitución"],
    [/\bYellow Card\b/gi, "Tarjeta amarilla"],
    [/\byellow card\b/gi, "tarjeta amarilla"],
    [/\bRed Card\b/gi, "Tarjeta roja"],
    [/\bred card\b/gi, "tarjeta roja"],
    [/\bBooking\b/gi, "Amonestación"],
    [/\bbooking\b/gi, "amonestación"],
    [/\bCaution\b/gi, "Amonestación"],
    [/\bcaution\b/gi, "amonestación"],
    [/\bSent Off\b/gi, "Expulsado"],
    [/\bsent off\b/gi, "expulsado"],
    [/\bSending Off\b/gi, "Expulsión"],
    [/\bsending off\b/gi, "expulsión"],
    [/\bPenalty\b/gi, "Penal"],
    [/\bpenalty\b/gi, "penal"],
    [/\bMissed\b/gi, "Fallado"],
    [/\bmissed\b/gi, "fallado"],
    [/\bSaved\b/gi, "Atajado"],
    [/\bsaved\b/gi, "atajado"],
    [/\bBlocked\b/gi, "Bloqueado"],
    [/\bblocked\b/gi, "bloqueado"],
    [/\bOffside\b/gi, "Fuera de juego"],
    [/\boffside\b/gi, "fuera de juego"],
    [/\bCorner\b/gi, "Córner"],
    [/\bcorner\b/gi, "córner"],
    [/\bFoul\b/gi, "Falta"],
    [/\bfoul\b/gi, "falta"],
    [/\bVAR\b/gi, "VAR"],
    [/\bgoal\b/gi, "gol"]
  ];

  return replacements.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), String(text || ""));
}

function eventKindFromText(text) {
  const value = normalize(text);
  if (/tarjeta roja|red card|expuls/i.test(value)) return "red";
  if (/tarjeta amarilla|yellow card|amonest|caution|booking/i.test(value)) return "yellow";
  if (/gol|goal|own goal/i.test(value)) return "goal";
  if (/sustituc|substitution/i.test(value)) return "substitution";
  return "text";
}

function eventRowHtml(kind, minute, text) {
  return `
    <li class="event-row event-${kind}">
      <span class="event-minute">${minute || "--'"}</span>
      <span class="event-icon" aria-hidden="true"></span>
      <span class="event-text">${text}</span>
    </li>
  `;
}

function lineupDisplayName(player) {
  return player?.athlete?.displayName || player?.athlete?.shortName || "";
}

function lineupPositionLabel(player) {
  return player?.position?.abbreviation || player?.position?.displayName || "";
}

function pitchPlayerHtml(player) {
  const classes = ["pitch-player", `pitch-player-${player.roleGroup || "midfielder"}`];
  const positionLabel = lineupPositionLabel(player);
  const displayName = lineupDisplayName(player);
  const jersey = player?.jersey || "";

  return `
    <div class="${classes.join(" ")}">
      <span class="pitch-jersey">${jersey || "•"}</span>
      <span class="pitch-name">${displayName}</span>
      ${positionLabel ? `<span class="pitch-position">${positionLabel}</span>` : ""}
    </div>
  `;
}

function parseFormationCounts(formation) {
  const counts = String(formation || "")
    .split(/[-]/)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n) && n > 0);

  return counts.length ? counts : [4, 4, 2];
}

function lineupRoleGroup(player) {
  const positionName = normalize(player?.position?.displayName || player?.position?.name || "");
  const positionAbbr = String(player?.position?.abbreviation || "").toUpperCase();

  if (!player || positionAbbr === "SUB" || positionName.includes("substitute")) return "bench";
  if (positionAbbr === "G" || positionName.includes("goalkeeper")) return "goalkeeper";
  if (positionName.includes("defender") || /^(LB|RB|CB|CD|WB|SW|DF)/.test(positionAbbr)) return "defender";
  if (positionName.includes("forward") || /^(F|CF|ST|LF|RF)/.test(positionAbbr)) return "forward";
  return "midfielder";
}

function sortLineupPlayers(players) {
  return [...(players || [])].sort((a, b) => {
    const placeDiff = Number(a?.formationPlace || 99) - Number(b?.formationPlace || 99);
    if (placeDiff) return placeDiff;

    const roleDiff = lineupRoleGroup(a).localeCompare(lineupRoleGroup(b));
    if (roleDiff) return roleDiff;

    return lineupDisplayName(a).localeCompare(lineupDisplayName(b));
  });
}

function assignPlayersToRows(lineup) {
  const sorted = sortLineupPlayers(lineup.starters);
  const formation = parseFormationCounts(lineup.formation);
  const rows = [];

  const goalkeeper = sorted.find((player) => lineupRoleGroup(player) === "goalkeeper") || sorted.shift() || null;
  if (goalkeeper) {
    rows.push({ roleGroup: "goalkeeper", players: [goalkeeper] });
  }

  const outfield = sorted.filter((player) => lineupRoleGroup(player) !== "goalkeeper");
  const totalSlots = formation.reduce((sum, count) => sum + count, 0);
  const usable = outfield.slice(0, totalSlots);
  let index = 0;

  formation.forEach((count, rowIndex) => {
    rows.push({
      roleGroup: rowIndex === formation.length - 1 ? "forward" : rowIndex === 0 ? "defender" : rowIndex === formation.length - 2 ? "midfielder" : "midfielder",
      players: usable.slice(index, index + count)
    });
    index += count;
  });

  const remaining = outfield.slice(index);
  if (remaining.length && rows.length) {
    rows[rows.length - 1].players.push(...remaining);
  }

  return rows.filter((row) => row.players.length);
}

function pitchRowHtml(row, rowIndex, rowCount) {
  const top = rowCount === 1 ? 50 : 8 + (rowIndex * 84) / (rowCount - 1);
  const isGoalkeeper = row.roleGroup === "goalkeeper";
  const classes = ["pitch-row", `pitch-row-${row.roleGroup}`];

  return `
    <div class="${classes.join(" ")}" style="top:${top}%">
      ${row.players.map((player) => pitchPlayerHtml({
        ...player,
        roleGroup: isGoalkeeper ? "goalkeeper" : lineupRoleGroup(player)
      })).join("")}
    </div>
  `;
}

function pitchCardHtml(lineup) {
  const rows = assignPlayersToRows(lineup);
  return `
    <article class="pitch-card">
      <div class="pitch-card-head">
        <h4>${lineup.team}</h4>
        <span>${lineup.formation || "4-4-2"}</span>
      </div>
      <div class="pitch-surface">
        <div class="pitch-stripes"></div>
        <div class="pitch-midline"></div>
        <div class="pitch-circle"></div>
        ${rows.map((row, index) => pitchRowHtml(row, index, rows.length)).join("")}
      </div>
    </article>
  `;
}

function extractLineups(raw) {
  const rosters = raw?.rosters || [];
  return rosters
    .map((r) => ({
      team: r?.team?.displayName || r?.team?.shortDisplayName || "",
      formation: r?.formation || "",
      starters: (r?.roster || [])
        .filter((p) => p?.starter && p?.athlete)
        .map((p) => ({
          jersey: p?.jersey || "",
          formationPlace: p?.formationPlace || "",
          position: p?.position || {},
          athlete: p?.athlete || {},
          name: lineupDisplayName(p)
        }))
        .filter((p) => p.name)
    }))
    .filter((l) => l.team);
}

function extractVenue(raw) {
  const venue = raw?.gameInfo?.venue || raw?.header?.competitions?.[0]?.venue;
  return venue?.fullName || "";
}

function parseSummaryMatch(raw, fallbackMatchId) {
  const comp = raw?.header?.competitions?.[0] || raw?.competition || raw?.events?.[0]?.competitions?.[0];
  if (!comp?.competitors) return null;

  const home = comp.competitors.find((c) => c.homeAway === "home") || comp.competitors[0];
  const away = comp.competitors.find((c) => c.homeAway === "away") || comp.competitors[1];
  if (!home || !away) return null;

  const statusType = comp.status?.type?.state || "pre";
  const dateIso = comp.date || raw?.header?.competitions?.[0]?.date || raw?.eventDate || raw?.date;

  return {
    id: String(comp.id || fallbackMatchId || raw?.header?.id || raw?.id || ""),
    local: home.team?.shortDisplayName || home.team?.displayName || "Local",
    localLogo: home.team?.logo || PLACEHOLDER_LOGO,
    visitante: away.team?.shortDisplayName || away.team?.displayName || "Visitante",
    visitanteLogo: away.team?.logo || PLACEHOLDER_LOGO,
    gl: Number(home.score || 0),
    gv: Number(away.score || 0),
    estado: statusType === "in" ? "En juego" : statusType === "post" ? "Final" : "Programado",
    statusType,
    detalle: comp.status?.type?.shortDetail || comp.status?.type?.description || "",
    date: dateIso,
    fecha: fmtDateLong(dateIso),
    hora: fmtHour(dateIso)
  };
}

function matchHeaderHtml(match, extra) {
  return `
    <div class="modal-header">
      <span class="team-with-logo"><img class="team-logo" src="${match?.localLogo || PLACEHOLDER_LOGO}" alt="" /><strong>${match?.local || "Local"}</strong></span>
      <span class="modal-score">${match ? `${match.gl} - ${match.gv}` : "vs"}</span>
      <span class="team-with-logo"><img class="team-logo" src="${match?.visitanteLogo || PLACEHOLDER_LOGO}" alt="" /><strong>${match?.visitante || "Visitante"}</strong></span>
    </div>
    <p class="modal-meta">${match ? `${match.fecha} ${match.hora} · ${match.estado}` : ""}${extra ? ` · ${extra}` : ""}</p>
  `;
}

function buildMatchDetailHtml(raw, match) {
  const scorers = extractScorers(raw);
  const cards = extractCards(raw);
  const lineups = extractLineups(raw);
  const venue = extractVenue(raw);
  const summaryCard = `
    <div class="match-summary-card">
      <span>${scorers.length} gol${scorers.length === 1 ? "" : "es"}</span>
      <span>${cards.filter((c) => c.kind === "amarilla").length} amarilla${cards.filter((c) => c.kind === "amarilla").length === 1 ? "" : "s"}</span>
      <span>${cards.filter((c) => c.kind === "roja").length} roja${cards.filter((c) => c.kind === "roja").length === 1 ? "" : "s"}</span>
    </div>
  `;

  const scorersHtml = scorers.length
    ? `<ul class="event-list">${scorers.map((s) => eventRowHtml("goal", s.minute, s.text)).join("")}</ul>`
    : '<p class="empty-inline">Sin goles registrados por la API.</p>';

  const yellowCards = cards.filter((c) => c.kind === "amarilla");
  const redCards = cards.filter((c) => c.kind === "roja");

  const yellowCardsHtml = yellowCards.length
    ? `<ul class="event-list">${yellowCards.map((c) => eventRowHtml("yellow", c.minute, c.text || "Tarjeta amarilla")).join("")}</ul>`
    : '<p class="empty-inline">No se registraron tarjetas amarillas.</p>';

  const redCardsHtml = redCards.length
    ? `<ul class="event-list">${redCards.map((c) => eventRowHtml("red", c.minute, c.text || "Tarjeta roja")).join("")}</ul>`
    : '<p class="empty-inline">No se registraron tarjetas rojas.</p>';

  const lineupsHtml = lineups.length
    ? `<div class="pitch-grid">${lineups.map((l) => pitchCardHtml(l)).join("")}</div>`
    : '<p class="empty-inline">Formaciones no disponibles para este partido.</p>';

  return `
    ${matchHeaderHtml(match, venue)}
    ${summaryCard}
    <section class="modal-section">
      <h3 class="sub-title">Goles</h3>
      ${scorersHtml}
    </section>
    <section class="modal-section">
      <h3 class="sub-title">Tarjetas amarillas</h3>
      ${yellowCardsHtml}
    </section>
    <section class="modal-section">
      <h3 class="sub-title">Tarjetas rojas</h3>
      ${redCardsHtml}
    </section>
    <section class="modal-section">
      <h3 class="sub-title">Formaciones</h3>
      ${lineupsHtml}
    </section>
  `;
}

function renderMatchDetail(raw, match) {
  if (!modalContent) return;
  modalContent.innerHTML = buildMatchDetailHtml(raw, match);
}

function detailPageUrl(matchId) {
  const params = new URLSearchParams({
    matchId: String(matchId),
    category: state.category,
    season: String(state.season),
    torneo: state.torneo
  });
  return `detail.html?${params.toString()}`;
}

async function openMatchDetail(matchId) {
  window.location.href = detailPageUrl(matchId);
}

async function initDetailPage() {
  if (!detailPageRoot) return;

  const params = new URLSearchParams(window.location.search);
  const matchId = params.get("matchId");
  const categoryParam = params.get("category");
  const seasonParam = Number(params.get("season"));
  const torneoParam = params.get("torneo");

  state.category = categoryParam === "segunda" ? "segunda" : "primera";
  state.season = Number.isFinite(seasonParam) ? seasonParam : CURRENT_SEASON;
  state.torneo = torneoParam === "clausura" ? "clausura" : "apertura";

  if (detailBackBtn) detailBackBtn.href = `index.html`;

  detailPageRoot.innerHTML = '<p class="detail-loading">Cargando detalle del partido...</p>';

  if (!matchId) {
    detailPageRoot.innerHTML = '<p class="detail-empty">No se indicó el partido.</p>';
    return;
  }

  try {
    const res = await fetch(summaryUrl(state.category, matchId));
    if (!res.ok) throw new Error("summary fetch failed");
    const raw = await res.json();

    const match = parseSummaryMatch(raw, matchId);
    if (!match) {
      detailPageRoot.innerHTML = '<p class="detail-empty">No se pudo leer el partido desde ESPN.</p>';
      return;
    }

    detailPageRoot.innerHTML = `<div class="detail-article">${buildMatchDetailHtml(raw, match)}</div>`;
  } catch (e) {
    console.error(e);
    detailPageRoot.innerHTML = '<p class="detail-empty">No se pudo cargar el detalle de este partido.</p>';
  }
}

function closeMatchDetail() {
  matchModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

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

function matchCardHtml(m, view) {
  if (view === "resultados") {
    const badgeClass = m.estado === "En juego" ? "badge-live" : m.estado === "Final" ? "badge-final" : "badge-scheduled";
    return `
      <article class="match-card clickable ${m.estado === "En juego" ? "live" : ""}" data-match-id="${m.id}" tabindex="0" role="button" aria-label="Ver detalle del partido">
        <p class="teams teams-line">
          <span class="team-with-logo"><img class="team-logo" src="${m.localLogo || PLACEHOLDER_LOGO}" alt="" /><strong>${m.local}</strong></span>
          <span class="vs">vs</span>
          <span class="team-with-logo"><img class="team-logo" src="${m.visitanteLogo || PLACEHOLDER_LOGO}" alt="" /><strong>${m.visitante}</strong></span>
        </p>
        <p class="meta">${m.gl} - ${m.gv} <span class="status ${badgeClass}">${m.estado}</span> <span class="detail">${m.hora}</span></p>
      </article>
    `;
  }

  return `
    <article class="match-card clickable" data-match-id="${m.id}" tabindex="0" role="button" aria-label="Ver detalle del partido">
      <p class="teams teams-line">
        <span class="team-with-logo"><img class="team-logo" src="${m.localLogo || PLACEHOLDER_LOGO}" alt="" /><strong>${m.local}</strong></span>
        <span class="vs">vs</span>
        <span class="team-with-logo"><img class="team-logo" src="${m.visitanteLogo || PLACEHOLDER_LOGO}" alt="" /><strong>${m.visitante}</strong></span>
      </p>
      <p class="meta">${m.hora} <span class="status badge-scheduled">Programado</span> ${m.detalle ? `<span class="detail">${m.detalle}</span>` : ""}</p>
    </article>
  `;
}

function groupByFecha(matches) {
  const groups = [];
  let lastFecha = null;
  matches.forEach((m) => {
    if (m.fecha !== lastFecha) {
      lastFecha = m.fecha;
      groups.push({ fecha: m.fecha, items: [] });
    }
    groups[groups.length - 1].items.push(m);
  });
  return groups;
}

function renderMatches() {
  const liga = db[state.category];
  const source = liga[state.view] || [];

  matchesTitle.textContent = state.view === "resultados" ? "Resultados" : state.view === "proximos" ? "Proximos" : "Resumen";

  if (state.view === "tabla") {
    matchesList.innerHTML = '<article class="empty">Selecciona Resultados o Proximos para ver partidos.</article>';
    return;
  }

  const filtered = source.filter((m) => {
    const liveOk = !state.liveOnly || m.estado === "En juego";
    return liveOk && bySearch(m.local, m.visitante);
  });

  if (!filtered.length) {
    matchesList.innerHTML = '<article class="empty">No hay partidos en la API para ese filtro.</article>';
    return;
  }

  const groups = groupByFecha(filtered);

  matchesList.innerHTML = groups
    .map(
      (g) => `
        <div class="match-date-group">
          <p class="match-date-heading">${g.fecha}</p>
          ${g.items.map((m) => matchCardHtml(m, state.view)).join("")}
        </div>
      `
    )
    .join("");
}

function findCrossMatch(teamA, teamB, allMatches) {
  const nA = normalize(teamA);
  const nB = normalize(teamB);
  const sameTeam = (x, y) => x === y || x.includes(y) || y.includes(x);

  return (allMatches || []).find((m) => {
    const l = normalize(m.local);
    const v = normalize(m.visitante);
    return (sameTeam(l, nA) && sameTeam(v, nB)) || (sameTeam(l, nB) && sameTeam(v, nA));
  });
}

function annualRowClass(pos, len) {
  if (pos === 1) return "row-leader";
  if (pos >= 2 && pos <= 4) return "row-libertadores";
  if (pos >= 5 && pos <= 10) return "row-sudamericana";
  if (pos === len) return "row-descenso";
  return "";
}

function torneoLabel(torneoKey) {
  return torneoKey === "clausura" ? "Clausura" : "Apertura";
}

function updateTableContext() {
  const contextEl = $("#table-context");
  if (!contextEl) return;
  if (state.category !== "primera") {
    contextEl.textContent = `Temporada ${state.season}`;
    return;
  }
  const isSplit = state.season >= SPLIT_SEASON_MIN_YEAR;
  if (!isSplit) {
    contextEl.textContent = `Temporada ${state.season}`;
    return;
  }

  const discovered = seasonTypeCache.get(`${state.category}:${state.season}`);
  let text = `Torneo ${torneoLabel(state.torneo)} ${state.season}`;
  if (discovered?.onlyOneAvailable) {
    const otherTorneo = state.torneo === "apertura" ? "Clausura" : "Apertura";
    text += ` (el ${otherTorneo} no esta disponible por separado en esta fuente todavia)`;
  }
  contextEl.textContent = text;
}

function renderStandingsAndCrosses() {
  updateTableContext();
  const liga = db[state.category];
  const zonasRaw = Array.isArray(liga.zonas) && liga.zonas.length ? liga.zonas : [{ nombre: "Tabla general", tabla: liga.tabla || [] }];

  const zonas = zonasRaw
    .map((z) => ({ nombre: z.nombre, tabla: (z.tabla || []).filter((r) => bySearch(r.equipo)) }))
    .filter((z) => z.tabla.length);

  if (!zonas.length) {
    standingsSections.innerHTML = '<article class="empty">No hay tabla disponible en la API para esta categoria.</article>';
    playoffList.innerHTML = '<article class="empty">Sin cruces para mostrar.</article>';
    return zonasRaw;
  }

  standingsSections.innerHTML = zonas
    .map((zona) => {
      const rows = zona.tabla
        .map((row, idx) => {
          const pos = row.rank || idx + 1;
          const rowClass = pos <= 8 ? "playoff" : "";
          return `
            <tr class="${rowClass}">
              <td>${pos}</td>
              <td><span class="team-with-logo"><img class="team-logo" src="${row.logo || PLACEHOLDER_LOGO}" alt="" />${row.equipo}</span></td>
              <td class="cell-pts">${row.pts}</td>
              <td>${row.pj}</td>
              <td>${row.dg > 0 ? "+" : ""}${row.dg}</td>
            </tr>
          `;
        })
        .join("");

      return `
        <section class="zone-block">
          <h3 class="sub-title">${zona.nombre}</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Equipo</th>
                  <th>PTS</th>
                  <th>PJ</th>
                  <th>DG</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </section>
      `;
    })
    .join("");

  if (state.category !== "primera" || state.season !== CURRENT_SEASON) {
    playoffBox.style.display = "none";
    return zonasRaw;
  }

  playoffBox.style.display = "block";
  const zoneA = zonasRaw.find((z) => /a/i.test(z.nombre)) || zonasRaw[0];
  const zoneB = zonasRaw.find((z) => /b/i.test(z.nombre) && z !== zoneA) || zonasRaw[1];

  // El cruce cruzado (mejor de una zona vs peor de la otra) necesita dos zonas
  // con al menos 2 equipos cada una. Ya no exigimos exactamente 8: se adapta
  // al tamano real de las zonas que devuelva la API para este torneo/temporada.
  if (!zoneA?.tabla?.length || !zoneB?.tabla?.length || zoneA.tabla.length < 2 || zoneB.tabla.length < 2) {
    playoffList.innerHTML = '<article class="empty">No hay zonas completas para proyectar cruces.</article>';
    return zonasRaw;
  }

  const crossSize = Math.min(8, zoneA.tabla.length, zoneB.tabla.length);
  const half = Math.floor(crossSize / 2);

  if (half < 1) {
    playoffList.innerHTML = '<article class="empty">No hay suficientes equipos para proyectar cruces.</article>';
    return zonasRaw;
  }

  const a = zoneA.tabla.slice(0, crossSize);
  const b = zoneB.tabla.slice(0, crossSize);
  const allMatches = liga.allMatches || [];

  const rawCrosses = [];
  for (let i = 0; i < half; i++) rawCrosses.push([a[i], b[crossSize - 1 - i]]);
  for (let i = 0; i < half; i++) rawCrosses.push([b[i], a[crossSize - 1 - i]]);

  const crosses = rawCrosses.filter(([l, v]) => bySearch(l.equipo, v.equipo));

  playoffList.innerHTML = crosses
    .map(([local, visitante]) => {
      const current = findCrossMatch(local.equipo, visitante.equipo, allMatches);
      const marker = current ? `${current.gl}-${current.gv} (${current.estado})` : "Sin partido cargado";
      return `
        <article class="cross-card">
          <p class="teams"><strong>${local.equipo}</strong> vs <strong>${visitante.equipo}</strong></p>
          <p class="meta">${marker}</p>
        </article>
      `;
    })
    .join("");

  return zonasRaw;
}

function renderAnnualAndAverages() {
  const liga = db[state.category];

  if (!annualBox || !averagesBox) return;

  if (state.category !== "primera") {
    annualBox.style.display = "none";
    averagesBox.style.display = "none";
    return;
  }

  annualBox.style.display = "block";
  averagesBox.style.display = "block";

  const annual = (liga.annual || []).filter((r) => bySearch(r.equipo));
  const annualLen = annual.length;

  annualBody.innerHTML = annual
    .map((r, idx) => {
      const pos = idx + 1;
      return `
        <tr class="${annualRowClass(pos, annualLen)}">
          <td>${pos}</td>
          <td><span class="team-with-logo"><img class="team-logo" src="${r.logo || PLACEHOLDER_LOGO}" alt="" />${r.equipo}</span></td>
          <td class="cell-pts">${r.pts}</td>
          <td>${r.pj}</td>
          <td>${r.dg > 0 ? "+" : ""}${r.dg}</td>
        </tr>
      `;
    })
    .join("");

  const avg = (liga.averages || []).filter((r) => bySearch(r.equipo));
  const avgLen = avg.length;

  averagesBody.innerHTML = avg
    .map((r, idx) => {
      const pos = idx + 1;
      return `
        <tr class="${annualRowClass(pos, avgLen)}">
          <td>${pos}</td>
          <td><span class="team-with-logo"><img class="team-logo" src="${r.logo || PLACEHOLDER_LOGO}" alt="" />${r.equipo}</span></td>
          <td class="cell-pts">${r.pts}</td>
          <td>${r.pj}</td>
          <td>${r.prom.toFixed(3)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderAll() {
  if (isDetailPage) return;
  renderMatches();
  renderStandingsAndCrosses();
  renderAnnualAndAverages();
}

function setActiveButtons(group, key, value) {
  document.querySelectorAll(group).forEach((btn) => {
    const active = btn.dataset[key] === value;
    btn.classList.toggle("active", active);
    btn.setAttribute("aria-selected", String(active));
  });
}

if (!isDetailPage) {
  document.querySelectorAll("[data-category]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.category = btn.dataset.category;
      setActiveButtons("[data-category]", "category", state.category);
      syncTorneoControls();
      renderAll();
      loadCategoryData(state.category, true);
    });
  });

  document.querySelectorAll("[data-torneo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      state.torneo = btn.dataset.torneo;
      setActiveButtons("[data-torneo]", "torneo", state.torneo);
      renderAll();
      loadCategoryData(state.category, true);
    });
  });

  seasonSelect.addEventListener("change", (e) => {
    state.season = Number(e.target.value);
    syncTorneoControls();
    renderAll();
    loadCategoryData(state.category, true);
  });

  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.view = btn.dataset.view;
      setActiveButtons("[data-view]", "view", state.view);
      syncLiveOnlyAvailability();
      renderMatches();
    });
  });

  $("#team-search").addEventListener("input", (e) => {
    state.search = e.target.value.trim();
    renderAll();
  });

  liveOnlyInput.addEventListener("change", (e) => {
    state.liveOnly = e.target.checked;
    renderMatches();
  });

  refreshBtn.addEventListener("click", () => {
    loadCategoryData(state.category, true);
  });

  matchesList.addEventListener("click", (e) => {
    const card = e.target.closest(".match-card[data-match-id]");
    if (!card) return;
    openMatchDetail(card.dataset.matchId);
  });

  matchesList.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".match-card[data-match-id]");
    if (!card) return;
    e.preventDefault();
    openMatchDetail(card.dataset.matchId);
  });

  if (modalClose) modalClose.addEventListener("click", closeMatchDetail);

  if (matchModal) {
    matchModal.addEventListener("click", (e) => {
      if (e.target === matchModal) closeMatchDetail();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && matchModal && !matchModal.classList.contains("hidden")) closeMatchDetail();
  });

  setDate();
  populateSeasonSelect();
  syncTorneoControls();
  loadCache();
  setLiveBanner();
  syncLiveOnlyAvailability();
  renderAll();
  loadCategoryData(state.category, true);

  setInterval(() => {
    loadCategoryData(state.category, true);
  }, 60000);
} else {
  initDetailPage();
}