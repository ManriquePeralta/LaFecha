import { CACHE_KEY, CACHE_TTL_MS, CURRENT_SEASON, SPLIT_SEASON_MIN_YEAR, API } from "./config.js";
import { db, state, cacheKey } from "./state.js";
import { $, liveStatus, refreshBtn, isDetailPage } from "./dom.js";
import { getDateRangeParam, noCacheFetch, normalize } from "./utils.js";
import { parseScoreboard, mergeStandingsTables } from "./api-parse.js";
import { fetchStandingsSafe } from "./season-types.js";
import { renderAll } from "./render-standings.js";
import { syncTorneoControls } from "./ui-controls.js";
// Al principio de data-loader.js
import { renderMatches } from "./render-matches.js";

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

  const sourceText =
    state.source === "live"
      ? "Datos en vivo"
      : state.source === "cache"
        ? "Datos cache"
        : "Sin datos en vivo";

  const updatedText = state.lastUpdated
    ? ` | Actualizado ${new Intl.DateTimeFormat("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }).format(state.lastUpdated)}`
    : "";

  liveStatus.textContent =
    `${sourceText}${updatedText}${extra ? ` | ${extra}` : ""}`;
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
    // localStorage puede fallar en modo incógnito o si está lleno
  }
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);

    if (!raw) return false;

    const payload = JSON.parse(raw);

    if (
      !payload.savedAt ||
      Date.now() - payload.savedAt > CACHE_TTL_MS ||
      !payload.db
    ) {
      return false;
    }

    if (
      payload.category !== state.category ||
      payload.season !== state.season ||
      payload.torneo !== state.torneo
    ) {
      return false;
    }

    db.primera = payload.db.primera || db.primera;
    db.segunda = payload.db.segunda || db.segunda;

    state.source = "cache";
    state.lastUpdated = new Date(payload.savedAt);
    state.loaded[cacheKey()] = true;

    setLiveBanner("inicio rápido");

    return true;
  } catch {
    return false;
  }
}

function torneosForYear(year) {
  return year >= SPLIT_SEASON_MIN_YEAR
    ? ["apertura", "clausura"]
    : ["apertura"];
}

async function loadAnnualAndAverages(category, season) {
  if (category !== "primera") {
    return {
      annual: [],
      averages: []
    };
  }

  const years = [season, season - 1, season - 2];
  const requests = [];

  years.forEach((year) => {
    torneosForYear(year).forEach((torneoKey) => {
      requests.push(
        fetchStandingsSafe(category, year, torneoKey)
          .then((result) => ({ year, result }))
      );
    });
  });

  const settled = await Promise.all(requests);

  const annual = mergeStandingsTables(
    settled
      .filter((s) => s.year === season)
      .map((s) => s.result)
  );

  const averagesBase = mergeStandingsTables(
    settled.map((s) => s.result)
  );

  const averages = averagesBase
    .map((r) => ({
      ...r,
      prom: r.pj ? r.pts / r.pj : 0
    }))
    .sort((a, b) => b.prom - a.prom);

  return {
    annual,
    averages
  };
}


// ==========================================
// POLLING
// ==========================================

const LIVE_POLL_MS = 15000;
const IDLE_POLL_MS = 60000;

function hasLiveMatch(category) {
  return (db[category]?.resultados || []).some((m) =>
    isMatchLive(m)
  );
}

let pollTimer = null;

function scheduleNextPoll() {
  if (pollTimer) {
    clearTimeout(pollTimer);
  }

  const delay = hasLiveMatch(state.category)
    ? LIVE_POLL_MS
    : IDLE_POLL_MS;

  pollTimer = setTimeout(() => {
    loadCategoryData(state.category, true);
  }, delay);
}


// ==========================================
// RELOJ DE PARTIDO EN VIVO
// ==========================================

const liveClocks = new Map();
let liveClockTimer = null;

function getMatchId(match) {
  return (
    match.id ||
    match.matchId ||
    match.fixtureId ||
    `${match.local || match.equipoLocal}-${match.visitante || match.equipoVisitante}`
  );
}

function isMatchLive(match) {
  const estado = String(match?.estado || "").toUpperCase();
  const status = String(match?.status || "").toUpperCase();

  return (
    estado === "EN JUEGO" ||
    estado === "EN VIVO" ||
    estado === "LIVE" ||
    estado === "IN PLAY" ||
    status === "LIVE" ||
    status === "IN_PLAY"
  );
}

function getLiveMinute(match) {
  return Number(
    match?.minuto ??
    match?.minute ??
    match?.elapsed ??
    match?.min ??
    0
  );
}

