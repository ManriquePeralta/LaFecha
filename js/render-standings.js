import {
  PLACEHOLDER_LOGO,
  CURRENT_SEASON,
  SPLIT_SEASON_MIN_YEAR
} from "./config.js";

import { db, state } from "./state.js";

import {
  standingsSections,
  playoffList,
  playoffBox,
  annualBody,
  averagesBody,
  annualBox,
  averagesBox,
  $,
  isDetailPage
} from "./dom.js";

import {
  bySearch,
  normalize,
  computeLiveStandings
} from "./utils.js";

import { seasonTypeCache } from "./season-types.js";
import { renderMatches } from "./render-matches.js";


// ==========================================
// BUSCAR PARTIDO ENTRE DOS EQUIPOS
// ==========================================

function findCrossMatch(teamA, teamB, allMatches) {
  const nA = normalize(teamA);
  const nB = normalize(teamB);

  const sameTeam = (x, y) =>
    x === y ||
    x.includes(y) ||
    y.includes(x);

  return (allMatches || []).find((m) => {
    const l = normalize(m.local);
    const v = normalize(m.visitante);

    return (
      (sameTeam(l, nA) && sameTeam(v, nB)) ||
      (sameTeam(l, nB) && sameTeam(v, nA))
    );
  });
}


// ==========================================
// CLASES DE TABLA ANUAL
// ==========================================

function annualRowClass(pos, len) {
  if (pos === 1) return "row-leader";

  if (pos >= 2 && pos <= 4) {
    return "row-libertadores";
  }

  if (pos >= 5 && pos <= 10) {
    return "row-sudamericana";
  }

  if (pos === len) {
    return "row-descenso";
  }

  return "";
}


// ==========================================
// NOMBRE DEL TORNEO
// ==========================================

function torneoLabel(torneoKey) {
  return torneoKey === "clausura"
    ? "Clausura"
    : "Apertura";
}


// ==========================================
// CONTEXTO DE TABLA
// ==========================================

function updateTableContext() {
  const contextEl = $("#table-context");

  if (!contextEl) return;

  if (state.category !== "primera") {
    contextEl.innerHTML = `
      <button
        type="button"
        class="tournament-link"
        data-open-tournament
      >
        Temporada ${state.season}
        <span class="tournament-arrow">→</span>
      </button>
    `;

    return;
  }

  const isSplit =
    state.season >= SPLIT_SEASON_MIN_YEAR;

  if (!isSplit) {
    contextEl.innerHTML = `
      <button
        type="button"
        class="tournament-link"
        data-open-tournament
      >
        Temporada ${state.season}
        <span class="tournament-arrow">→</span>
      </button>
    `;

    return;
  }

  const discovered =
    seasonTypeCache.get(
      `${state.category}:${state.season}`
    );

  let text =
    `Torneo ${torneoLabel(state.torneo)} ${state.season}`;

  if (discovered?.onlyOneAvailable) {
    const otherTorneo =
      state.torneo === "apertura"
        ? "Clausura"
        : "Apertura";

    text +=
      ` (el ${otherTorneo} no esta disponible por separado en esta fuente todavia)`;
  }

  contextEl.innerHTML = `
    <button
      type="button"
      class="tournament-link"
      data-open-tournament
    >
      ${text}
      <span class="tournament-arrow">→</span>
    </button>
  `;
}


// ==========================================
// TEXTO PARA PARTIDOS DE CRUCES
// ==========================================

function getCrossMatchMarker(match) {
  if (!match) {
    return "Sin partido cargado";
  }

  const gl =
    match.gl ??
    match.golesLocal ??
    "-";

  const gv =
    match.gv ??
    match.golesVisitante ??
    "-";

  const estado =
    String(match.estado || "").toUpperCase();

  /*
   * Si el partido está en vivo y el loader ya agregó
   * tiempoJuego, mostramos:
   *
   * 2-1 (67:34)
   *
   * en lugar de simplemente:
   *
   * 2-1 (EN JUEGO)
   */
  if (
    (estado === "EN JUEGO" ||
      estado === "EN VIVO" ||
      estado === "LIVE") &&
    match.tiempoJuego
  ) {
    return `${gl}-${gv} (EN VIVO · ${match.tiempoJuego})`;
  }

  return `${gl}-${gv} (${match.estado || "Sin estado"})`;
}


// ==========================================
// TABLA DE POSICIONES + CRUCES
// ==========================================

