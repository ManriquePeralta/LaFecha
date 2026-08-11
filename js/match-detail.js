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

function extractScorers(raw) {
  const events = raw?.keyEvents || raw?.commentary || [];

  return events
    .filter(
      (e) =>
        e?.scoringPlay ||
        /goal/i.test(e?.type?.text || e?.type?.id || "")
    )
    .map((e) => ({
      minute: e?.clock?.displayValue || "",
      text: translateMatchDetailText(
        e?.text ||
        e?.athletesInvolved?.[0]?.displayName ||
        ""
      )
    }))
    .filter((e) => e.text);
}

function extractCards(raw) {
  const events = raw?.keyEvents || raw?.commentary || [];

  return events
    .map((e) => {
      const typeText = String(
        e?.type?.text || e?.type?.id || ""
      );

      const text = String(e?.text || "");

      const isYellow =
        /yellow card|booking|caution/i.test(typeText) ||
        /yellow card/i.test(text);

      const isRed =
        /red card|sent off|sending off/i.test(typeText) ||
        /red card|sent off|sending off/i.test(text);

      if (!isYellow && !isRed) return null;

      return {
        minute: e?.clock?.displayValue || "",
        kind: isRed ? "roja" : "amarilla",
        text: translateMatchDetailText(
          text ||
          e?.athletesInvolved?.[0]?.displayName ||
          ""
        )
      };
    })
    .filter(Boolean);
}


// ============================================================
// TRADUCCIÓN DE EVENTOS
// ============================================================

