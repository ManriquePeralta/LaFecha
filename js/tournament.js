import {
  API,
  LEAGUE_CODE,
  PLACEHOLDER_LOGO,
  SPLIT_SEASON_MIN_YEAR
} from "./config.js";

import {
  fetchStandingsSafe
} from "./season-types.js";

import {
  normalize,
  noCacheFetch
} from "./utils.js";

// ============================================================
// PARÁMETROS DE URL
// ============================================================

const params = new URLSearchParams(window.location.search);

const category =
  params.get("category") || "primera";

const season =
  Number(params.get("season")) || 2026;

const torneo =
  params.get("torneo") || "clausura";

const espnLeagueCode =
  params.get("league") || "";

const isEspnLeague =
  category === "espn";

// ============================================================
// ESTADO
// ============================================================

const state = {
  category,
  season,
  torneo,

  leagueCode: "",

  standings: [],
  standingsZones: [],

  matches: [],
  filteredMatches: [],

  loading: false,

  search: "",

  lastUpdated: null
};

// ============================================================
// DOM
// ============================================================

const titleEl =
  document.querySelector("#tournament-title");

const competitionEl =
  document.querySelector("#competition-label");

const subtitleEl =
  document.querySelector("#tournament-subtitle");

const statusTextEl =
  document.querySelector("#status-text");

const lastUpdateEl =
  document.querySelector("#last-update");

const standingsBody =
  document.querySelector("#standings-body");

const matchesContainer =
  document.querySelector("#matches-container");

const searchEl =
  document.querySelector("#team-search");

const backButton =
  document.querySelector("#back-button");

const cupStructurePanel =
  document.querySelector("#cup-structure-panel");

const cupStructureContent =
  document.querySelector("#cup-structure-content");

const cupStructureDescription =
  document.querySelector("#cup-structure-description");

const standingsPanel =
  document.querySelector("#standings-panel");

const tournamentContentGrid =
  document.querySelector("#tournament-content-grid");

// ============================================================
// CONFIGURACIÓN DE COMPETENCIA
// ============================================================

function getLeagueCode() {
  if (isEspnLeague) {
    return espnLeagueCode;
  }

  return LEAGUE_CODE[state.category] || "";
}

// ============================================================
// NOMBRE DEL TORNEO
// ============================================================

function tournamentName() {
  if (isEspnLeague) {
    const names = {
      "arg.copa": "Copa Argentina",
      "conmebol.libertadores": "Copa Libertadores",
      "conmebol.sudamericana": "Copa Sudamericana",
      "uefa.champions": "Champions League",
      "uefa.europa": "Europa League",
      "uefa.europa.conf": "Conference League"
    };
    return names[espnLeagueCode] || "Competencia";
  }

  if (category === "segunda") {
    return "Primera Nacional";
  }

  if (
    season >= SPLIT_SEASON_MIN_YEAR &&
    category === "primera"
  ) {
    return torneo === "apertura"
      ? "Apertura"
      : "Clausura";
  }

  return "Primera División";
}

// ============================================================
// HEADER
// ============================================================

function renderHeader() {
  if (!competitionEl || !titleEl || !subtitleEl) {
    return;
  }

  const competition =
    isEspnLeague
      ? tournamentName()
      : category === "segunda"
        ? "Primera Nacional"
        : "Primera División";

  competitionEl.textContent =
    competition;

  titleEl.textContent =
    tournamentName();

  subtitleEl.textContent =
    `Temporada ${season}`;
}

// ============================================================
// STATUS
// ============================================================

function setStatus(text, type = "") {
  if (statusTextEl) {
    statusTextEl.textContent = text;
  }

  const bar =
    document.querySelector("#status-bar");

  if (bar) {
    bar.classList.toggle(
      "live",
      type === "live"
    );
  }
}

function setLastUpdate() {
  if (!lastUpdateEl) {
    return;
  }

  if (!state.lastUpdated) {
    lastUpdateEl.textContent = "";
    return;
  }

  lastUpdateEl.textContent =
    `Actualizado ${
      new Intl.DateTimeFormat(
        "es-AR",
        {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit"
        }
      ).format(state.lastUpdated)
    }`;
}

// ============================================================
// SCOREBOARD URL
// ============================================================

function scoreboardUrl(
  leagueCode,
  from,
  to
) {
  const url =
    `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/scoreboard`;

  const query =
    new URLSearchParams();

  query.set(
    "dates",
    `${from}-${to}`
  );

  query.set(
    "limit",
    "1000"
  );

  return `${url}?${query.toString()}`;
}

// ============================================================
// FECHAS
// ============================================================

function formatDateForApi(date) {
  const year =
    date.getFullYear();

  const month =
    String(date.getMonth() + 1)
      .padStart(2, "0");

  const day =
    String(date.getDate())
      .padStart(2, "0");

  return `${year}${month}${day}`;
}

function tournamentDateRange() {

  // ========================================================
  // PRIMERA ARGENTINA
  // ========================================================

  if (
    !isEspnLeague &&
    category === "primera" &&
    season >= SPLIT_SEASON_MIN_YEAR
  ) {

    if (torneo === "apertura") {
      return {
        from: `${season}0101`,
        to: `${season}0630`
      };
    }

    return {
      from: `${season}0701`,
      to: `${season}1231`
    };
  }

  // ========================================================
  // RESTO DE COMPETENCIAS
  // ========================================================

  return {
    from: `${season}0101`,
    to: `${season}1231`
  };
}