function getLiveSecond(match) {
  return Number(
    match?.segundo ??
    match?.second ??
    match?.seconds ??
    0
  );
}

function updateLiveClocks(matches) {
  if (!Array.isArray(matches)) {
    return matches;
  }

  return matches.map((match) => {
    if (!isMatchLive(match)) {
      return {
        ...match,
        minutoJuego: null,
        segundoJuego: null,
        tiempoJuego: null
      };
    }

    const id = getMatchId(match);

    const apiMinute = getLiveMinute(match);
    const apiSecond = getLiveSecond(match);

    let clock = liveClocks.get(id);

    /*
     * Primera vez que vemos el partido:
     * usamos el minuto/segundo que proporciona la API.
     */
    if (!clock) {
      clock = {
        minute: apiMinute,
        second: apiSecond,
        lastSync: Date.now()
      };

      liveClocks.set(id, clock);
    } else {
      /*
       * Cada vez que llega una actualización de la API,
       * sincronizamos nuevamente el reloj.
       *
       * Esto evita que el contador local se vaya
       * demasiado lejos del tiempo real.
       */
      clock.minute = apiMinute;
      clock.second = apiSecond;
      clock.lastSync = Date.now();
    }

    const elapsedSinceSync = Math.floor(
      (Date.now() - clock.lastSync) / 1000
    );

    const totalSeconds =
      clock.minute * 60 +
      clock.second +
      elapsedSinceSync;

    const minute = Math.floor(totalSeconds / 60);
    const second = totalSeconds % 60;

    return {
      ...match,

      // Campos numéricos
      minutoJuego: minute,
      segundoJuego: second,

      // Campo listo para mostrar
      tiempoJuego: `${minute}:${String(second).padStart(2, "0")}`
    };
  });
}

function refreshLiveClockDisplay() {
  const matches = db[state.category]?.resultados || [];

  const liveMatches = matches.filter(isMatchLive);

  if (!liveMatches.length) {
    if (liveClockTimer) {
      clearInterval(liveClockTimer);
      liveClockTimer = null;
    }

    return;
  }

  /*
   * Actualizamos el contador local cada segundo.
   * No hacemos ninguna petición a la API acá.
   */
  const updatedMatches = updateLiveClocks(matches);

  db[state.category].resultados = updatedMatches;

  /*
   * También actualizamos allMatches para que cualquier
   * componente que use esa colección tenga el tiempo actual.
   */
  if (Array.isArray(db[state.category].allMatches)) {
    db[state.category].allMatches = updateLiveClocks(
      db[state.category].allMatches
    );
  }

  if (!isDetailPage) {
    renderAll();
  }
}

function startLiveClock() {
  if (liveClockTimer) {
    clearInterval(liveClockTimer);
  }

  /*
   * Actualizamos inmediatamente para no esperar 1 segundo.
   */
  refreshLiveClockDisplay();

  liveClockTimer = setInterval(() => {
    refreshLiveClockDisplay();
  }, 1000);
}

function stopLiveClock() {
  if (liveClockTimer) {
    clearInterval(liveClockTimer);
    liveClockTimer = null;
  }
}


// ==========================================
// RECONCILIACIÓN AUTOMÁTICA DE TABLAS
// ==========================================

export function reconcileStandingsWithMatches(standings, matches) {
  if (!Array.isArray(standings) || !standings.length) {
    return standings;
  }

  if (!Array.isArray(matches) || !matches.length) {
    return standings;
  }

  const updatedTable = JSON.parse(JSON.stringify(standings));

  const cleanName = (str) =>
    normalize(str || "")
      .replace(/^t.\s\*/, "tristan ")
      .replace(/^g.\s\*/, "gimnasia ")
      .replace(/(j)/, "")
      .trim();

  matches.forEach((match) => {
    const isCompleted =
      match.estado === "FINAL" ||
      match.status === "COMPLETED";

    if (!isCompleted) return;

    const localNorm = cleanName(
      match.local || match.equipoLocal
    );

    const visitNorm = cleanName(
      match.visitante || match.equipoVisitante
    );

    const homeTeam = updatedTable.find((t) => {
      const name = cleanName(t.equipo);

      return (
        name === localNorm ||
        name.includes(localNorm) ||
        localNorm.includes(name)
      );
    });

    const awayTeam = updatedTable.find((t) => {
      const name = cleanName(t.equipo);

      return (
        name === visitNorm ||
        name.includes(visitNorm) ||
        visitNorm.includes(name)
      );
    });

    if (homeTeam && awayTeam) {
      const gl = Number(
        match.gl ??
        match.golesLocal ??
        0
      );

      const gv = Number(
        match.gv ??
        match.golesVisitante ??
        0
      );

      /*
       * Si la API no le contó el partido a Tristán Suárez
       * (o equipo visitante/local rezagado).
       */
      if (gv > gl && awayTeam.pj <= homeTeam.pj) {
        awayTeam.pts += 3;
        awayTeam.pj += 1;
        awayTeam.dg += gv - gl;
        homeTeam.dg -= gv - gl;

      } else if (gl > gv && homeTeam.pj <= awayTeam.pj) {
        homeTeam.pts += 3;
        homeTeam.pj += 1;
        homeTeam.dg += gl - gv;
        awayTeam.dg -= gl - gv;

      } else if (gl === gv) {
        if (homeTeam.pj < awayTeam.pj) {
          homeTeam.pts += 1;
          homeTeam.pj += 1;
        }

        if (awayTeam.pj < homeTeam.pj) {
          awayTeam.pts += 1;
          awayTeam.pj += 1;
        }
      }
    }
  });

  return updatedTable.sort(
    (a, b) =>
      b.pts - a.pts ||
      b.dg - a.dg
  );
}


