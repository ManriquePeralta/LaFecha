import { CURRENT_SEASON, PLACEHOLDER_LOGO } from "./config.js";
import { state } from "./state.js";
import {
  matchModal,
  modalContent,
  detailPageRoot,
  detailBackBtn
} from "./dom.js";
import { normalize, noCacheFetch } from "./utils.js";
import { summaryUrl } from "./season-types.js";
import { parseSummaryMatch } from "./api-parse.js";

// ============================================================
// EVENTOS DEL PARTIDO
// ============================================================

function getCleanMinuteNumber(minStr) {
  if (!minStr) return 0;
  const match = String(minStr).match(/(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

function extractTimelineEvents(raw) {
  const events = raw?.keyEvents || raw?.commentary || [];

  return events
    .map((e) => {
      const typeText = String(e?.type?.text || e?.type?.id || "");
      const textRaw = String(e?.text || e?.athletesInvolved?.[0]?.displayName || "");
      if (!textRaw) return null;

      const translatedText = typeof translateMatchDetailText === "function"
        ? translateMatchDetailText(textRaw)
        : textRaw;

      const minute = e?.clock?.displayValue || "--'";
      const kind = typeof eventKindFromText === "function"
        ? eventKindFromText(typeText + " " + textRaw)
        : "text";

      const isKey = ["goal", "yellow", "red"].includes(kind);

      return {
        minute,
        minuteNum: getCleanMinuteNumber(minute),
        kind,
        isKey,
        text: translatedText
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.minuteNum - b.minuteNum);
}

function eventRowHtml(kind, minute, text, isKey) {
  return `
    <li class="event-row event-${kind || 'text'}" data-key="${isKey ? 'true' : 'false'}">
      <span class="event-minute">${minute || "--'"}</span>
      <span class="event-icon" aria-hidden="true"></span>
      <span class="event-text">${text}</span>
    </li>
  `;
}

// ============================================================
// TRADUCCIÓN DE EVENTOS
// ============================================================

function translateMatchDetailText(text) {
  const replacements = [
    [/Own Goal!/gi, "¡Gol en contra!"],
    [/Goal!/gi, "¡Gol!"],
    [/Second Half ends,?/gi, "Final del partido,"],
    [/First Half ends,?/gi, "Final del primer tiempo,"],
    [/Second Half begins/gi, "Comienza el segundo tiempo"],
    [/First Half begins/gi, "Comienza el partido"],
    [/is shown the Tarjeta amarilla\.?/gi, "recibe tarjeta amarilla "],
    [/is shown the Tarjeta roja\.?/gi, "recibe tarjeta roja "],
    [/is shown the yellow card\.?/gi, "recibe tarjeta amarilla "],
    [/is shown a yellow card\.?/gi, "recibe tarjeta amarilla "],
    [/is shown the red card\.?/gi, "recibe tarjeta roja "],
    [/is shown a red card\.?/gi, "recibe tarjeta roja "],
    [/Substitution,?\s*/gi, "Cambio en "],
    [/\breplaces\b/gi, "entra por"],
    [/\binjured\b/gi, "lesionado"],
    [/Delay in match because of an injury\s*/gi, "Partido detenido por lesión de "],
    [/Delay in match\s*/gi, "Partido detenido ("],
    [/Delay over\. They are ready to continue\.?/gi, "Se reanuda el juego."],
    [/\bDelay over\b/gi, "Se reanuda el juego"],
    [/right footed shot from the centre of the box/gi, "remate de derecha desde el centro del área"],
    [/left footed shot from the centre of the box/gi, "remate de izquierda desde el centro del área"],
    [/right footed shot/gi, "remate de derecha"],
    [/left footed shot/gi, "remate de izquierda"],
    [/header/gi, "cabezazo"],
    [/from the centre of the box/gi, "desde el centro del área"],
    [/from the right side of the box/gi, "desde el costado derecho del área"],
    [/from the left side of the box/gi, "desde el costado izquierdo del área"],
    [/to the bottom left corner/gi, "abajo a la izquierda"],
    [/to the bottom right corner/gi, "abajo a la derecha"],
    [/to the top left corner/gi, "arriba a la izquierda"],
    [/to the top right corner/gi, "arriba a la derecha"],
    [/assisted by/gi, "asistido por"],
    [/for a bad foul/gi, "por una falta dura"],
    [/for a foul/gi, "por una falta"],
    [/bad foul/gi, "falta dura"]
  ];

  return replacements
    .reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), String(text || ""))
    .replace(/\s+/g, " ")
    .trim();
}

function eventKindFromText(text) {
  const value = normalize(text);

  if (/tarjeta roja|red card|expuls/i.test(value)) return "red";
  if (/tarjeta amarilla|yellow card|amonest|caution|booking/i.test(value)) return "yellow";
  if (/gol|goal|own goal/i.test(value)) return "goal";
  if (/sustituc|substitution/i.test(value)) return "substitution";

  return "text";
}

function extractMatchStats(raw) {
  const teamsStats = raw?.boxscore?.teams || raw?.statistics || [];
  if (teamsStats.length < 2) return null;

  const homeStats = teamsStats[0]?.statistics || [];
  const awayStats = teamsStats[1]?.statistics || [];

  const getStat = (statsList, name) => {
    const found = statsList.find((s) => 
      normalize(s.name || s.label || "").includes(normalize(name))
    );
    return found?.displayValue || found?.value || "0";
  };

  const statsKeys = [
    { label: "Posesión de Balón", key: "possession" },
    { label: "Tiros Totales", key: "totalShots" },
    { label: "Tiros al Arco", key: "shotsOnTarget" },
    { label: "Córners", key: "wonCorners" },
    { label: "Faltas Cometidas", key: "foulsCommitted" }
  ];

  const result = statsKeys.map(({ label, key }) => ({
    label,
    home: getStat(homeStats, key),
    away: getStat(awayStats, key)
  }));

  return result.some((s) => s.home !== "0" || s.away !== "0") ? result : null;
}

function matchStatsHtml(stats, homeTeam, awayTeam) {
  if (!stats) return '<p class="empty-inline">Estadísticas no disponibles para este partido.</p>';

  const rowsHtml = stats
    .map((item) => {
      let valHomeRaw = parseFloat(item.home) || 0;
      let valAwayRaw = parseFloat(item.away) || 0;

      const isPossession = item.label.toLowerCase().includes("posesión");
      const displayHome = isPossession ? `${valHomeRaw}%` : item.home;
      const displayAway = isPossession ? `${valAwayRaw}%` : item.away;

      const total = valHomeRaw + valAwayRaw || 1;
      const pctHome = Math.round((valHomeRaw / total) * 100);
      const pctAway = 100 - pctHome;

      return `
        <div class="stat-row">
          <div class="stat-values">
            <span class="stat-val stat-val-home">${displayHome}</span>
            <span class="stat-label">${item.label}</span>
            <span class="stat-val stat-val-away">${displayAway}</span>
          </div>
          <div class="stat-bar-bg">
            <div class="stat-bar-home" style="width: ${pctHome}%"></div>
            <div class="stat-bar-away" style="width: ${pctAway}%"></div>
          </div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="stats-card">
      <div class="stats-header">
        <strong class="stats-team-name">${homeTeam}</strong>
        <span class="stats-vs">VS</span>
        <strong class="stats-team-name">${awayTeam}</strong>
      </div>
      <div class="stats-body">
        ${rowsHtml}
      </div>
    </div>
  `;
}

// ============================================================
// FORMACIONES
// ============================================================

function lineupDisplayName(player) {
  return player?.athlete?.displayName || player?.athlete?.shortName || "";
}

function lineupPositionLabel(player) {
  return player?.position?.abbreviation || player?.position?.displayName || "";
}

function pitchPlayerHtml(player) {
  const classes = [
    "pitch-player",
    `pitch-player-${player.roleGroup || "midfielder"}`
  ];

  const displayName = lineupDisplayName(player);
  const jersey = player?.jersey || "";

  return `
    <div class="${classes.join(" ")}">
      <span class="pitch-jersey">${jersey || "•"}</span>
      <span class="pitch-name">${displayName}</span>
    </div>
  `;
}

function lineupRoleGroup(player) {
  const positionName = normalize(player?.position?.displayName || player?.position?.name || "");
  const positionAbbr = String(player?.position?.abbreviation || "").toUpperCase().trim();

  if (!player || positionAbbr === "SUB" || positionName.includes("substitute")) return "bench";
  if (positionAbbr === "G" || positionName.includes("goalkeeper")) return "goalkeeper";
  if (positionName.includes("defender") || /^(LB|RB|CB|CD|CD-L|CD-R|WB|SW|DF)$/i.test(positionAbbr)) return "defender";
  if (positionName.includes("forward") || /^(F|CF|ST|LF|RF|FW)$/i.test(positionAbbr)) return "forward";

  return "midfielder";
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

function assignPlayersToRows(lineup) {
  const starters = lineup.starters || [];

  const goalkeeper = starters.find((p) => lineupRoleGroup(p) === "goalkeeper") || starters[0];
  const outfield = starters.filter((p) => p !== goalkeeper);

  const defenders = outfield.filter((p) => lineupRoleGroup(p) === "defender");
  const midfielders = outfield.filter((p) => lineupRoleGroup(p) === "midfielder");
  const forwards = outfield.filter((p) => lineupRoleGroup(p) === "forward");

  const rows = [];

  if (goalkeeper) rows.push({ roleGroup: "goalkeeper", players: [goalkeeper] });
  if (defenders.length) rows.push({ roleGroup: "defender", players: sortRowPlayersHorizontally(defenders) });

  if (midfielders.length > 3) {
    const defensiveMids = midfielders.filter((player) => !String(player?.position?.abbreviation || "").toUpperCase().includes("AM"));
    const attackingMids = midfielders.filter((player) => String(player?.position?.abbreviation || "").toUpperCase().includes("AM"));

    if (defensiveMids.length) rows.push({ roleGroup: "midfielder", players: sortRowPlayersHorizontally(defensiveMids) });
    if (attackingMids.length) rows.push({ roleGroup: "midfielder", players: sortRowPlayersHorizontally(attackingMids) });
  } else if (midfielders.length) {
    rows.push({ roleGroup: "midfielder", players: sortRowPlayersHorizontally(midfielders) });
  }

  if (forwards.length) rows.push({ roleGroup: "forward", players: sortRowPlayersHorizontally(forwards) });

  return rows;
}

function getHorizontalWeight(player) {
  const abbr = String(player?.position?.abbreviation || "").toUpperCase().trim();

  if (["LB", "LWB", "LM", "AM-L", "LW", "LF"].includes(abbr)) return 1;
  if (["CD-L", "CB-L", "LCM", "LDM"].includes(abbr)) return 2;
  if (["CB", "CD", "CM", "CDM", "CAM", "AM", "ST", "CF", "F", "G"].includes(abbr)) return 3;
  if (["CD-R", "CB-R", "RCM", "RDM"].includes(abbr)) return 4;
  if (["RB", "RWB", "RM", "AM-R", "RW", "RF"].includes(abbr)) return 5;

  return 3;
}

function sortRowPlayersHorizontally(players) {
  return [...players].sort((a, b) => getHorizontalWeight(a) - getHorizontalWeight(b));
}

function pitchRowHtml(row, rowIndex, rowCount) {
  const top = rowCount === 1 ? 50 : 88 - (rowIndex * 76) / (rowCount - 1);
  const isGoalkeeper = row.roleGroup === "goalkeeper";
  const classes = ["pitch-row", `pitch-row-${row.roleGroup}`];

  return `
    <div class="${classes.join(" ")}" style="top:${top}%">
      ${row.players
        .map((player) =>
          pitchPlayerHtml({
            ...player,
            roleGroup: isGoalkeeper ? "goalkeeper" : lineupRoleGroup(player)
          })
        )
        .join("")}
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

function extractVenue(raw) {
  const venue = raw?.gameInfo?.venue || raw?.header?.competitions?.[0]?.venue;
  return venue?.fullName || "";
}

function matchHeaderHtml(match, extra) {
  const isLive = match?.isLive || match?.estado === "En juego" || match?.statusType === "in";

  const detalleMinuto = (() => {
    const matchDetalle = String(match?.detalle || "").match(/^(\d+)/);
    return matchDetalle ? Number(matchDetalle[1]) : null;
  })();

  const minutoAPI = Number(match?.minutoJuego ?? match?.minuto);
  const segundoAPI = Number(match?.segundoJuego ?? match?.segundo);

  let minuto = 0;
  let segundo = 0;

  if (Number.isFinite(minutoAPI) && minutoAPI > 0) {
    minuto = minutoAPI;
    segundo = Number.isFinite(segundoAPI) ? segundoAPI : 0;
  } else if (detalleMinuto !== null) {
    minuto = detalleMinuto;
    segundo = 0;
  }

  const tiempoJuego = isLive ? `${minuto}:${String(segundo).padStart(2, "0")}` : "";

  return `
    <div class="modal-header">
      <span class="team-with-logo team-link" data-team-name="${match?.local || ''}">
        <img class="team-logo" src="${match?.localLogo || PLACEHOLDER_LOGO}" alt="" />
        <strong>${match?.local || "Local"}</strong>
      </span>

      <div class="score-center">
        <span class="modal-score">${match ? `${match.gl} - ${match.gv}` : "vs"}</span>
        ${isLive ? `<span class="match-live-clock" id="match-live-clock">${tiempoJuego || "EN VIVO"}</span>` : ""}
      </div>

      <span class="team-with-logo team-link" data-team-name="${match?.visitante || ''}">
        <img class="team-logo" src="${match?.visitanteLogo || PLACEHOLDER_LOGO}" alt="" />
        <strong>${match?.visitante || "Visitante"}</strong>
      </span>
    </div>

    <p class="modal-meta">
      ${match ? `${match.fecha} ${match.hora} · ${isLive ? "EN VIVO" : match.estado}` : ""}
      ${extra ? ` · ${extra}` : ""}
    </p>
  `;
}

function buildMatchDetailHtml(raw, match) {
  const events = extractTimelineEvents(raw);
  const lineups = extractLineups(raw);
  const venue = extractVenue(raw);
  const stats = extractMatchStats(raw);

  const goalCount = events.filter((e) => e.kind === "goal").length;
  const yellowCount = events.filter((e) => e.kind === "yellow").length;
  const redCount = events.filter((e) => e.kind === "red").length;

  const summaryCard = `
    <div class="match-summary-card">
      <span>${goalCount} gol${goalCount === 1 ? "" : "es"}</span>
      <span>${yellowCount} amarilla${yellowCount === 1 ? "" : "s"}</span>
      <span>${redCount} roja${redCount === 1 ? "" : "s"}</span>
    </div>
  `;

  const timelineHtml = events.length
    ? `
      <div class="timeline-controls">
        <button class="timeline-btn active" data-filter="all">Todos</button>
        <button class="timeline-btn" data-filter="key">Momentos Clave</button>
      </div>
      <ul class="event-list" id="timeline-list">
        ${events.map((e) => eventRowHtml(e.kind, e.minute, e.text, e.isKey)).join("")}
      </ul>
    `
    : '<p class="empty-inline">No hay eventos registrados para este partido.</p>';

  const statsSectionHtml = matchStatsHtml(stats, match?.local || "Local", match?.visitante || "Visitante");
  const lineupsHtml = lineups.length
    ? `<div class="pitch-grid">${lineups.map((l) => pitchCardHtml(l)).join("")}</div>`
    : "Formaciones no disponibles para este partido.";

  return `
    ${matchHeaderHtml(match, venue)}
    ${summaryCard}

    <section class="modal-section">
      <h3 class="sub-title">Línea de Tiempo</h3>
      ${timelineHtml}
    </section>

    <section class="modal-section">
      <h3 class="sub-title">Estadísticas del Partido</h3>
      ${statsSectionHtml}
    </section>

    <section class="modal-section">
      <h3 class="sub-title">Formaciones</h3>
      ${lineupsHtml}
    </section>
  `;
}

// Filtros de Línea de Tiempo
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".timeline-btn");
  if (!btn) return;

  const filter = btn.dataset.filter;
  const container = btn.closest(".modal-section");
  if (!container) return;

  container.querySelectorAll(".timeline-btn").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");

  const timelineList = container.querySelector("#timeline-list");
  if (!timelineList) return;

  const rows = timelineList.querySelectorAll(".event-row");
  rows.forEach((row) => {
    if (filter === "key") {
      row.style.display = row.getAttribute("data-key") === "true" ? "grid" : "none";
    } else {
      row.style.display = "grid";
    }
  });
});

// Interceptor de clics a equipos
document.addEventListener("click", (e) => {
  const teamEl = e.target.closest(".team-link, .team-with-logo, [data-team-name], .team-header, .team");
  if (!teamEl) return;
  if (e.target.closest("button, .btn, .back-btn, #detail-back-btn")) return;

  let teamName = teamEl.dataset.teamName;
  if (!teamName) {
    const clone = teamEl.cloneNode(true);
    clone.querySelectorAll(".vs, .score, .badge, img").forEach((el) => el.remove());
    teamName = clone.textContent?.trim();
  }

  if (teamName && teamName.toLowerCase() !== "vs" && teamName.length > 1) {
    e.preventDefault();
    e.stopPropagation();

    const currentUrlParams = new URLSearchParams(window.location.search);
    const category = currentUrlParams.get("category") || "primera";
    const league = currentUrlParams.get("league") || "";
    const season = currentUrlParams.get("season") || "2026";
    const torneo = currentUrlParams.get("torneo") || "clausura";

    const teamParams = new URLSearchParams({
      team: teamName.trim(),
      category,
      league,
      season,
      torneo
    });

    window.location.href = `team.html?${teamParams.toString()}`;
  }
});

// ============================================================
// RELOJ Y AUTO-ACTUALIZACIÓN EN VIVO
// ============================================================

let detailLiveTimer = null;
const DETAIL_REFRESH_MS = 15000;

function stopDetailLiveClock() {
  if (detailLiveTimer) {
    clearInterval(detailLiveTimer);
    detailLiveTimer = null;
  }
}

async function fetchAndUpdateDetail(matchId) {
  try {
    const baseUrl = state.isEspnLeague
      ? `https://site.api.espn.com/apis/site/v2/sports/soccer/${state.espnLeagueCode}/summary?event=${matchId}`
      : summaryUrl(state.category, matchId);

    // Burlar memoria caché usando timestamp variable
    const cacheBusterUrl = `${baseUrl}${baseUrl.includes('?') ? '&' : '?'}_t=${Date.now()}`;

    const res = await fetch(cacheBusterUrl, { cache: "no-store" });
    if (!res.ok) return;

    const raw = await res.json();
    const freshMatch = parseSummaryMatch(raw, matchId);

    if (!freshMatch) return;

    // Actualizar el DOM con el nuevo partido
    if (detailPageRoot) {
      detailPageRoot.innerHTML = `
        <div class="detail-article">
          ${buildMatchDetailHtml(raw, freshMatch)}
        </div>
      `;
    }

    const isLive = freshMatch.isLive || freshMatch.estado === "En juego" || freshMatch.statusType === "in" || freshMatch.status === "IN_PLAY";

    if (!isLive) {
      stopDetailLiveClock();
    }
  } catch (e) {
    console.warn("Error en auto-actualización del detalle:", e);
  }
}

function startDetailLiveClock(matchId) {
  stopDetailLiveClock();
  detailLiveTimer = setInterval(() => {
    if (document.hidden) return;
    fetchAndUpdateDetail(matchId);
  }, DETAIL_REFRESH_MS);
}

// ============================================================
// INICIALIZACIÓN
// ============================================================

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

  stopDetailLiveClock();

  const params = new URLSearchParams(window.location.search);
  const matchId = params.get("matchId");
  const categoryParam = params.get("category");
  const leagueParam = params.get("league");
  const seasonParam = Number(params.get("season"));
  const torneoParam = params.get("torneo");

  if (categoryParam === "espn") {
    state.isEspnLeague = true;
    state.category = "espn";
    state.espnLeagueCode = leagueParam || "";
  } else {
    state.isEspnLeague = false;
    state.category = categoryParam === "segunda" ? "segunda" : "primera";
    state.espnLeagueCode = null;
  }

  state.season = Number.isFinite(seasonParam) ? seasonParam : CURRENT_SEASON;
  state.torneo = torneoParam === "clausura" ? "clausura" : "apertura";

  const backBtn = detailBackBtn || document.getElementById("detail-back-btn");
  if (backBtn) {
    const returnParams = new URLSearchParams();
    if (state.isEspnLeague) {
      returnParams.set("category", "espn");
      if (state.espnLeagueCode) returnParams.set("league", state.espnLeagueCode);
    } else {
      returnParams.set("category", state.category);
    }
    if (state.season) returnParams.set("season", String(state.season));
    if (state.torneo) returnParams.set("torneo", state.torneo);

    const queryString = returnParams.toString();
    backBtn.href = queryString ? `index.html?${queryString}` : "index.html";
  }

  if (!matchId) {
    detailPageRoot.innerHTML = '<p class="detail-empty">No se indicó el partido.</p>';
    return;
  }

  detailPageRoot.innerHTML = '<p class="detail-loading">Cargando detalle del partido...</p>';

  // Carga inicial
  await fetchAndUpdateDetail(matchId);

  // Iniciar temporizador en vivo incondicionalmente
  startDetailLiveClock(matchId);
}

function closeMatchDetail() {
  stopDetailLiveClock();
  matchModal.classList.add("hidden");
  document.body.classList.remove("modal-open");
}

function renderMatchDetail(raw, match) {
  if (!modalContent) return;
  modalContent.innerHTML = buildMatchDetailHtml(raw, match);
}

export {
  openMatchDetail,
  closeMatchDetail,
  initDetailPage,
  renderMatchDetail,
  buildMatchDetailHtml
};