// ============================================================
// OBTENER PARTIDOS DEL TORNEO
// ============================================================

async function fetchTournamentMatches() {
  const leagueCode =
    state.leagueCode;

  if (!leagueCode) {
    throw new Error(
      "No se encontró el código de la competencia."
    );
  }

  const range =
    tournamentDateRange();

  const fromDate =
    parseDate(range.from);

  const toDate =
    parseDate(range.to);

  const requests = [];

  let cursor =
    new Date(fromDate);

  while (cursor <= toDate) {

    const chunkStart =
      new Date(cursor);

    const chunkEnd =
      new Date(cursor);

    chunkEnd.setMonth(
      chunkEnd.getMonth() + 1
    );

    chunkEnd.setDate(0);

    if (chunkEnd > toDate) {
      chunkEnd.setTime(
        toDate.getTime()
      );
    }

    requests.push(
      fetchScoreboardChunk(
        leagueCode,
        formatDateForApi(chunkStart),
        formatDateForApi(chunkEnd)
      )
    );

    cursor =
      new Date(chunkEnd);

    cursor.setDate(
      cursor.getDate() + 1
    );
  }

  const chunks =
    await Promise.all(requests);

  const map =
    new Map();

  chunks
    .flat()
    .forEach((match) => {

      if (!match?.id) {
        return;
      }

      map.set(
        String(match.id),
        match
      );
    });

  return [...map.values()]
    .sort((a, b) => {

      const da =
        new Date(
          a.dateIso || 0
        ).getTime();

      const db =
        new Date(
          b.dateIso || 0
        ).getTime();

      return da - db;
    });
}

// ============================================================
// CHUNK ESPN
// ============================================================

async function fetchScoreboardChunk(
  leagueCode,
  from,
  to
) {
  try {

    const res =
      await noCacheFetch(
        scoreboardUrl(
          leagueCode,
          from,
          to
        )
      );

    if (!res.ok) {
      console.warn(
        "ESPN respondió",
        res.status,
        from,
        to
      );

      return [];
    }

    const json =
      await res.json();

    return parseScoreboardEvents(
      json
    );

  } catch (error) {

    console.error(
      "Error obteniendo partidos:",
      error
    );

    return [];
  }
}

// ============================================================
// PARSE PARTIDOS ESPN
// ============================================================

function parseScoreboardEvents(json) {

  const events =
    Array.isArray(json?.events)
      ? json.events
      : [];

  return events.map((event) => {

    const competition =
      event.competitions?.[0];

    const competitors =
      competition?.competitors || [];

    const home =
      competitors.find(
        team =>
          team.homeAway === "home"
      );

    const away =
      competitors.find(
        team =>
          team.homeAway === "away"
      );

    const status =
      competition?.status ||
      event.status ||
      {};

    const type =
      status.type || {};

    const completed =
      Boolean(
        type.completed
      );

    const stateName =
      String(
        type.name || ""
      ).toUpperCase();

    const isLive =
      !completed &&
      (
        type.state === "in" ||
        stateName === "IN" ||
        stateName === "IN_PROGRESS" ||
        stateName === "LIVE"
      );

    const homeScore =
      Number.isFinite(
        Number(home?.score)
      )
        ? Number(home.score)
        : null;

    const awayScore =
      Number.isFinite(
        Number(away?.score)
      )
        ? Number(away.score)
        : null;

    const dateIso =
      event.date ||
      competition?.date ||
      null;

    const clock =
      status?.clock != null
        ? Number(status.clock)
        : null;

    const minute =
      Number.isFinite(clock)
        ? Math.floor(clock / 60)
        : null;

    const second =
      Number.isFinite(clock)
        ? Math.floor(clock % 60)
      : 0;

    const stage = deriveCupStage(
      competition?.notes?.[0]?.headline ||
      competition?.notes?.[0]?.text ||
      event?.seasonType?.name ||
      event?.season?.type?.name ||
      competition?.type?.text ||
      ""
    );

    return {

      id:
        event.id ||
        competition?.id ||
        crypto.randomUUID(),

      local:
        home?.team?.displayName ||
        home?.team?.shortDisplayName ||
        home?.team?.name ||
        "Local",

      visitante:
        away?.team?.displayName ||
        away?.team?.shortDisplayName ||
        away?.team?.name ||
        "Visitante",

      localLogo:
        home?.team?.logo ||
        home?.team?.logos?.[0]?.href ||
        PLACEHOLDER_LOGO,

      visitanteLogo:
        away?.team?.logo ||
        away?.team?.logos?.[0]?.href ||
        PLACEHOLDER_LOGO,

      gl:
        homeScore,

      gv:
        awayScore,

      dateIso,

      estado:
        completed
          ? "FINAL"
          : isLive
            ? "EN JUEGO"
            : "PROGRAMADO",

      isLive,

      isCompleted:
        completed,

      minute,

      second,

      // IMPORTANTE:
      // no mandamos al resumen de ESPN.
      // El detalle se abre mediante detail.html.
      category:
        state.category,

      league:
        state.leagueCode,

      season:
        state.season,

      torneo:
        state.torneo,

      stage
    };
  });
}

