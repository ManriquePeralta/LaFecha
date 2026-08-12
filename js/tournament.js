import {
  API,
  LEAGUE_CODE,
  PLACEHOLDER_LOGO,
  SPLIT_SEASON_MIN_YEAR
} from "./config.js";

import {
  fetchStandingsSafe,
  discoverSeasonTypes,
  summaryUrl
} from "./season-types.js";

import {
  normalize,
  noCacheFetch
} from "./utils.js";


// ============================================================
// PARÁMETROS
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
// ESTADO LOCAL
// ============================================================

const state = {
  category,
  season,
  torneo,
  leagueCode: "",
  standings: [],
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


// ============================================================
// CONFIGURACIÓN DE LIGA
// ============================================================

function getLeagueCode() {

  if (isEspnLeague) {
    return espnLeagueCode;
  }

  return LEAGUE_CODE[category] || "";
}


// ============================================================
// NOMBRE DEL TORNEO
// ============================================================

function tournamentName() {

  if (isEspnLeague) {
    return "Competencia";
  }

  if (category === "segunda") {
    return "Primera Nacional";
  }

  if (season >= SPLIT_SEASON_MIN_YEAR) {
    return torneo === "clausura"
      ? "Clausura"
      : "Apertura";
  }

  return "Primera División";
}


// ============================================================
// TITULO
// ============================================================

function renderHeader() {

  const competition =
    isEspnLeague
      ? "ESPN"
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

  statusTextEl.textContent = text;

  const bar =
    document.querySelector("#status-bar");

  bar.classList.toggle(
    "live",
    type === "live"
  );

}


function setLastUpdate() {

  if (!state.lastUpdated) {
    lastUpdateEl.textContent = "";
    return;
  }

  lastUpdateEl.textContent =
    `Actualizado ${
      new Intl.DateTimeFormat("es-AR", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit"
      }).format(state.lastUpdated)
    }`;

}


// ============================================================
// FETCH SCOREBOARD
// ============================================================

function scoreboardUrl(
  leagueCode,
  from,
  to
) {

  const url =
    `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/scoreboard`;

  const params = new URLSearchParams();

  params.set(
    "dates",
    `${from}-${to}`
  );

  params.set(
    "limit",
    "1000"
  );

  return `${url}?${params.toString()}`;
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

  /*
   * Apertura:
   * enero -> junio
   *
   * Clausura:
   * julio -> diciembre
   */

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

  return {
    from: `${season}0101`,
    to: `${season}1231`
  };
}


// ============================================================
// OBTENER PARTIDOS
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

  /*
   * ESPN puede limitar respuestas muy grandes.
   * Dividimos el año en bloques mensuales.
   */

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

      if (!match.id) {
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
        new Date(a.dateIso || 0)
          .getTime();

      const db =
        new Date(b.dateIso || 0)
          .getTime();

      return da - db;
    });
}


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
// PARSE DE PARTIDOS ESPN
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
        (team) =>
          team.homeAway === "home"
      );

    const away =
      competitors.find(
        (team) =>
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
        type.state === "in"
        ||
        stateName === "IN"
        ||
        stateName === "IN_PROGRESS"
        ||
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

    const minute =
      status?.clock != null
        ? Math.floor(
            Number(status.clock) / 60
          )
        : null;

    const second =
      status?.clock != null
        ? Math.floor(
            Number(status.clock) % 60
          )
        : 0;

    return {

      id:
        event.id ||
        competition?.id ||
        crypto.randomUUID(),

      local:
        home?.team?.displayName ||
        home?.team?.shortDisplayName ||
        "Local",

      visitante:
        away?.team?.displayName ||
        away?.team?.shortDisplayName ||
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

      summary:
        event.id
          ? summaryUrl(
              state.category === "segunda"
                ? "segunda"
                : "primera",
              event.id
            )
          : null
    };
  });
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
// TABLA
// ============================================================

async function loadStandings() {

  if (isEspnLeague) {

    /*
     * Para una competencia ESPN externa:
     * usamos directamente el endpoint de standings.
     */

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

    state.standings =
      parseGenericStandings(json);

    return;
  }

  const result =
    await fetchStandingsSafe(
      category,
      season,
      torneo
    );

  state.standings =
    result?.tabla || [];
}


// ============================================================
// PARSE STANDINGS ESPN GENÉRICO
// ============================================================

function parseGenericStandings(json) {

  const groups =
    json?.children ||
    json?.standings?.children ||
    [];

  const firstGroup =
    groups[0];

  const entries =
    firstGroup?.standings?.entries ||
    json?.standings?.entries ||
    [];

  return entries.map((entry) => {

    const stats =
      entry.stats || [];

    const stat =
      (name, fallback = 0) => {

        const found =
          stats.find(
            (item) =>
              item.name === name ||
              item.abbreviation === name
          );

        return Number(
          found?.value ?? fallback
        );
      };

    return {

      equipo:
        entry.team?.displayName ||
        entry.team?.name ||
        "Equipo",

      logo:
        entry.team?.logos?.[0]?.href ||
        entry.team?.logo ||
        PLACEHOLDER_LOGO,

      pts:
        stat("points"),

      pj:
        stat("gamesPlayed"),

      dg:
        stat("pointDifferential")
    };
  });
}


// ============================================================
// RENDER TABLA
// ============================================================