function translateMatchDetailText(text) {
  const replacements = [
    [/Own Goal!/gi, "¡Gol en contra!"],
    [/Goal!/gi, "¡Gol!"],

    [/is shown the Tarjeta amarilla\.?/gi, "recibe tarjeta amarilla "],
    [/is shown the Tarjeta roja\.?/gi, "recibe tarjeta roja "],

    [/is shown the yellow card\.?/gi, "recibe tarjeta amarilla "],
    [/is shown a yellow card\.?/gi, "recibe tarjeta amarilla "],
    [/is shown the red card\.?/gi, "recibe tarjeta roja "],
    [/is shown a red card\.?/gi, "recibe tarjeta roja "],

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
    .replace(/\s+/g, " ") // Sanea espacios dobles accidentales
    .trim();
}

function eventKindFromText(text) {
  const value = normalize(text);

  if (/tarjeta roja|red card|expuls/i.test(value)) {
    return "red";
  }

  if (
    /tarjeta amarilla|yellow card|amonest|caution|booking/i.test(
      value
    )
  ) {
    return "yellow";
  }

  if (/gol|goal|own goal/i.test(value)) {
    return "goal";
  }

  if (/sustituc|substitution/i.test(value)) {
    return "substitution";
  }

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


// ============================================================
// FORMACIONES
// ============================================================

function lineupDisplayName(player) {
  return (
    player?.athlete?.displayName ||
    player?.athlete?.shortName ||
    ""
  );
}

function lineupPositionLabel(player) {
  return (
    player?.position?.abbreviation ||
    player?.position?.displayName ||
    ""
  );
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
      <span class="pitch-jersey">
        ${jersey || "•"}
      </span>

      <span class="pitch-name">
        ${displayName}
      </span>

    </div>
  `;
}

function parseFormationCounts(formation) {
  const counts = String(formation || "")
    .split(/[-]/)
    .map((n) => Number(n))
    .filter(
      (n) => Number.isFinite(n) && n > 0
    );

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
  if (
    positionName.includes("defender") ||
    /^(LB|RB|CB|CD|CD-L|CD-R|WB|SW|DF)$/i.test(
      positionAbbr
    )
  ) {
    return "defender";
  }

  // Delanteros
  if (
    positionName.includes("forward") ||
    /^(F|CF|ST|LF|RF|FW)$/i.test(positionAbbr)
  ) {
    return "forward";
  }

  // Resto: mediocampistas
  return "midfielder";
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
        .filter(
          (p) => p?.starter && p?.athlete
        )
        .map((p) => ({
          jersey: p?.jersey || "",
          formationPlace:
            p?.formationPlace || "",
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
  return [...(players || [])].sort(
    (a, b) => {
      const placeA = Number(
        a?.formationPlace
      );

      const placeB = Number(
        b?.formationPlace
      );

      if (
        !isNaN(placeA) &&
        !isNaN(placeB) &&
        placeA > 0 &&
        placeB > 0
      ) {
        return placeA - placeB;
      }

      const rankDiff =
        getPlayerHierarchy(a) -
        getPlayerHierarchy(b);

      if (rankDiff !== 0) {
        return rankDiff;
      }

      return lineupDisplayName(a).localeCompare(
        lineupDisplayName(b)
      );
    }
  );
}

function assignPlayersToRows(lineup) {
  const starters = lineup.starters || [];

  // Arquero
  const goalkeeper =
    starters.find(
      (p) =>
        lineupRoleGroup(p) ===
        "goalkeeper"
    ) || starters[0];

  // Jugadores de campo
  const outfield = starters.filter(
    (p) => p !== goalkeeper
  );

  // Separar por rol
  const defenders = outfield.filter(
    (p) =>
      lineupRoleGroup(p) ===
      "defender"
  );

  const midfielders = outfield.filter(
    (p) =>
      lineupRoleGroup(p) ===
      "midfielder"
  );

  const forwards = outfield.filter(
    (p) =>
      lineupRoleGroup(p) ===
      "forward"
  );

  const rows = [];

  // Arquero
  if (goalkeeper) {
    rows.push({
      roleGroup: "goalkeeper",
      players: [goalkeeper]
    });
  }

  // Defensores
  if (defenders.length) {
    rows.push({
      roleGroup: "defender",
      players:
        sortRowPlayersHorizontally(
          defenders
        )
    });
  }

  // Mediocampistas
  if (midfielders.length > 3) {
    const defensiveMids =
      midfielders.filter(
        (player) => {
          const abbr = String(
            player?.position
              ?.abbreviation || ""
          )
            .toUpperCase()
            .trim();

          return !abbr.includes("AM");
        }
      );

    const attackingMids =
      midfielders.filter(
        (player) => {
          const abbr = String(
            player?.position
              ?.abbreviation || ""
          )
            .toUpperCase()
            .trim();

          return abbr.includes("AM");
        }
      );

    if (defensiveMids.length) {
      rows.push({
        roleGroup: "midfielder",
        players:
          sortRowPlayersHorizontally(
            defensiveMids
          )
      });
    }

    if (attackingMids.length) {
      rows.push({
        roleGroup: "midfielder",
        players:
          sortRowPlayersHorizontally(
            attackingMids
          )
      });
    }
  } else if (midfielders.length) {
    rows.push({
      roleGroup: "midfielder",
      players:
        sortRowPlayersHorizontally(
          midfielders
        )
    });
  }

  // Delanteros
  if (forwards.length) {
    rows.push({
      roleGroup: "forward",
      players:
        sortRowPlayersHorizontally(
          forwards
        )
    });
  }

  return rows;
}


// ============================================================
// POSICIONAMIENTO HORIZONTAL
// ============================================================

function getHorizontalWeight(player) {
  const abbr = String(
    player?.position?.abbreviation || ""
  )
    .toUpperCase()
    .trim();

  // Izquierda
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

  // Derecha
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

  return 3;
}

function sortRowPlayersHorizontally(players) {
  return [...players].sort(
    (a, b) =>
      getHorizontalWeight(a) -
      getHorizontalWeight(b)
  );
}


// ============================================================
// RENDER DE FILAS
// ============================================================

function pitchRowHtml(
  row,
  rowIndex,
  rowCount
) {
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

function pitchCardHtml(lineup) {
  const rows =
    assignPlayersToRows(lineup);

  return `
    <article class="pitch-card">
      <div class="pitch-card-head">
        <h4>${lineup.team}</h4>
        <span>
          ${lineup.formation || "4-4-2"}
        </span>
      </div>

      <div class="pitch-surface">
        <div class="pitch-stripes"></div>
        <div class="pitch-midline"></div>
        <div class="pitch-circle"></div>

        ${rows
          .map((row, index) =>
            pitchRowHtml(
              row,
              index,
              rows.length
            )
          )
          .join("")}
      </div>
    </article>
  `;
}


// ============================================================
// ESTADIO
// ============================================================

function extractVenue(raw) {
  const venue =
    raw?.gameInfo?.venue ||
    raw?.header?.competitions?.[0]
      ?.venue;

  return venue?.fullName || "";
}


// ============================================================
// CABECERA DEL PARTIDO
// ============================================================

function matchHeaderHtml(match, extra) {
  const isLive =
    match?.estado === "En juego" ||
    match?.statusType === "in";

  // El detalle de la API viene, por ejemplo: "13'"
  // Lo usamos como minuto de referencia.
  const detalleMinuto = (() => {
    const matchDetalle = String(match?.detalle || "").match(/^(\d+)/);
    return matchDetalle ? Number(matchDetalle[1]) : null;
  })();

  const minutoAPI = Number(match?.minutoJuego ?? match?.minuto);
  const segundoAPI = Number(match?.segundoJuego ?? match?.segundo);

  let minuto = 0;
  let segundo = 0;

  // Si la API realmente manda minuto/segundo, usamos esos datos.
  if (
    Number.isFinite(minutoAPI) &&
    minutoAPI > 0
  ) {
    minuto = minutoAPI;
    segundo = Number.isFinite(segundoAPI) ? segundoAPI : 0;
  }
  // Si no, usamos detalle: "13'" => 13:00
  else if (detalleMinuto !== null) {
    minuto = detalleMinuto;
    segundo = 0;
  }

  const tiempoJuego =
    isLive
      ? `${minuto}:${String(segundo).padStart(2, "0")}`
      : "";

  return `
    <div class="modal-header">

      <span class="team-with-logo">
        <img
          class="team-logo"
          src="${match?.localLogo || PLACEHOLDER_LOGO}"
          alt=""
        />
        <strong>${match?.local || "Local"}</strong>
      </span>

      <div class="score-center">

        <span class="modal-score">
          ${match ? `${match.gl} - ${match.gv}` : "vs"}
        </span>

        ${
          isLive
            ? `<span
                class="match-live-clock"
                id="match-live-clock"
                data-minuto="${minuto}"
                data-segundo="${segundo}"
              >
                ${tiempoJuego}
              </span>`
            : ""
        }

      </div>

      <span class="team-with-logo">
        <img
          class="team-logo"
          src="${match?.visitanteLogo || PLACEHOLDER_LOGO}"
          alt=""
        />
        <strong>${match?.visitante || "Visitante"}</strong>
      </span>

    </div>

    <p class="modal-meta">
      ${
        match
          ? `${match.fecha} ${match.hora} · ${
              isLive ? "EN VIVO" : match.estado
            }`
          : ""
      }
      ${extra ? ` · ${extra}` : ""}
    </p>
  `;
}

// ============================================================
// DETALLE COMPLETO
// ============================================================

function buildMatchDetailHtml(
  raw,
  match
) {
  const scorers =
    extractScorers(raw);

  const cards =
    extractCards(raw);

  const lineups =
    extractLineups(raw);

  const venue =
    extractVenue(raw);

  const yellowCount =
    cards.filter(
      (c) =>
        c.kind === "amarilla"
    ).length;

  const redCount =
    cards.filter(
      (c) =>
        c.kind === "roja"
    ).length;

  const summaryCard = `
    <div class="match-summary-card">

      <span>
        ${scorers.length}
        gol${scorers.length === 1 ? "" : "es"}
      </span>

      <span>
        ${yellowCount}
        amarilla${yellowCount === 1 ? "" : "s"}
      </span>

      <span>
        ${redCount}
        roja${redCount === 1 ? "" : "s"}
      </span>

    </div>
  `;

  const scorersHtml =
    scorers.length
      ? `
        <ul class="event-list">
          ${scorers
            .map((s) =>
              eventRowHtml(
                "goal",
                s.minute,
                s.text
              )
            )
            .join("")}
        </ul>
      `
      : "Sin goles registrados por la API.";

  const yellowCards =
    cards.filter(
      (c) =>
        c.kind === "amarilla"
    );

  const redCards =
    cards.filter(
      (c) =>
        c.kind === "roja"
    );

  const yellowCardsHtml =
    yellowCards.length
      ? `
        <ul class="event-list">
          ${yellowCards
            .map((c) =>
              eventRowHtml(
                "yellow",
                c.minute,
                c.text ||
                  "Tarjeta amarilla"
              )
            )
            .join("")}
        </ul>
      `
      : "No se registraron tarjetas amarillas.";

  const redCardsHtml =
    redCards.length
      ? `
        <ul class="event-list">
          ${redCards
            .map((c) =>
              eventRowHtml(
                "red",
                c.minute,
                c.text ||
                  "Tarjeta roja"
              )
            )
            .join("")}
        </ul>
      `
      : "No se registraron tarjetas rojas.";

  const lineupsHtml =
    lineups.length
      ? `
        <div class="pitch-grid">
          ${lineups
            .map((l) =>
              pitchCardHtml(l)
            )
            .join("")}
        </div>
      `
      : "Formaciones no disponibles para este partido.";

  return `
    ${matchHeaderHtml(
      match,
      venue
    )}

    ${summaryCard}

    <section class="modal-section">
      <h3 class="sub-title">
        Goles
      </h3>

      ${scorersHtml}
    </section>

    <section class="modal-section">
      <h3 class="sub-title">
        Tarjetas amarillas
      </h3>

      ${yellowCardsHtml}
    </section>

    <section class="modal-section">
      <h3 class="sub-title">
        Tarjetas rojas
      </h3>

      ${redCardsHtml}
    </section>

    <section class="modal-section">
      <h3 class="sub-title">
        Formaciones
      </h3>

      ${lineupsHtml}
    </section>
  `;
}


// ============================================================
// RENDER
// ============================================================

function renderMatchDetail(
  raw,
  match
) {
  if (!modalContent) return;

  modalContent.innerHTML =
    buildMatchDetailHtml(
      raw,
      match
    );
}


// ============================================================
// URL
// ============================================================

function detailPageUrl(matchId) {
  const params =
    new URLSearchParams({
      matchId: String(matchId),
      category:
        state.category,
      season:
        String(state.season),
      torneo:
        state.torneo
    });

  return `detail.html?${params.toString()}`;
}

async function openMatchDetail(
  matchId
) {
  window.location.href =
    detailPageUrl(matchId);
}


// ============================================================
// RELOJ EN VIVO DEL DETALLE
// ============================================================

let detailClockTimer = null;
let detailClockSyncTimer = null;

function stopDetailLiveClock() {
  if (detailClockTimer) {
    clearInterval(
      detailClockTimer
    );

    detailClockTimer = null;
  }

  if (detailClockSyncTimer) {
    clearInterval(
      detailClockSyncTimer
    );

    detailClockSyncTimer = null;
  }
}

function startDetailLiveClock(
  matchId
) {
  stopDetailLiveClock();

  // ----------------------------------------------------------
  // Avance local: 1 segundo por segundo
  // ----------------------------------------------------------

  detailClockTimer =
    setInterval(() => {
      const clockEl =
        document.querySelector(
          ".detail-live-clock"
        );

      if (!clockEl) return;

      const current =
        Number(
          clockEl.dataset.seconds
        );

      if (
        !Number.isFinite(
          current
        )
      ) {
        return;
      }

      const seconds =
        current + 1;

      clockEl.dataset.seconds =
        String(seconds);

      const minutes =
        Math.floor(
          seconds / 60
        );

      const secs =
        seconds % 60;

      clockEl.textContent =
        `${minutes}:${String(
          secs
        ).padStart(2, "0")}`;
    }, 1000);


  // ----------------------------------------------------------
  // Sincronización real con ESPN cada 15 segundos
  // ----------------------------------------------------------

  detailClockSyncTimer =
    setInterval(async () => {
      try {
        const res =
          await noCacheFetch(
            summaryUrl(
              state.category,
              matchId
            )
          );

        if (!res.ok) {
          return;
        }

        const raw =
          await res.json();

        const freshMatch =
          parseSummaryMatch(
            raw,
            matchId
          );

        if (!freshMatch) {
          return;
        }

        const clockEl =
          document.querySelector(
            ".detail-live-clock"
          );

        if (
          clockEl &&
          freshMatch.tiempoJuego
        ) {
          const parts =
            String(
              freshMatch.tiempoJuego
            )
              .split(":")
              .map(Number);

          const min =
            parts[0];

          const sec =
            parts[1] || 0;

          if (
            Number.isFinite(min) &&
            Number.isFinite(sec)
          ) {
            const totalSeconds =
              min * 60 + sec;

            clockEl.dataset.seconds =
              String(
                totalSeconds
              );

            clockEl.textContent =
              `${min}:${String(
                sec
              ).padStart(2, "0")}`;
          }
        }

        // ----------------------------------------------------
        // Si terminó el partido:
        // detener reloj y reconstruir detalle
        // ----------------------------------------------------

        if (
          freshMatch.estado !==
          "En juego"
        ) {
          stopDetailLiveClock();

          if (detailPageRoot) {
            detailPageRoot.innerHTML =
              `
                <div class="detail-article">
                  ${buildMatchDetailHtml(
                    raw,
                    freshMatch
                  )}
                </div>
              `;
          }
        }
      } catch (e) {
        console.warn(
          "No se pudo sincronizar el reloj del detalle:",
          e
        );
      }
    }, 15000);
}


// ============================================================
// PÁGINA DE DETALLE
// ============================================================

async function initDetailPage() {
  if (!detailPageRoot) {
    return;
  }

  stopDetailLiveClock();

  const params =
    new URLSearchParams(
      window.location.search
    );

  const matchId =
    params.get("matchId");

  const categoryParam =
    params.get("category");

  const seasonParam =
    Number(
      params.get("season")
    );

  const torneoParam =
    params.get("torneo");


  // ----------------------------------------------------------
  // Estado
  // ----------------------------------------------------------

  state.category =
    categoryParam === "segunda"
      ? "segunda"
      : "primera";

  state.season =
    Number.isFinite(
      seasonParam
    )
      ? seasonParam
      : CURRENT_SEASON;

  state.torneo =
    torneoParam === "clausura"
      ? "clausura"
      : "apertura";


  if (detailBackBtn) {
    detailBackBtn.href =
      "index.html";
  }


  detailPageRoot.innerHTML =
    '<p class="detail-loading">Cargando detalle del partido...</p>';


  if (!matchId) {
    detailPageRoot.innerHTML =
      '<p class="detail-empty">No se indicó el partido.</p>';

    return;
  }


  try {
    const res =
      await noCacheFetch(
        summaryUrl(
          state.category,
          matchId
        )
      );

    if (!res.ok) {
      throw new Error(
        "summary fetch failed"
      );
    }

    const raw =
      await res.json();


    const match =
      parseSummaryMatch(
        raw,
        matchId
      );


    if (!match) {
      detailPageRoot.innerHTML =
        '<p class="detail-empty">No se pudo leer el partido desde ESPN.</p>';

      return;
    }


    // --------------------------------------------------------
    // Render inicial
    // --------------------------------------------------------

    detailPageRoot.innerHTML =
      `
        <div class="detail-article">
          ${buildMatchDetailHtml(
            raw,
            match
          )}
        </div>
      `;


    // --------------------------------------------------------
    // Iniciar reloj si está en vivo
    // --------------------------------------------------------

    if (
      match.estado ===
      "En juego" &&
      match.tiempoJuego
    ) {
      startDetailLiveClock(
        matchId
      );
    }

  } catch (e) {
    console.error(e);

    stopDetailLiveClock();

    detailPageRoot.innerHTML =
      '<p class="detail-empty">No se pudo cargar el detalle de este partido.</p>';
  }
}


// ============================================================
// CERRAR MODAL
// ============================================================

function closeMatchDetail() {
  stopDetailLiveClock();

  matchModal.classList.add(
    "hidden"
  );

  document.body.classList.remove(
    "modal-open"
  );
}


// ============================================================
// EXPORTS
// ============================================================

export {
  openMatchDetail,
  closeMatchDetail,
  initDetailPage,
  renderMatchDetail,
  buildMatchDetailHtml
};