// ESPN suele describir cada vuelta con frases diferentes (por ejemplo,
// "2nd leg - X advances..."). Para el cuadro necesitamos la ronda común,
// no un encabezado distinto por cada partido.
function deriveCupStage(value) {
  const text = normalize(value);
  if (/octav|round of 16/.test(text)) return "Octavos de final";
  if (/cuart|quarter/.test(text)) return "Cuartos de final";
  if (/semi/.test(text)) return "Semifinales";
  if (/final/.test(text) && !/quarter|semi/.test(text)) return "Final";
  if (/grupo|group|league phase|fase liga/.test(text)) return "Fase de grupos";
  if (/prelim|clasific|qualif|repech|first leg|second leg|1st leg|2nd leg/.test(text)) return "Fase clasificatoria";
  return "Fixture";
}

// ============================================================
// PARSE DATE
// ============================================================

function parseDate(value) {

  const year =
    Number(value.slice(0, 4));

  const month =
    Number(value.slice(4, 6)) - 1;

  const day =
    Number(value.slice(6, 8));

  return new Date(
    year,
    month,
    day
  );
}

// ============================================================
// TABLAS
// ============================================================

async function loadStandings() {

  // ========================================================
  // ESPN EXTERNO
  // ========================================================

  if (isEspnLeague) {

    const url =
      `https://site.api.espn.com/apis/v2/sports/soccer/${state.leagueCode}/standings?season=${season}`;

    const res =
      await noCacheFetch(url);

    if (!res.ok) {
      throw new Error(
        "No se pudo cargar la tabla."
      );
    }

    const json =
      await res.json();

    const parsed =
      parseGenericStandings(json);

    state.standings =
      parsed.rows;

    state.standingsZones =
      parsed.zones;

    return;
  }

  // ========================================================
  // ARGENTINA
  // ========================================================

  const result =
    await fetchStandingsSafe(
      category,
      season,
      torneo
    );

  const parsed =
    parseArgentinaStandings(
      result
    );

  state.standings =
    parsed.rows;

  state.standingsZones =
    parsed.zones;
}

// ============================================================
// PARSE TABLAS ARGENTINAS
// ============================================================

function parseArgentinaStandings(result) {

  if (!result) {
    return {
      rows: [],
      zones: []
    };
  }

  // --------------------------------------------------------
  // Caso ideal:
  //
  // {
  //   zonas: [
  //     {
  //       nombre: "Zona A",
  //       tabla: [...]
  //     },
  //     {
  //       nombre: "Zona B",
  //       tabla: [...]
  //     }
  //   ]
  // }
  // --------------------------------------------------------

  if (
    Array.isArray(result.zonas) &&
    result.zonas.length
  ) {

    const zones =
      result.zonas
        .map((zone, index) => {

          const rows =
            Array.isArray(zone?.tabla)
              ? zone.tabla
              : Array.isArray(zone?.entries)
                ? zone.entries
                : [];

          return {
            nombre:
              zone?.nombre ||
              zone?.name ||
              `Zona ${String.fromCharCode(65 + index)}`,

            tabla:
              normalizeRows(rows)
          };
        })
        .filter(zone =>
          zone.tabla.length
        );

    return {
      rows:
        zones.flatMap(
          zone => zone.tabla
        ),

      zones
    };
  }

  // --------------------------------------------------------
  // Caso:
  //
  // result.tabla = [...]
  // --------------------------------------------------------

  if (
    Array.isArray(result.tabla)
  ) {

    const rows =
      normalizeRows(
        result.tabla
      );

    return {
      rows,
      zones: []
    };
  }

  // --------------------------------------------------------
  // Caso:
  //
  // result.standings = [...]
  // --------------------------------------------------------

  if (
    Array.isArray(result.standings)
  ) {

    const rows =
      normalizeRows(
        result.standings
      );

    return {
      rows,
      zones: []
    };
  }

  // --------------------------------------------------------
  // Caso array directo
  // --------------------------------------------------------

  if (
    Array.isArray(result)
  ) {

    const rows =
      normalizeRows(result);

    return {
      rows,
      zones: []
    };
  }

  return {
    rows: [],
    zones: []
  };
}

// ============================================================
// PARSE TABLA ESPN
// ============================================================

function parseGenericStandings(json) {

  const groups =
    Array.isArray(json?.children)
      ? json.children
      : [];

  // --------------------------------------------------------
  // Si ESPN devuelve múltiples grupos,
  // los tratamos como zonas.
  // --------------------------------------------------------

  if (groups.length > 1) {

    const zones =
      groups
        .map((group, index) => {

          const entries =
            group?.standings?.entries || [];

          return {
            nombre:
              group?.name ||
              group?.abbreviation ||
              `Zona ${String.fromCharCode(65 + index)}`,

            tabla:
              normalizeRows(
                entries.map(
                  normalizeEspnEntry
                )
              )
          };
        })
        .filter(zone =>
          zone.tabla.length
        );

    return {
      rows:
        zones.flatMap(
          zone => zone.tabla
        ),

      zones
    };
  }

  const entries =
    groups[0]?.standings?.entries ||
    json?.standings?.entries ||
    [];

  const rows =
    entries.map(
      normalizeEspnEntry
    );

  return {
    rows,
    zones: []
  };
}

