import { CACHE_KEY, CACHE_TTL_MS, CURRENT_SEASON, SPLIT_SEASON_MIN_YEAR } from "./config.js";
import { db, state, cacheKey } from "./state.js";
import { $, liveStatus, refreshBtn, isDetailPage } from "./dom.js";
import { getDateRangeParam, noCacheFetch } from "./utils.js";
import { parseScoreboard, mergeStandingsTables } from "./api-parse.js";
import { fetchStandingsSafe } from "./season-types.js";
import { renderAll } from "./render-standings.js";
import { syncTorneoControls } from "./ui-controls.js";
import { API } from "./config.js";

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

// Cuanto mas seguido consultamos mientras hay un partido en vivo en la
// categoria/vista actual. Cuando no hay nada en vivo, no tiene sentido
// pedirle a ESPN cada 15 segundos: nada va a cambiar entre pedido y pedido.
const LIVE_POLL_MS = 15000;
const IDLE_POLL_MS = 60000;

function hasLiveMatch(category) {
  return (db[category]?.resultados || []).some((m) => m.estado === "En juego");
}

let pollTimer = null;

// Programa el proximo refresh en base a si hay algo en vivo AHORA MISMO
// (no en base a lo que habia cuando arranco el timer anterior). Se llama
// sola al final de cada loadCategoryData exitoso o fallido, asi que no hace
// falta un setInterval fijo aparte: el intervalo se recalcula solo, y si el
// usuario cambia de categoria/torneo (que dispara su propio
// loadCategoryData con forced=true), el timer viejo se cancela y arranca
// uno nuevo para lo que este mirando ahora.
function scheduleNextPoll() {
  if (pollTimer) clearTimeout(pollTimer);
  const delay = hasLiveMatch(state.category) ? LIVE_POLL_MS : IDLE_POLL_MS;
  pollTimer = setTimeout(() => {
    loadCategoryData(state.category, true);
  }, delay);
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
      noCacheFetch(scoreboardUrl).then((res) => {
        if (!res.ok) throw new Error("No response del scoreboard");
        return res.json();
      }),
      fetchStandingsSafe(category, state.season, state.torneo),
      loadAnnualAndAverages(category, state.season)
    ]);

const parsedMatches = parseScoreboard(scoreRes);

    // 1. Guardamos primero los partidos procesados
    db[category].resultados = parsedMatches.resultados;
    db[category].proximos = parsedMatches.proximos;
    db[category].allMatches = parsedMatches.all;

    // 2. Extraemos las tablas crudas de la API
    const rawTabla = tableResult?.tabla || [];
    const rawZonas = tableResult?.zonas || [];

    // 3. RECONCILIACIÓN AUTOMÁTICA: Corregimos los olvidos de la API (ej: Tristán Suárez)
    db[category].tabla = reconcileStandingsWithMatches(rawTabla, parsedMatches.all);

    db[category].zonas = rawZonas.map((zona) => ({
      ...zona,
      tabla: reconcileStandingsWithMatches(zona.tabla || [], parsedMatches.all)
    }));

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
      scheduleNextPoll();
    }
  }
}
export function reconcileStandingsWithMatches(standings, matches) {
  if (!Array.isArray(standings) || !standings.length) return standings;
  if (!Array.isArray(matches) || !matches.length) return standings;

  const updatedTable = JSON.parse(JSON.stringify(standings));

  // Helper para limpiar nombres y abreviaturas comunes (ej: T. Suárez -> Tristan Suarez)
  const cleanName = (str) =>
    normalize(str || "")
      .replace(/^t\.\s*/, "tristan ")
      .replace(/^g\.\s*/, "gimnasia ")
      .replace(/\(j\)/, "")
      .trim();

  matches.forEach((match) => {
    const isCompleted = match.estado === "FINAL" || match.status === "COMPLETED";
    if (!isCompleted) return;

    const localNorm = cleanName(match.local || match.equipoLocal);
    const visitNorm = cleanName(match.visitante || match.equipoVisitante);

    const homeTeam = updatedTable.find((t) => {
      const name = cleanName(t.equipo);
      return name === localNorm || name.includes(localNorm) || localNorm.includes(name);
    });

    const awayTeam = updatedTable.find((t) => {
      const name = cleanName(t.equipo);
      return name === visitNorm || name.includes(visitNorm) || visitNorm.includes(name);
    });

    if (homeTeam && awayTeam) {
      // Marcamos una bandera interna para no procesar dos veces el mismo partido
      if (!match._reconciled) {
        const gl = Number(match.gl ?? match.golesLocal ?? 0);
        const gv = Number(match.gv ?? match.golesVisitante ?? 0);

        // Si Tristán Suárez o el ganador tienen menos PJ o si los puntos no reflejan el partido de hoy:
        // Evaluamos si el equipo visitante (Tristán) necesita el impacto
        if (gv > gl && awayTeam.pj <= homeTeam.pj) {
          awayTeam.pts += 3;
          awayTeam.pj += 1;
          awayTeam.dg += (gv - gl);
          homeTeam.dg -= (gv - gl);
        } else if (gl > gv && homeTeam.pj <= awayTeam.pj) {
          homeTeam.pts += 3;
          homeTeam.pj += 1;
          homeTeam.dg += (gl - gv);
          awayTeam.dg -= (gl - gv);
        } else if (gl === gv) {
          // Empate si faltaba actualizar
          if (homeTeam.pj < awayTeam.pj) { homeTeam.pts += 1; homeTeam.pj += 1; }
          if (awayTeam.pj < homeTeam.pj) { awayTeam.pts += 1; awayTeam.pj += 1; }
        }

        match._reconciled = true;
      }
    }
  });

  // Reordenar la tabla por Puntos y Diferencia de Gol
  return updatedTable.sort((a, b) => b.pts - a.pts || b.dg - a.dg);
}


export { setDate, setLiveBanner, saveCache, loadCache, torneosForYear, loadAnnualAndAverages, loadCategoryData, hasLiveMatch };