function renderStandings() {

  const needle =
    normalize(state.search);

  const rows =
    state.standings.filter((team) => {

      if (!needle) {
        return true;
      }

      return normalize(
        team.equipo
      ).includes(needle);
    });

  if (!rows.length) {

    standingsBody.innerHTML = `
      <tr>
        <td colspan="5" class="empty">
          No hay equipos para mostrar.
        </td>
      </tr>
    `;

    return;
  }

  standingsBody.innerHTML =
    rows.map((team, index) => {

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
                src="${team.logo || PLACEHOLDER_LOGO}"
                alt=""
              >

              <strong>
                ${escapeHtml(team.equipo)}
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
            ${dg > 0 ? "+" : ""}${dg}
          </td>

        </tr>
      `;

    }).join("");
}


// ============================================================
// RENDER PARTIDOS
// ============================================================

function renderMatches() {

  const needle =
    normalize(state.search);

  const filtered =
    state.matches.filter((match) => {

      if (!needle) {
        return true;
      }

      return (
        normalize(match.local)
          .includes(needle) ||
        normalize(match.visitante)
          .includes(needle)
      );

    });

  state.filteredMatches =
    filtered;

  if (!filtered.length) {

    matchesContainer.innerHTML = `
      <div class="empty">
        No hay partidos para este torneo.
      </div>
    `;

    return;
  }

  const groups =
    groupMatchesByDate(filtered);

  matchesContainer.innerHTML =
    groups.map((group) => {

      return `
        <div class="day-divider">

          <span>
            ${escapeHtml(group.label)}
          </span>

          <span>
            ${group.matches.length}
            ${group.matches.length === 1
              ? "partido"
              : "partidos"}
          </span>

        </div>

        ${group.matches
          .map(renderMatch)
          .join("")}
      `;

    }).join("");
}


// ============================================================
// AGRUPAR PARTIDOS
// ============================================================

function groupMatchesByDate(matches) {

  const groups =
    new Map();

  matches.forEach((match) => {

    const date =
      match.dateIso
        ? new Date(match.dateIso)
        : null;

    const key =
      date
        ? date.toISOString()
            .slice(0, 10)
        : "sin-fecha";

    if (!groups.has(key)) {

      groups.set(key, {
        label:
          date
            ? new Intl.DateTimeFormat(
                "es-AR",
                {
                  weekday: "long",
                  day: "numeric",
                  month: "long"
                }
              ).format(date)
            : "Fecha a confirmar",

        matches: []
      });

    }

    groups
      .get(key)
      .matches
      .push(match);

  });

  return [...groups.values()];
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
        : formatHour(match.dateIso);

  const score =
    match.gl !== null &&
    match.gv !== null
      ? `${match.gl} - ${match.gv}`
      : "vs";

  let liveClock = "";

  if (live) {

    const seconds =
      Number(match.second || 0);

    const minute =
      Number(match.minute || 0);

    liveClock =
      `${minute}:${String(seconds)
        .padStart(2, "0")}`;
  }

  const summary =
    match.summary
      ? `
        <a
          class="summary-link"
          href="${match.summary}"
          target="_blank"
          rel="noopener noreferrer"
        >
          Ver resumen →
        </a>
      `
      : "";

  return `
    <article
      class="match ${live ? "live" : ""}"
      data-match-id="${match.id}"
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
            src="${match.localLogo || PLACEHOLDER_LOGO}"
            alt=""
          >

          <span>
            ${escapeHtml(match.local)}
          </span>

        </div>

        <div class="score">
          ${score}
        </div>

        <div class="match-team away">

          <span>
            ${escapeHtml(match.visitante)}
          </span>

          <img
            class="team-logo"
            src="${match.visitanteLogo || PLACEHOLDER_LOGO}"
            alt=""
          >

        </div>

      </div>

      ${summary}

    </article>
  `;
}


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
    state.matches.map((match) => {

      if (!match.isLive) {
        return match;
      }

      hasLive = true;

      const baseMinute =
        Number(match.minute || 0);

      const baseSecond =
        Number(match.second || 0);

      if (!match._clockStarted) {

        return {
          ...match,
          _clockStarted: Date.now(),
          _baseSeconds:
            baseMinute * 60 +
            baseSecond
        };

      }

      const elapsed =
        Math.floor(
          (Date.now() -
            match._clockStarted) /
          1000
        );

      const total =
        match._baseSeconds +
        elapsed;

      return {
        ...match,

        minute:
          Math.floor(total / 60),

        second:
          total % 60
      };

    });

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

  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
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

    /*
     * Tabla y partidos se cargan en paralelo.
     */

    const [
      ,
      matches
    ] = await Promise.all([

      loadStandings(),

      fetchTournamentMatches()

    ]);

    state.matches =
      matches;

    state.lastUpdated =
      new Date();

    renderStandings();
    renderMatches();

    setLastUpdate();

    const live =
      state.matches.some(
        (match) => match.isLive
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

    standingsBody.innerHTML = `
      <tr>
        <td colspan="5" class="error">
          Error cargando la tabla.
        </td>
      </tr>
    `;

    matchesContainer.innerHTML = `
      <div class="error">
        Error cargando los partidos.
      </div>
    `;

  } finally {

    state.loading = false;

  }
}


// ============================================================
// EVENTOS
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
// POLLING
// ============================================================

setInterval(
  async () => {

    const hasLive =
      state.matches.some(
        (match) => match.isLive
      );

    /*
     * Si hay un partido en vivo,
     * actualizamos datos de ESPN.
     */

    if (hasLive) {

      try {

        const matches =
          await fetchTournamentMatches();

        state.matches =
          matches;

        renderMatches();

        state.lastUpdated =
          new Date();

        setLastUpdate();

      } catch (error) {

        console.error(
          "Error actualizando torneo:",
          error
        );

      }

      return;
    }

    /*
     * Sin partidos en vivo no hace falta
     * pegarle a ESPN constantemente.
     */

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