// ============================================================
// NORMALIZAR ENTRADA ESPN
// ============================================================

function normalizeEspnEntry(entry) {

  const stats =
    entry?.stats || [];

  const stat =
    (name, fallback = 0) => {

      const found =
        stats.find(
          item =>
            item.name === name ||
            item.abbreviation === name
        );

      return Number(
        found?.value ??
        fallback
      );
    };

  return {

    equipo:
      entry?.team?.displayName ||
      entry?.team?.name ||
      "Equipo",

    logo:
      entry?.team?.logos?.[0]?.href ||
      entry?.team?.logo ||
      PLACEHOLDER_LOGO,

    pts:
      stat("points"),

    pj:
      stat("gamesPlayed"),

    pg:
      stat("wins"),

    pe:
      stat("ties"),

    pp:
      stat("losses"),

    gf:
      stat("pointsFor"),

    gc:
      stat("pointsAgainst"),

    dg:
      stat("pointDifferential")
  };
}

// ============================================================
// NORMALIZAR FILAS
// ============================================================

function normalizeRows(rows) {

  const normalized = rows.map((team) => {

    // Ya está normalizado
    if (
      team &&
      typeof team === "object" &&
      team.equipo
    ) {
      return {
        equipo:
          team.equipo,

        logo:
          team.logo ||
          PLACEHOLDER_LOGO,

        pts:
          Number(team.pts || 0),

        pj:
          Number(team.pj || 0),

        pg:
          Number(team.pg || 0),

        pe:
          Number(team.pe || 0),

        pp:
          Number(team.pp || 0),

        gf:
          Number(team.gf || 0),

        gc:
          Number(team.gc || 0),

        dg:
          Number(team.dg || 0)
      };
    }

    // Estructura más genérica
    return {

      equipo:
        team?.equipo ||
        team?.team ||
        team?.nombre ||
        team?.name ||
        team?.displayName ||
        "Equipo",

      logo:
        team?.logo ||
        team?.teamLogo ||
        PLACEHOLDER_LOGO,

      pts:
        Number(
          team?.pts ??
          team?.points ??
          0
        ),

      pj:
        Number(
          team?.pj ??
          team?.gamesPlayed ??
          0
        ),

      pg:
        Number(
          team?.pg ??
          team?.wins ??
          0
        ),

      pe:
        Number(
          team?.pe ??
          team?.ties ??
          team?.draws ??
          0
        ),

      pp:
        Number(
          team?.pp ??
          team?.losses ??
          0
        ),

      gf:
        Number(
          team?.gf ??
          team?.goalsFor ??
          0
        ),

      gc:
        Number(
          team?.gc ??
          team?.goalsAgainst ??
          0
        ),

      dg:
        Number(
          team?.dg ??
          team?.goalDifference ??
          (
            Number(team?.gf || 0) -
            Number(team?.gc || 0)
          )
        )
    };
  });

  // No dependemos del orden recibido: algunas respuestas de ESPN llegan
  // ordenadas por identificador y no por la clasificación deportiva.
  return normalized.sort((a, b) =>
    b.pts - a.pts ||
    b.dg - a.dg ||
    b.gf - a.gf ||
    b.pg - a.pg ||
    a.equipo.localeCompare(b.equipo, "es")
  );
}

// ============================================================
// RENDER TABLAS
// ============================================================

function renderStandings() {

  if (!standingsBody) {
    return;
  }

  const needle =
    normalize(state.search);

  // ========================================================
  // TABLA POR ZONAS
  // ========================================================

  if (
    Array.isArray(state.standingsZones) &&
    state.standingsZones.length
  ) {

    const html =
      state.standingsZones
        .map((zone) => {

          const rows =
            zone.tabla.filter((team) => {

              if (!needle) {
                return true;
              }

              return normalize(
                team.equipo
              ).includes(needle);
            });

          return `

            <tr class="zone-header">
              <td colspan="5">
                ${escapeHtml(zone.nombre)}
              </td>
            </tr>

            ${
              rows.length
                ? rows
                    .map(
                      (team, index) =>
                        renderStandingRow(
                          team,
                          index
                        )
                    )
                    .join("")
                : `
                  <tr>
                    <td
                      colspan="5"
                      class="empty"
                    >
                      No hay equipos para mostrar.
                    </td>
                  </tr>
                `
            }

          `;
        })
        .join("");

    standingsBody.innerHTML =
      html;

    return;
  }

  // ========================================================
  // TABLA NORMAL
  // ========================================================

  const rows =
    state.standings.filter(
      (team) => {

        if (!needle) {
          return true;
        }

        return normalize(
          team.equipo
        ).includes(needle);
      }
    );

  if (!rows.length) {

    standingsBody.innerHTML = `
      <tr>
        <td
          colspan="5"
          class="empty"
        >
          No hay equipos para mostrar.
        </td>
      </tr>
    `;

    return;
  }

  standingsBody.innerHTML =
    rows
      .map(
        (team, index) =>
          renderStandingRow(
            team,
            index
          )
      )
      .join("");
}

// ============================================================
// FILA DE TABLA
// ============================================================