function renderStandingsAndCrosses() {
  updateTableContext();

  const liga =
    db[state.category] || {};

  /*
   * Unificamos los partidos disponibles en db
   * para calcular la tabla en vivo.
   */
  const currentMatches = [
    ...(liga.resultados || []),
    ...(liga.allMatches || [])
  ];

  const zonasRaw =
    Array.isArray(liga.zonas) &&
    liga.zonas.length
      ? liga.zonas
      : [
          {
            nombre: "Tabla general",
            tabla: liga.tabla || []
          }
        ];

  const zonas = zonasRaw
    .map((z) => {
      /*
       * PROCESAMOS LA TABLA EN VIVO
       * ANTES DE FILTRAR.
       */
      const liveTable =
        computeLiveStandings(
          z.tabla || [],
          currentMatches
        );

      return {
        nombre: z.nombre,

        tabla: liveTable.filter((r) =>
          bySearch(r.equipo)
        )
      };
    })
    .filter((z) =>
      z.tabla.length
    );


  // ========================================
  // RENDER TABLAS
  // ========================================

  standingsSections.innerHTML =
    zonas
.map((zona) => {
        const rows =
          zona.tabla
            .map((row, idx) => {
              const pos = idx + 1;

              const rowClass =
                pos <= 8
                  ? "playoff"
                  : "";

              return `
                <tr class="${rowClass}">
                  <td>${pos}</td>

                  <td>
                    <span class="team-with-logo team-link" data-team-name="${row.equipo}">
                      <img
                        class="team-logo"
                        src="${row.logo || PLACEHOLDER_LOGO}"
                        alt=""
                      />
                      <strong>${row.equipo}</strong>
                    </span>
                  </td>

                  <td class="cell-pts">
                    ${row.pts}
                  </td>

                  <td>
                    ${row.pj}
                  </td>

                  <td>
                    ${row.dg > 0 ? "+" : ""}${row.dg}
                  </td>
                </tr>
              `;
            })
            .join("");

        return `
          <section class="zone-block">

            <h3 class="sub-title">
              ${zona.nombre}
            </h3>

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

                <tbody>
                  ${rows}
                </tbody>

              </table>
            </div>

          </section>
        `;
      })
      .join("");


  // ========================================
  // PLAYOFFS
  // ========================================

  if (
    state.category !== "primera" ||
    state.season !== CURRENT_SEASON
  ) {
    playoffBox.style.display = "none";
    return zonasRaw;
  }

  playoffBox.style.display = "block";

  const zoneA =
    zonasRaw.find((z) =>
      /a/i.test(z.nombre)
    ) || zonasRaw[0];

  const zoneB =
    zonasRaw.find(
      (z) =>
        /b/i.test(z.nombre) &&
        z !== zoneA
    ) || zonasRaw[1];


  /*
   * El cruce cruzado necesita dos zonas
   * con al menos dos equipos.
   */
  if (
    !zoneA?.tabla?.length ||
    !zoneB?.tabla?.length ||
    zoneA.tabla.length < 2 ||
    zoneB.tabla.length < 2
  ) {
    playoffList.innerHTML =
      "No hay zonas completas para proyectar cruces.";

    return zonasRaw;
  }


  const crossSize =
    Math.min(
      8,
      zoneA.tabla.length,
      zoneB.tabla.length
    );

  const half =
    Math.floor(crossSize / 2);


  if (half < 1) {
    playoffList.innerHTML =
      "No hay suficientes equipos para proyectar cruces.";

    return zonasRaw;
  }


  const a =
    zoneA.tabla.slice(
      0,
      crossSize
    );

  const b =
    zoneB.tabla.slice(
      0,
      crossSize
    );

  const allMatches =
    liga.allMatches || [];


  // ========================================
  // GENERAR CRUCES
  // ========================================

  const rawCrosses = [];

  for (let i = 0; i < half; i++) {
    rawCrosses.push([
      a[i],
      b[crossSize - 1 - i]
    ]);
  }

  for (let i = 0; i < half; i++) {
    rawCrosses.push([
      b[i],
      a[crossSize - 1 - i]
    ]);
  }


  const crosses =
    rawCrosses.filter(
      ([l, v]) =>
        bySearch(
          l.equipo,
          v.equipo
        )
    );


  playoffList.innerHTML =
    crosses
      .map(([local, visitante]) => {
        const current =
          findCrossMatch(
            local.equipo,
            visitante.equipo,
            allMatches
          );

        const marker =
          getCrossMatchMarker(current);

        return `
          <article class="cross-card">

            <p class="teams">
              <strong>${local.equipo}</strong>
              vs
              <strong>${visitante.equipo}</strong>
            </p>

            <p class="meta">
              ${marker}
            </p>

          </article>
        `;
      })
      .join("");


  return zonasRaw;
}


// ==========================================
// TABLA ANUAL + PROMEDIOS
// ==========================================

