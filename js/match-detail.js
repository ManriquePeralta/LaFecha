import { CURRENT_SEASON, PLACEHOLDER_LOGO } from "./config.js";
import { state } from "./state.js";
import { matchModal, modalContent, detailPageRoot, detailBackBtn } from "./dom.js";
import { normalize, noCacheFetch } from "./utils.js";
import { summaryUrl } from "./season-types.js";
import { parseSummaryMatch } from "./api-parse.js";

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
    [/to the bottom left corner/gi, "abajo a la izquierda"],
    [/to the bottom right corner/gi, "abajo a la derecha"],
    [/to the top left corner/gi, "arriba a la izquierda"],
    [/to the top right corner/gi, "arriba a la derecha"],
    [/to the centre of the gol./gi, "al medio del arco"],
    [/remate de derecha desde el centro del área to the centre of the gol./gi, "al medio del arco"],
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
  const classes = [
    "pitch-player",
    `pitch-player-${player.roleGroup || "midfielder"}`
  ];

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
  const positionName = normalize(
    player?.position?.displayName ||
    player?.position?.name ||
    ""
  );

  const positionAbbr = String(
    player?.position?.abbreviation || ""
  )
    .toUpperCase()
    .trim();

  // Suplentes
  if (
    !player ||
    positionAbbr === "SUB" ||
    positionName.includes("substitute")
  ) {
    return "bench";
  }

  // Arquero
  if (
    positionAbbr === "G" ||
    positionName.includes("goalkeeper")
  ) {
    return "goalkeeper";
  }

  // Defensores
  // CD, CD-L, CD-R, LB, RB, WB, DF, CB, etc.
  if (
    positionName.includes("defender") ||
    /^(LB|RB|CB|CD|CD-L|CD-R|WB|SW|DF)$/i.test(positionAbbr)
  ) {
    return "defender";
  }

  // Delanteros
  // F, CF, ST, LF, RF, FW
  if (
    positionName.includes("forward") ||
    /^(F|CF|ST|LF|RF|FW)$/i.test(positionAbbr)
  ) {
    return "forward";
  }

  // Todo lo demás:
  // AM, AM-L, AM-R, LM, RM, CM, DM, CDM, etc.
  return "midfielder";
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

        ${rows
          .map((row, index) =>
            pitchRowHtml(row, index, rows.length)
          )
          .join("")}
      </div>
    </article>
  `;
}

function extractLineups(raw) {
  const rosters = raw?.rosters || [];

  return rosters
    .map((r) => ({
      team:
        r?.team?.displayName ||
        r?.team?.shortDisplayName ||
        "",

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

function getPlayerHierarchy(player) {
  const role = lineupRoleGroup(player);

  if (role === "goalkeeper") return 1;
  if (role === "defender") return 2;
  if (role === "midfielder") return 3;
  if (role === "forward") return 4;

  return 3;
}

function sortLineupPlayers(players) {
  return [...(players || [])].sort((a, b) => {
    // Si la API trae formationPlace de ESPN,
    // usarlo prioritariamente.
    const placeA = Number(a?.formationPlace);
    const placeB = Number(b?.formationPlace);

    if (
      !isNaN(placeA) &&
      !isNaN(placeB) &&
      placeA > 0 &&
      placeB > 0
    ) {
      return placeA - placeB;
    }

    // Si no hay formationPlace,
    // ordenar por jerarquía del campo.
    const rankDiff =
      getPlayerHierarchy(a) -
      getPlayerHierarchy(b);

    if (rankDiff !== 0) {
      return rankDiff;
    }

    return lineupDisplayName(a).localeCompare(
      lineupDisplayName(b)
    );
  });
}

function assignPlayersToRows(lineup) {
  const starters = lineup.starters || [];

  // 1. Extraer arquero
  const goalkeeper =
    starters.find(
      (p) => lineupRoleGroup(p) === "goalkeeper"
    ) || starters[0];

  // 2. Jugadores de campo
  const outfield = starters.filter(
    (p) => p !== goalkeeper
  );

  // 3. Separar por rol
  const defenders = outfield.filter(
    (p) => lineupRoleGroup(p) === "defender"
  );

  const midfielders = outfield.filter(
    (p) => lineupRoleGroup(p) === "midfielder"
  );

  const forwards = outfield.filter(
    (p) => lineupRoleGroup(p) === "forward"
  );

  const rows = [];

  // ==========================================================
  // FILA 1: ARQUERO
  // ==========================================================

  if (goalkeeper) {
    rows.push({
      roleGroup: "goalkeeper",
      players: [goalkeeper]
    });
  }

  // ==========================================================
  // FILA 2: DEFENSORES
  // ==========================================================

  if (defenders.length) {
    rows.push({
      roleGroup: "defender",
      players: sortRowPlayersHorizontally(defenders)
    });
  }

  // ==========================================================
  // MEDIOCAMPISTAS
  // ==========================================================

  if (midfielders.length > 3) {
    /*
     * Separamos:
     *
     * - Pivotes / volantes centrales:
     *   LM, RM, CM, DM, CDM, etc.
     *
     * - Mediocampistas ofensivos:
     *   AM, AM-L, AM-R
     */

    const defensiveMids = midfielders.filter((player) => {
      const abbr = String(
        player?.position?.abbreviation || ""
      )
        .toUpperCase()
        .trim();

      return !abbr.includes("AM");
    });

    const attackingMids = midfielders.filter((player) => {
      const abbr = String(
        player?.position?.abbreviation || ""
      )
        .toUpperCase()
        .trim();

      return abbr.includes("AM");
    });

    // Doble 5 / volantes centrales
    if (defensiveMids.length) {
      rows.push({
        roleGroup: "midfielder",
        players:
          sortRowPlayersHorizontally(defensiveMids)
      });
    }

    // Mediocampistas ofensivos / enganches
    if (attackingMids.length) {
      rows.push({
        roleGroup: "midfielder",
        players:
          sortRowPlayersHorizontally(attackingMids)
      });
    }
  } else if (midfielders.length) {
    rows.push({
      roleGroup: "midfielder",
      players:
        sortRowPlayersHorizontally(midfielders)
    });
  }

  // ==========================================================
  // DELANTEROS
  // ==========================================================

  if (forwards.length) {
    rows.push({
      roleGroup: "forward",
      players: sortRowPlayersHorizontally(forwards)
    });
  }

  return rows;
}

// ============================================================
// POSICIONAMIENTO HORIZONTAL
// ============================================================

/*
 * Peso de izquierda a derecha:
 *
 * 1 = Izquierda
 * 2 = Centro-izquierda
 * 3 = Centro
 * 4 = Centro-derecha
 * 5 = Derecha
 */

function getHorizontalWeight(player) {
  const abbr = String(
    player?.position?.abbreviation || ""
  )
    .toUpperCase()
    .trim();

  // Banda izquierda
  if (
    [
      "LB",
      "LWB",
      "LM",
      "AM-L",
      "LW",
      "LF"
    ].includes(abbr)
  ) {
    return 1;
  }

  // Centro-izquierda
  if (
    [
      "CD-L",
      "CB-L",
      "LCM",
      "LDM"
    ].includes(abbr)
  ) {
    return 2;
  }

  // Centro
  if (
    [
      "CB",
      "CD",
      "CM",
      "CDM",
      "CAM",
      "AM",
      "ST",
      "CF",
      "F",
      "G"
    ].includes(abbr)
  ) {
    return 3;
  }

  // Centro-derecha
  if (
    [
      "CD-R",
      "CB-R",
      "RCM",
      "RDM"
    ].includes(abbr)
  ) {
    return 4;
  }

  // Banda derecha
  if (
    [
      "RB",
      "RWB",
      "RM",
      "AM-R",
      "RW",
      "RF"
    ].includes(abbr)
  ) {
    return 5;
  }

  // Fallback: centro
  return 3;
}

// ============================================================
// ORDENAR JUGADORES DENTRO DE CADA FILA
// ============================================================

function sortRowPlayersHorizontally(players) {
  return [...players].sort(
    (a, b) =>
      getHorizontalWeight(a) -
      getHorizontalWeight(b)
  );
}

// ============================================================
// RENDER DE CADA FILA
// ============================================================

function pitchRowHtml(row, rowIndex, rowCount) {
  /*
   * Invertimos el eje vertical:
   *
   * Arquero  -> abajo (~88%)
   * Delantero -> arriba (~12%)
   */

  const top =
    rowCount === 1
      ? 50
      : 88 -
        (rowIndex * 76) /
          (rowCount - 1);

  const isGoalkeeper =
    row.roleGroup === "goalkeeper";

  const classes = [
    "pitch-row",
    `pitch-row-${row.roleGroup}`
  ];

  return `
    <div
      class="${classes.join(" ")}"
      style="top:${top}%"
    >
      ${row.players
        .map((player) =>
          pitchPlayerHtml({
            ...player,
            roleGroup: isGoalkeeper
              ? "goalkeeper"
              : lineupRoleGroup(player)
          })
        )
        .join("")}
    </div>
  `;
}
function extractVenue(raw) {
  const venue = raw?.gameInfo?.venue || raw?.header?.competitions?.[0]?.venue;
  return venue?.fullName || "";
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
    const res = await noCacheFetch(summaryUrl(state.category, matchId));
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

export { openMatchDetail, closeMatchDetail, initDetailPage, renderMatchDetail, buildMatchDetailHtml };