function renderStandingRow(
  team,
  index
) {

  const dg =
    Number(team.dg || 0);

  return `
    <tr>

      <td class="position">
        ${index + 1}
      </td>

      <td>
        <div class="team">

          <img
            class="team-logo"
            src="${escapeAttribute(
              team.logo ||
              PLACEHOLDER_LOGO
            )}"
            alt=""
          >

          <strong>
            ${escapeHtml(
              team.equipo
            )}
          </strong>

        </div>
      </td>

      <td class="pts">
        ${Number(team.pts || 0)}
      </td>

      <td>
        ${Number(team.pj || 0)}
      </td>

      <td>
        ${
          dg > 0
            ? "+"
            : ""
        }${dg}
      </td>

    </tr>
  `;
}

// ============================================================
// RENDER PARTIDOS
// ============================================================

function renderMatches() {

  if (!matchesContainer) {
    return;
  }

  const needle =
    normalize(state.search);

  const filtered = state.matches.filter(
      (match) => {

        if (!needle) {
          return true;
        }

        return (
          normalize(
            match.local
          ).includes(needle) ||

          normalize(
            match.visitante
          ).includes(needle)
        );
      }
    );

  state.filteredMatches = filtered;

  if (!filtered.length) {

    matchesContainer.innerHTML = `
      <div class="empty">
        No hay partidos para este torneo.
      </div>
    `;

    return;
  }

  const now = new Date();
  const results = filtered
    .filter((match) => match.isCompleted || new Date(match.dateIso) < now)
    .sort((a, b) => new Date(b.dateIso) - new Date(a.dateIso));
  const upcoming = filtered
    .filter((match) => !match.isCompleted && new Date(match.dateIso) >= now)
    .sort((a, b) => new Date(a.dateIso) - new Date(b.dateIso));

  matchesContainer.innerHTML = `
    <div class="fixture-sections">
      ${renderFixtureSection("results", "Resultados", results, "Sin resultados recientes.")}
      ${renderFixtureSection("upcoming", "Próximos partidos", upcoming, "No hay próximos partidos programados.")}
    </div>`;
}

const FIXTURE_PAGE_SIZE = 5;

function renderFixtureSection(key, title, matches, emptyText) {
  const visible = matches.slice(0, FIXTURE_PAGE_SIZE);
  const hidden = matches.slice(FIXTURE_PAGE_SIZE);
  const hiddenId = `fixture-${key}-hidden`;
  return `
    <section class="fixture-section">
      <h3 class="fixture-section-title">${title}</h3>
      ${visible.length ? visible.map(renderFixtureItem).join("") : `<p class="empty">${emptyText}</p>`}
      ${hidden.length ? `<div id="${hiddenId}" class="fixture-hidden">${hidden.map(renderFixtureItem).join("")}</div>` : ""}
      ${hidden.length ? `<button class="fixture-more" type="button" data-fixture-target="${hiddenId}">Ver más⌄</button>` : ""}
    </section>`;
}

function renderFixtureItem(match) {
  const date = match.dateIso ? new Intl.DateTimeFormat("es-AR", { weekday: "short", day: "2-digit", month: "short" }).format(new Date(match.dateIso)) : "Fecha a confirmar";
  const score = match.isCompleted ? `${match.gl ?? "-"} - ${match.gv ?? "-"}` : "Programado";
  return `
    <article class="fixture-item match" data-match-id="${escapeAttribute(match.id)}" data-category="${escapeAttribute(match.category || state.category)}" data-league="${escapeAttribute(match.league || state.leagueCode)}" data-season="${state.season}" data-torneo="${escapeAttribute(state.torneo)}">
      <time>${escapeHtml(date)}</time>
      <span>${escapeHtml(match.local)}</span>
      <strong class="fixture-score">${score}</strong>
      <span class="away">${escapeHtml(match.visitante)}</span>
    </article>`;
}

// El fixture completo se conserva en state.matches para grupos y llaves,
// pero la columna principal funciona como agenda: reciente + próximos.
function getRelevantMatches(matches) {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 14);
  const to = new Date(now);
  to.setDate(to.getDate() + 35);

  const nearby = matches.filter((match) => {
    const date = new Date(match.dateIso || 0);
    return !Number.isNaN(date.getTime()) && date >= from && date <= to;
  });

  if (nearby.length) return nearby;

  // Fuera de temporada: mostramos los encuentros más cercanos a hoy en vez
  // de obligar a empezar el listado en febrero o enero.
  return [...matches]
    .filter((match) => match.dateIso)
    .sort((a, b) =>
      Math.abs(new Date(a.dateIso) - now) -
      Math.abs(new Date(b.dateIso) - now)
    )
    .slice(0, 16)
    .sort((a, b) => new Date(a.dateIso) - new Date(b.dateIso));
}

// ============================================================
// COPAS: GRUPOS Y CRUCES
// ============================================================

function isCupCompetition() {
  return [
    "arg.copa",
    "conmebol.libertadores",
    "conmebol.sudamericana",
    "uefa.champions",
    "uefa.europa",
    "uefa.europa.conf"
  ].includes(state.leagueCode);
}