// ==========================================
// CARGA DE DATOS
// ==========================================

async function loadCategoryData(category, forced = false) {
  if (state.isLoading) return;

  if (!forced && state.loaded[cacheKey()]) {
    return;
  }

  // Desactivar explícitamente el modo ESPN al cargar fútbol argentino
  state.isEspnLeague = false;
  state.espnLeagueCode = null;
  state.currentMatches = [];

  state.isLoading = true;

  refreshBtn.disabled = true;
  refreshBtn.textContent = "Actualizando...";

  try {
    const range = getDateRangeParam();

    const scoreboardUrl =
      `${API[category].scoreboard}?dates=${range}`;

    const [
      scoreRes,
      tableResult,
      annualAverages
    ] = await Promise.all([
      noCacheFetch(scoreboardUrl).then((res) => {
        if (!res.ok) {
          throw new Error("No response del scoreboard");
        }

        return res.json();
      }),

      fetchStandingsSafe(
        category,
        state.season,
        state.torneo
      ),

      loadAnnualAndAverages(
        category,
        state.season
      )
    ]);

    const parsedMatches = parseScoreboard(scoreRes);

    /*
     * Agregamos el reloj a los partidos.
     */
    const resultadosLive =
      updateLiveClocks(parsedMatches.resultados);

    const proximosLive =
      updateLiveClocks(parsedMatches.proximos);

    const allMatchesLive =
      updateLiveClocks(parsedMatches.all);

    db[category].resultados = resultadosLive;
    db[category].proximos = proximosLive;
    db[category].allMatches = allMatchesLive;

    const rawTabla =
      tableResult?.tabla || [];

    const rawZonas =
      tableResult?.zonas || [];

    db[category].tabla =
      reconcileStandingsWithMatches(
        rawTabla,
        allMatchesLive
      );

    db[category].zonas =
      rawZonas.map((zona) => ({
        ...zona,

        tabla:
          reconcileStandingsWithMatches(
            zona.tabla || [],
            allMatchesLive
          )
      }));

    db[category].annual =
      annualAverages.annual;

    db[category].averages =
      annualAverages.averages;

    state.source = "live";
    state.lastUpdated = new Date();
    state.loaded[cacheKey()] = true;

    setLiveBanner();

    saveCache();

    /*
     * Si hay partidos en vivo, arrancamos el reloj.
     * Si no hay, nos aseguramos de detenerlo.
     */
    if (hasLiveMatch(category)) {
      startLiveClock();
    } else {
      stopLiveClock();
    }

  } catch (e) {
    state.source =
      state.loaded[cacheKey()]
        ? "cache"
        : "fallback";

    state.lastUpdated = new Date();

    setLiveBanner("error de API");

    console.error(e);

  } finally {
    state.isLoading = false;

    if (!isDetailPage) {
      refreshBtn.disabled = false;
      refreshBtn.textContent = "Actualizar";

      syncTorneoControls();

      // Renderizamos la lista de partidos de AFA Y las tablas
      renderMatches();
      renderAll();

      scheduleNextPoll();
    }
  }
}


// ==========================================
// EXPORTS
// ==========================================

export {
  setDate,
  setLiveBanner,
  saveCache,
  loadCache,
  torneosForYear,
  loadAnnualAndAverages,
  loadCategoryData,
  hasLiveMatch,

  // Reloj de partidos
  isMatchLive,
  updateLiveClocks,
  startLiveClock,
  stopLiveClock
};