function renderAnnualAndAverages() {
  const liga =
    db[state.category];

  if (!annualBox || !averagesBox) {
    return;
  }

  if (state.category !== "primera") {
    annualBox.style.display = "none";
    averagesBox.style.display = "none";

    return;
  }

  annualBox.style.display = "block";
  averagesBox.style.display = "block";


  // ========================================
  // TABLA ANUAL
  // ========================================

  const annual =
    (liga.annual || [])
      .filter((r) =>
        bySearch(r.equipo)
      );

  const annualLen =
    annual.length;

  annualBody.innerHTML =
    annual
      .map((r, idx) => {
        const pos = idx + 1;

        return `
          <tr class="${annualRowClass(pos, annualLen)}">

            <td>
              ${pos}
            </td>

            <td>
              <span class="team-with-logo">
                <img
                  class="team-logo"
                  src="${r.logo || PLACEHOLDER_LOGO}"
                  alt=""
                />
                ${r.equipo}
              </span>
            </td>

            <td class="cell-pts">
              ${r.pts}
            </td>

            <td>
              ${r.pj}
            </td>

            <td>
              ${r.dg > 0 ? "+" : ""}${r.dg}
            </td>

          </tr>
        `;
      })
      .join("");


  // ========================================
  // PROMEDIOS
  // ========================================

  const avg =
    (liga.averages || [])
      .filter((r) =>
        bySearch(r.equipo)
      );

  const avgLen =
    avg.length;

  averagesBody.innerHTML =
    avg
      .map((r, idx) => {
        const pos = idx + 1;

        return `
          <tr class="${annualRowClass(pos, avgLen)}">

            <td>
              ${pos}
            </td>

            <td>
              <span class="team-with-logo">
                <img
                  class="team-logo"
                  src="${r.logo || PLACEHOLDER_LOGO}"
                  alt=""
                />
                ${r.equipo}
              </span>
            </td>

            <td class="cell-pts">
              ${r.pts}
            </td>

            <td>
              ${r.pj}
            </td>

            <td>
              ${r.prom.toFixed(3)}
            </td>

          </tr>
        `;
      })
      .join("");
}


// ==========================================
// RENDER GENERAL
// ==========================================

// En render-standings.js

function renderAll() {
  if (isDetailPage) return;

  const playoffBox = document.querySelector("#playoff-box");
  const annualBox = document.querySelector("#annual-box");
  const averagesBox = document.querySelector("#averages-box");
  const tableControls = document.querySelector("#table-controls");

  // ==========================================
  // 1. MODO LIGAS ESPN (INTERNACIONAL / COPA ARG)
  // ==========================================
  if (state.isEspnLeague) {
    // Ocultamos paneles exclusivos del formato AFA
    if (playoffBox) playoffBox.style.display = "none";
    if (annualBox) annualBox.style.display = "none";
    if (averagesBox) averagesBox.style.display = "none";
    if (tableControls) tableControls.style.display = "none";

    // Pintamos únicamente los partidos e interfaz de la liga ESPN
    renderMatches();
    renderEspnStandings();
    return;
  }

  // ==========================================
  // 2. MODO FÚTBOL ARGENTINO (AFA)
  // ==========================================
  // Restauramos visibilidad de paneles AFA
  if (playoffBox) playoffBox.style.display = "block";
  if (annualBox) annualBox.style.display = "block";
  if (averagesBox) averagesBox.style.display = "block";
  if (tableControls) tableControls.style.display = "flex";

  // Ejecutamos tus funciones modulares nativas de AFA
  renderMatches();
  renderStandingsAndCrosses();
  renderAnnualAndAverages();
}

// Helper para dibujar la tabla de ESPN en el contenedor #standings-sections
function renderEspnStandings() {
  const standingsContainer = document.querySelector("#standings-sections");
  if (!standingsContainer) return;

  if (!state.currentStandings || !state.currentStandings.zonas?.length) {
    standingsContainer.innerHTML = '<p class="detail-empty">Sin datos de posiciones disponibles para esta competencia.</p>';
    return;
  }

  const zona = state.currentStandings.zonas[0];
  const rowsHtml = (zona.tabla || []).map((item, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td class="team-with-logo">
        ${item.logo ? `<img src="${item.logo}" alt="" class="team-logo" />` : ''}
        <strong class="team-name" data-team-name="${item.equipo}">${item.equipo}</strong>
      </td>
      <td><strong>${item.pts}</strong></td>
      <td>${item.pj}</td>
      <td>${item.dg}</td>
    </tr>
  `).join("");

  standingsContainer.innerHTML = `
    <div class="table-wrap">
      <h3 class="sub-title">${zona.nombre || 'Tabla de Posiciones'}</h3>
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
        <tbody>
          ${rowsHtml || '<tr><td colspan="5">Sin equipos registrados.</td></tr>'}
        </tbody>
      </table>
    </div>
    <button class="tournament-link" data-open-tournament type="button">
      Ver torneo completo
      <span class="tournament-arrow">→</span>
    </button>
  `;
}

function goToTournamentPage() {
  const params = new URLSearchParams({
    category: state.isEspnLeague ? "espn" : state.category,
    season: String(state.season || CURRENT_SEASON),
    torneo: state.torneo || "clausura"
  });

  if (state.isEspnLeague && state.espnLeagueCode) {
    params.set("league", state.espnLeagueCode);
  }

  window.location.href = `tournament.html?${params.toString()}`;
}


// ==========================================
// EXPORTS
// ==========================================

export {
  findCrossMatch,
  annualRowClass,
  torneoLabel,
  updateTableContext,
  renderStandingsAndCrosses,
  goToTournamentPage,
  renderAnnualAndAverages,
  renderAll
};