function renderCupStructure() {
  if (!cupStructurePanel || !cupStructureContent) return;

  if (!isCupCompetition()) {
    cupStructurePanel.hidden = true;
    standingsPanel?.removeAttribute("hidden");
    tournamentContentGrid?.classList.remove("cup-layout");
    return;
  }

  cupStructurePanel.hidden = false;
  // Las minitablas de abajo son la tabla de grupos de la copa. Evitamos
  // repetir exactamente los mismos datos en una tabla grande lateral.
  standingsPanel?.setAttribute("hidden", "");
  tournamentContentGrid?.classList.add("cup-layout");

  const groups = (state.standingsZones || [])
    .filter((zone) => Array.isArray(zone.tabla) && zone.tabla.length);

  const stages = new Map();
  state.matches.forEach((match) => {
    const name = String(match.stage || "Partidos").trim();
    if (!stages.has(name)) stages.set(name, []);
    stages.get(name).push(match);
  });

  const groupsHtml = groups.length
    ? `
      <section>
        <h3 class="cup-section-title">Grupos</h3>
        <div class="cup-groups-grid">
          ${groups.map((group) => `
            <article class="cup-group-card">
              <h4>${escapeHtml(group.nombre)}</h4>
              <div class="table-wrap">
                <table>
                  <thead><tr><th>#</th><th>Equipo</th><th>PTS</th><th>PJ</th><th>DG</th></tr></thead>
                  <tbody>
                    ${group.tabla.map((team, index) => `
                      <tr>
                        <td>${index + 1}</td>
                        <td><span class="team"><img class="team-logo" src="${escapeAttribute(team.logo || PLACEHOLDER_LOGO)}" alt="">${escapeHtml(team.equipo)}</span></td>
                        <td class="pts">${Number(team.pts || 0)}</td>
                        <td>${Number(team.pj || 0)}</td>
                        <td>${Number(team.dg || 0) > 0 ? "+" : ""}${Number(team.dg || 0)}</td>
                      </tr>
                    `).join("")}
                  </tbody>
                </table>
              </div>
            </article>
          `).join("")}
        </div>
      </section>`
    : "";

  const sortedStages = [...stages.entries()].sort(
    ([a], [b]) => cupStageOrder(a) - cupStageOrder(b) || a.localeCompare(b, "es")
  );

  const knockoutStages = sortedStages.filter(
    ([stage]) => !["Fixture", "Fase de grupos"].includes(stage)
  );

  const stagesHtml = knockoutStages.length
    ? `
      <section${groups.length ? ' style="margin-top:1.15rem"' : ""}>
        <h3 class="cup-section-title">Cruces y fases</h3>
        <div class="cup-stage-list cup-bracket">
          ${knockoutStages.map(([stage, matches]) => `
            <article class="cup-stage cup-bracket-round">
              <h4>${escapeHtml(stage)}</h4>
              ${renderCupTies(matches)}
            </article>
          `).join("")}
        </div>
      </section>`
    : '<p class="empty">La API todavía no identificó una fase eliminatoria para armar la llave. Los grupos y el fixture siguen disponibles arriba.</p>';

  cupStructureDescription.textContent = groups.length
    ? "Tablas por grupo y cruces del fixture"
    : "Cruces disponibles en el fixture";
  cupStructureContent.innerHTML = groupsHtml + stagesHtml;
}

function renderCupTies(matches) {
  const ties = new Map();

  matches.forEach((match) => {
    const key = [normalize(match.local), normalize(match.visitante)].sort().join("|");
    if (!ties.has(key)) ties.set(key, []);
    ties.get(key).push(match);
  });

  return [...ties.values()]
    .sort((a, b) => new Date(a[0].dateIso) - new Date(b[0].dateIso))
    .map((tieMatches) => {
      const first = tieMatches[0];
      const home = first.local;
      const away = first.visitante;
      const homeTotal = tieMatches.reduce((sum, match) => sum + (match.local === home ? Number(match.gl || 0) : Number(match.gv || 0)), 0);
      const awayTotal = tieMatches.reduce((sum, match) => sum + (match.local === away ? Number(match.gl || 0) : Number(match.gv || 0)), 0);
      const isComplete = tieMatches.every((match) => match.isCompleted);

      return `
        <article class="cup-tie">
          <div><span>${escapeHtml(home)}</span><strong>${isComplete ? homeTotal : "-"}</strong></div>
          <div><span>${escapeHtml(away)}</span><strong>${isComplete ? awayTotal : "-"}</strong></div>
          <small>${tieMatches.length === 2 ? "Serie ida y vuelta" : "Partido único / pendiente"}</small>
        </article>`;
    })
    .join("");
}

function cupStageOrder(stage) {
  const name = normalize(stage);
  if (/prelim|clasific|repech/.test(name)) return 0;
  if (/grupo|group|league phase|fase liga/.test(name)) return 1;
  if (/octav|round of 16|dieciseis/.test(name)) return 2;
  if (/cuart|quarter/.test(name)) return 3;
  if (/semi/.test(name)) return 4;
  if (/final/.test(name)) return 5;
  return 6;
}

// ============================================================
// GRUPOS POR FECHA
// ============================================================

function groupMatchesByDate(
  matches
) {

  const groups =
    new Map();

  matches.forEach(
    (match) => {

      const date =
        match.dateIso
          ? new Date(
              match.dateIso
            )
          : null;

      const key =
        date
          ? date
              .toISOString()
              .slice(0, 10)
          : "sin-fecha";

      if (!groups.has(key)) {

        groups.set(
          key,
          {
            label:
              date
                ? new Intl.DateTimeFormat(
                    "es-AR",
                    {
                      weekday:
                        "long",

                      day:
                        "numeric",

                      month:
                        "long"
                    }
                  ).format(date)

                : "Fecha a confirmar",

            matches: []
          }
        );
      }

      groups
        .get(key)
        .matches
        .push(match);
    }
  );

  return [
    ...groups.values()
  ];
}

// ============================================================
// GRUPO DE PARTIDOS
// ============================================================

function renderMatchGroup(
  group
) {

  return `
    <div class="day-divider">

      <span>
        ${escapeHtml(
          group.label
        )}
      </span>

      <span>
        ${group.matches.length}
        ${
          group.matches.length === 1
            ? "partido"
            : "partidos"
        }
      </span>

    </div>

    ${group.matches
      .map(renderMatch)
      .join("")}
  `;
}

// ============================================================
// CARD PARTIDO
// ============================================================

function renderMatch(match) {

  const live =
    match.isLive;

  const final =
    match.isCompleted;

  const statusClass =
    live
      ? "live"
      : final
        ? "final"
        : "";

  const status =
    live
      ? "EN VIVO"
      : final
        ? "FINAL"
        : formatHour(
            match.dateIso
          );

  const score =
    match.gl !== null &&
    match.gv !== null
      ? `${match.gl} - ${match.gv}`
      : "vs";

  let liveClock = "";

  if (live) {

    const seconds =
      Number(
        match.second || 0
      );

    const minute =
      Number(
        match.minute || 0
      );

    liveClock =
      `${minute}:${String(
        seconds
      ).padStart(2, "0")}`;
  }

  return `
    <article
      class="match ${
        live ? "live" : ""
      }"
      data-match-id="${escapeAttribute(
        match.id
      )}"
      data-category="${escapeAttribute(
        match.category || state.category
      )}"
      data-league="${escapeAttribute(
        match.league || state.leagueCode
      )}"
      data-season="${state.season}"
      data-torneo="${escapeAttribute(
        state.torneo
      )}"
      tabindex="0"
      role="button"
      aria-label="Ver detalle de ${
        escapeHtml(match.local)
      } contra ${
        escapeHtml(match.visitante)
      }"
    >

      <div class="match-top">

        <span
          class="match-status ${statusClass}"
        >
          ${status}
        </span>

        ${
          live
            ? `
              <span class="match-time">
                ${liveClock}
              </span>
            `
            : ""
        }

      </div>

      <div class="teams">

        <div class="match-team">

          <img
            class="team-logo"
            src="${escapeAttribute(
              match.localLogo ||
              PLACEHOLDER_LOGO
            )}"
            alt=""
          >

          <span>
            ${escapeHtml(
              match.local
            )}
          </span>

        </div>

        <div class="score">
          ${score}
        </div>

        <div class="match-team away">

          <span>
            ${escapeHtml(
              match.visitante
            )}
          </span>

          <img
            class="team-logo"
            src="${escapeAttribute(
              match.visitanteLogo ||
              PLACEHOLDER_LOGO
            )}"
            alt=""
          >

        </div>

      </div>

      <div class="match-detail-hint">
        Ver detalle →
      </div>

    </article>
  `;
}

// ============================================================
// ABRIR DETAIL.JS
// ============================================================

function openMatchDetail(
  matchId,
  match = null
) {

  if (!matchId) {
    return;
  }

  const categoryValue =
    match?.category ||
    state.category ||
    "primera";

  const leagueValue =
    match?.league ||
    state.leagueCode ||
    "";

  const seasonValue =
    match?.season ||
    state.season ||
    2026;

  const torneoValue =
    match?.torneo ||
    state.torneo ||
    "clausura";

  const detailParams =
    new URLSearchParams();

  detailParams.set(
    "matchId",
    String(matchId)
  );

  detailParams.set(
    "category",
    categoryValue
  );

  if (leagueValue) {
    detailParams.set(
      "league",
      leagueValue
    );
  }

  detailParams.set(
    "season",
    String(seasonValue)
  );

  detailParams.set(
    "torneo",
    torneoValue
  );

  // IMPORTANTE:
  // NO abre ESPN.
  // Va al HTML de detalle que utiliza detail.js.
  window.location.href =
    `detail.html?${detailParams.toString()}`;
}

// ============================================================
// CLIC EN PARTIDO
// ============================================================

document.addEventListener(
  "click",
  (event) => {

    const moreButton = event.target.closest("[data-fixture-target]");
    if (moreButton) {
      const target = document.getElementById(moreButton.dataset.fixtureTarget);
      if (!target) return;
      const isOpen = target.classList.toggle("fixture-hidden");
      moreButton.textContent = isOpen ? "Ver más⌄" : "Ver menos⌃";
      return;
    }

    const card =
      event.target.closest(
        ".match[data-match-id]"
      );

    if (!card) {
      return;
    }

    openMatchDetail(
      card.dataset.matchId,
      {
        category:
          card.dataset.category,

        league:
          card.dataset.league,

        season:
          Number(
            card.dataset.season ||
            state.season
          ),

        torneo:
          card.dataset.torneo
      }
    );
  }
);

// ============================================================
// ENTER EN PARTIDO
// ============================================================

document.addEventListener(
  "keydown",
  (event) => {

    if (
      event.key !== "Enter" &&
      event.key !== " "
    ) {
      return;
    }

    const card =
      event.target.closest(
        ".match[data-match-id]"
      );

    if (!card) {
      return;
    }

    event.preventDefault();

    openMatchDetail(
      card.dataset.matchId,
      {
        category:
          card.dataset.category,

        league:
          card.dataset.league,

        season:
          Number(
            card.dataset.season ||
            state.season
          ),

        torneo:
          card.dataset.torneo
      }
    );
  }
);

// ============================================================
// HORA
// ============================================================

function formatHour(iso) {

  if (!iso) {
    return "--:--";
  }

  return new Intl.DateTimeFormat(
    "es-AR",
    {
      hour: "2-digit",
      minute: "2-digit"
    }
  ).format(
    new Date(iso)
  );
}

// ============================================================
// RELOJ DE PARTIDOS
// ============================================================

function updateLiveMatches() {

  let hasLive =
    false;

  state.matches =
    state.matches.map(
      (match) => {

        if (!match.isLive) {
          return match;
        }

        hasLive = true;

        const baseMinute =
          Number(
            match.minute || 0
          );

        const baseSecond =
          Number(
            match.second || 0
          );

        if (!match._clockStarted) {

          return {
            ...match,

            _clockStarted:
              Date.now(),

            _baseSeconds:
              baseMinute * 60 +
              baseSecond
          };
        }

        const elapsed =
          Math.floor(
            (
              Date.now() -
              match._clockStarted
            ) / 1000
          );

        const total =
          match._baseSeconds +
          elapsed;

        return {
          ...match,

          minute:
            Math.floor(
              total / 60
            ),

          second:
            total % 60
        };
      }
    );

  if (hasLive) {

    renderMatches();

    setStatus(
      "Hay partidos en vivo",
      "live"
    );
  }
}

// ============================================================
// ESCAPE HTML
// ============================================================

function escapeHtml(value) {

  return String(
    value ?? ""
  )
    .replaceAll(
      "&",
      "&amp;"
    )
    .replaceAll(
      "<",
      "&lt;"
    )
    .replaceAll(
      ">",
      "&gt;"
    )
    .replaceAll(
      '"',
      "&quot;"
    )
    .replaceAll(
      "'",
      "&#039;"
    );
}

function escapeAttribute(value) {
  return escapeHtml(value);
}

// ============================================================
// CARGA GENERAL
// ============================================================

async function loadTournament() {

  if (state.loading) {
    return;
  }

  state.loading = true;

  try {

    renderHeader();

    state.leagueCode =
      getLeagueCode();

    if (!state.leagueCode) {
      throw new Error(
        "No se encontró la competencia."
      );
    }

    setStatus(
      "Cargando torneo..."
    );

    // ======================================================
    // TABLA + PARTIDOS EN PARALELO
    // ======================================================

    const [
      _standings,
      matches
    ] =
      await Promise.all([
        loadStandings(),
        fetchTournamentMatches()
      ]);

    state.matches =
      matches;

    state.lastUpdated =
      new Date();

    renderStandings();
    renderMatches();
    renderCupStructure();

    setLastUpdate();

    const live =
      state.matches.some(
        match =>
          match.isLive
      );

    setStatus(
      live
        ? "Hay partidos en vivo"
        : `${state.matches.length} partidos cargados`,
      live
        ? "live"
        : ""
    );

  } catch (error) {

    console.error(
      "Error cargando torneo:",
      error
    );

    setStatus(
      "No se pudieron cargar los datos."
    );

    if (standingsBody) {

      standingsBody.innerHTML = `
        <tr>
          <td
            colspan="5"
            class="error"
          >
            Error cargando la tabla.
          </td>
        </tr>
      `;
    }

    if (matchesContainer) {

      matchesContainer.innerHTML = `
        <div class="error">
          Error cargando los partidos.
        </div>
      `;
    }

  } finally {

    state.loading =
      false;
  }
}

// ============================================================
// BUSCADOR
// ============================================================

searchEl?.addEventListener(
  "input",
  (event) => {

    state.search =
      event.target.value;

    renderStandings();
    renderMatches();
  }
);

// ============================================================
// VOLVER
// ============================================================

backButton?.addEventListener(
  "click",
  () => {

    if (
      window.history.length > 1
    ) {

      window.history.back();

      return;
    }

    window.location.href =
      "./index.html";
  }
);

// ============================================================
// ACTUALIZACIÓN DE PARTIDOS EN VIVO
// ============================================================

setInterval(
  async () => {

    const hasLive =
      state.matches.some(
        match =>
          match.isLive
      );

    if (!hasLive) {
      return;
    }

    try {

      const matches =
        await fetchTournamentMatches();

      state.matches =
        matches;

      state.lastUpdated =
        new Date();

      renderMatches();
      setLastUpdate();

    } catch (error) {

      console.error(
        "Error actualizando torneo:",
        error
      );
    }

  },
  15000
);

// ============================================================
// RELOJ LOCAL
// ============================================================

setInterval(
  updateLiveMatches,
  1000
);

// ============================================================
// INICIO
// ============================================================

loadTournament();
