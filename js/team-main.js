import { state } from "./state.js";
import { normalize, noCacheFetch, fmtDateLong } from "./utils.js";
import { API, PLACEHOLDER_LOGO } from "./config.js";
import { fetchStandingsSafe } from "./season-types.js";

// Helper de fetch robusto contra CORS
async function safeFetchJson(url) {
  try {
    const res = await fetch(url, { method: "GET" });
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn(`Fetch directo bloqueado por CORS (${url}), probando proxy...`);
  }

  const proxies = [
    (u) => `https://corsproxy.io/?${encodeURIComponent(u)}`,
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`
  ];

  for (const getProxyUrl of proxies) {
    try {
      const proxyUrl = getProxyUrl(url);
      const res = await fetch(proxyUrl);
      if (res.ok) {
        const text = await res.text();
        return JSON.parse(text);
      }
    } catch (e) {
      console.warn("Falló proxy, probando el siguiente...", e);
    }
  }

  throw new Error(`No se pudieron obtener datos de ${url}`);
}

function getEspnLeagueCode(category, leagueParam = "") {
  if (category === "espn" && leagueParam) return leagueParam;
  return category === "nacional" || category === "b_nacional" ? "arg.2" : "arg.1";
}

function isAscensoCategory(category) {
  return category === "nacional" || category === "b_nacional";
}

function cleanTeamSearchName(str) {
  if (!str) return "";
  let cleaned = normalize(str)
    .replace(/\(.*?\)/g, "")
    .replace(/^c\.\s*/, "central ")
    .replace(/^atl\.\s*/, "atletico ")
    .replace(/^dep\.\s*/, "deportivo ")
    .replace(/^g\.\s*/, "gimnasia ")
    .replace(/^c\.a\.\s*/, "")
    .trim();

  const aliasMap = {
    "tristan suarez": "tristan",
    "chacarita jrs": "chacarita",
    "defensores de belgrano": "defensores",
    "estudiantes rc": "rio cuarto",
    "estudiantes ba": "caseros",
    "gimnasia m": "mendoza",
    "gimnasia j": "jujuy",
    "agropecuario": "agropecuario"
  };

  return aliasMap[cleaned] || cleaned;
}

function getTeamLogoUrl(team) {
  if (team?.logos?.[0]?.href) return team.logos[0].href;
  if (team?.logo) return team.logo;
  if (team?.id) return `https://a.espncdn.com/i/teamlogos/soccer/500/${team.id}.png`;
  return PLACEHOLDER_LOGO;
}

function translatePosition(posRaw) {
  if (!posRaw) return "Jugador";
  const pos = String(posRaw).toUpperCase().trim();
  const map = {
    "GOALKEEPER": "Arquero", "GK": "Arquero",
    "DEFENDER": "Defensor", "CENTER BACK": "Defensor Central", "CENTRAL DEFENDER": "Defensor Central",
    "LEFT BACK": "Lateral Izquierdo", "RIGHT BACK": "Lateral Derecho", "FULL BACK": "Lateral",
    "MIDFIELDER": "Mediocampista", "CENTRAL MIDFIELDER": "Volante Central",
    "DEFENSIVE MIDFIELDER": "Volante de Contención", "ATTACKING MIDFIELDER": "Volante Ofensivo",
    "LEFT MIDFIELDER": "Volante Izquierdo", "RIGHT MIDFIELDER": "Volante Derecho",
    "FORWARD": "Delantero", "STRIKER": "Delantero Centro", "CENTRE FORWARD": "Centrodelantero",
    "WING": "Extremo", "LEFT WING": "Extremo Izquierdo", "RIGHT WING": "Extremo Derecho"
  };
  return map[pos] || posRaw;
}
// En team-main.js:

function setupBackButton() {
  const params = new URLSearchParams(window.location.search);
  const category = params.get("category") || "primera";
  const league = params.get("league") || "";
  const season = params.get("season") || "2026";
  const torneo = params.get("torneo") || "clausura";

  // Buscamos el botón o enlace de regresar en la plantilla
  const backBtn = document.querySelector("#back-btn, .back-btn, .btn-back, a[href='index.html']");

  if (backBtn) {
    // Si la navegación permite volver en el historial directamente:
    backBtn.addEventListener("click", (e) => {
      e.preventDefault();
      
      if (document.referrer && document.referrer.includes(window.location.host)) {
        window.history.back();
      } else {
        // Fallback construyendo la URL exacta de retorno
        const returnParams = new URLSearchParams({
          category,
          league,
          season,
          torneo
        });
        window.location.href = `index.html?${returnParams.toString()}`;
      }
    });
  }
}

// Llamar a setupBackButton() dentro de DOMContentLoaded o en initTeamPage()
document.addEventListener("DOMContentLoaded", () => {
  setupBackButton();
  initTeamPage();
});
async function initTeamPage() {
  const params = new URLSearchParams(window.location.search);
  const teamParam = params.get("team");
  state.category = params.get("category") || "primera";
  const leagueParam = params.get("league") || "";
  state.season = Number(params.get("season")) || 2026;
  state.torneo = params.get("torneo") || "clausura";

  const heroRoot = document.querySelector("#team-hero-content");
  const tabContent = document.querySelector("#team-tab-content");

  if (!teamParam) {
    if (heroRoot) heroRoot.innerHTML = '<p class="detail-empty">No se indicó ningún equipo.</p>';
    return;
  }

  const normTeam = cleanTeamSearchName(teamParam);
  const isEspn = state.category === "espn";
  const leagueCode = getEspnLeagueCode(state.category, leagueParam);

  let teamId = null;
  let teamOfficialName = teamParam;
  let teamLogo = PLACEHOLDER_LOGO;
  let teamMatches = [];

  try {
    // 1. Petición del Scoreboard (Busca partidos e ID igual que en Argentina)
    const scoreUrl = isEspn
      ? `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/scoreboard`
      : `${(API[state.category] || API.primera).scoreboard}?dates=${state.season}0101-${state.season}1231`;

    try {
      const scoreData = isEspn ? await safeFetchJson(scoreUrl) : await (await noCacheFetch(scoreUrl)).json();

      for (const e of (scoreData.events || [])) {
        const comps = e.competitions?.[0]?.competitors || [];
        const found = comps.find((c) => {
          const disp = cleanTeamSearchName(c.team?.displayName);
          const short = cleanTeamSearchName(c.team?.shortDisplayName);
          const name = cleanTeamSearchName(c.team?.name);
          return disp.includes(normTeam) || normTeam.includes(disp) ||
                 short.includes(normTeam) || normTeam.includes(short) ||
                 name.includes(normTeam) || normTeam.includes(name);
        });

        if (found) {
          teamId = found.team?.id;
          teamOfficialName = found.team?.displayName || found.team?.name || teamParam;
          teamLogo = getTeamLogoUrl(found.team);
          break;
        }
      }

      if (scoreData.events) {
        teamMatches = parseEventsToMatches(scoreData.events, teamId, normTeam);
      }
    } catch (e) {
      console.warn("Scoreboard falló:", e);
    }

    // 2. Fallback por schedule si tenemos ID de club
    if (teamId && !teamMatches.length) {
      try {
        const scheduleUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/teams/${teamId}/schedule`;
        const schedData = await safeFetchJson(scheduleUrl);
        teamMatches = parseEventsToMatches(schedData.events || [], teamId);
      } catch (e) {
        console.warn("Schedule específico no disponible:", e);
      }
    }

    teamMatches.sort((a, b) => new Date(b.dateIso) - new Date(a.dateIso));

    const leagueLabel = isEspn ? leagueParam.toUpperCase() : state.category.toUpperCase();
    renderHero(heroRoot, teamOfficialName, teamLogo, leagueLabel, teamMatches.length);
    renderMatchesTab(tabContent, teamMatches);

    // Listeners de Pestañas
    document.querySelectorAll(".team-tab-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        document.querySelectorAll(".team-tab-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        const tab = btn.dataset.tab;
        if (tab === "matches") {
          renderMatchesTab(tabContent, teamMatches);
        } else if (tab === "standings") {
          await renderStandingsTab(tabContent, normTeam, leagueCode);
        } else if (tab === "squad") {
          await renderSquadTab(tabContent, teamId, leagueCode);
        }
      });
    });

  } catch (e) {
    console.error("Error crítico:", e);
    if (heroRoot) heroRoot.innerHTML = `<p class="detail-empty">Error al cargar datos del club.</p>`;
  }
}

function parseEventsToMatches(events, teamId, normTeam = "") {
  return events.map((e) => {
    const comp = e.competitions?.[0];
    if (!comp?.competitors) return null;

    const home = comp.competitors.find((c) => c.homeAway === "home") || comp.competitors[0];
    const away = comp.competitors.find((c) => c.homeAway === "away") || comp.competitors[1];

    const homeClean = cleanTeamSearchName(home.team?.displayName || home.team?.name);
    const awayClean = cleanTeamSearchName(away.team?.displayName || away.team?.name);

    let isHome = false;
    if (teamId) {
      isHome = String(home.team?.id) === String(teamId);
    } else if (normTeam) {
      isHome = homeClean.includes(normTeam) || normTeam.includes(homeClean);
      if (!isHome && !awayClean.includes(normTeam) && !normTeam.includes(awayClean)) return null;
    }

    const isCompleted = comp.status?.type?.state === "post";
    const homeScore = Number(home.score?.displayValue ?? home.score ?? 0);
    const awayScore = Number(away.score?.displayValue ?? away.score ?? 0);

    let outcome = "scheduled";
    if (isCompleted) {
      if (homeScore === awayScore) {
        outcome = "draw";
      } else if ((isHome && homeScore > awayScore) || (!isHome && awayScore > homeScore)) {
        outcome = "win";
      } else {
        outcome = "loss";
      }
    }

    return {
      id: comp.id || e.id,
      dateIso: comp.date || e.date,
      dateFormatted: fmtDateLong(comp.date || e.date),
      homeName: home.team?.shortDisplayName || home.team?.displayName || "Local",
      homeLogo: getTeamLogoUrl(home.team),
      homeScore,
      awayName: away.team?.shortDisplayName || away.team?.displayName || "Visitante",
      awayLogo: getTeamLogoUrl(away.team),
      awayScore,
      isCompleted,
      outcome,
      statusText: comp.status?.type?.description || "Programado"
    };
  }).filter(Boolean);
}

function renderHero(container, name, logo, leagueLabel, matchCount) {
  container.innerHTML = `
    <div class="team-profile-header">
      <img class="team-profile-logo" src="${logo}" alt="" />
      <div class="team-profile-info">
        <h2>${name}</h2>
        <div class="team-profile-meta">
          <span>LIGA: ${leagueLabel}</span>
          <span>PARTIDOS REGISTRADOS: ${matchCount}</span>
        </div>
      </div>
    </div>
  `;
}

function renderMatchesTab(container, matches) {
  if (!matches.length) {
    container.innerHTML = '<p class="detail-empty">Sin partidos registrados actualmente.</p>';
    return;
  }

  const groups = matches.reduce((acc, match) => {
    const key = match.dateFormatted || "FECHA PENDIENTE";
    if (!acc[key]) acc[key] = [];
    acc[key].push(match);
    return acc;
  }, {});

  const html = Object.entries(groups).map(([dateLabel, items]) => `
    <div class="team-date-group">
      <div class="team-date-header">${dateLabel}</div>
      <div class="team-matches-list">
        ${items.map((m) => `
          <div class="team-match-card" data-match-id="${m.id}">
            <div class="team-match-teams">
              <span class="team-with-logo">
                <img class="team-logo" src="${m.homeLogo}" alt="" />
                <span>${m.homeName}</span>
              </span>
              <span class="vs">vs</span>
              <span class="team-with-logo">
                <img class="team-logo" src="${m.awayLogo}" alt="" />
                <span>${m.awayName}</span>
              </span>
            </div>
            <div class="team-match-status">
              ${m.isCompleted 
                ? `<span class="team-match-score outcome-${m.outcome}">${m.homeScore} - ${m.awayScore}</span>`
                : `<span class="team-match-badge">${m.statusText}</span>`
              }
            </div>
          </div>
        `).join("")}
      </div>
    </div>
  `).join("");

  container.innerHTML = `<div class="team-fixture-container">${html}</div>`;

  container.querySelectorAll(".team-match-card[data-match-id]").forEach((card) => {
    card.addEventListener("click", () => {
      const matchId = card.dataset.matchId;
      if (!matchId) return;

      const params = new URLSearchParams({
        matchId: String(matchId),
        category: state.category,
        season: String(state.season),
        torneo: state.torneo
      });

      window.location.href = `detail.html?${params.toString()}`;
    });
  });
}

// ----------------------------------------------------
// TABLAS DE POSICIONES
// ----------------------------------------------------
// ----------------------------------------------------
// TABLAS DE POSICIONES (AFA PRIMERA / B NACIONAL / ESPN)
// ----------------------------------------------------
async function renderStandingsTab(container, normTeam, leagueCode) {
  // 1. LIGAS ESPN / COPA ARGENTINA / INTERNACIONAL
  if (state.category === "espn") {
    container.innerHTML = `<div id="team-standings-box"><p class="detail-loading">Cargando posiciones...</p></div>`;
    const tableBox = container.querySelector("#team-standings-box");

    try {
      const data = await safeFetchJson(`https://site.api.espn.com/apis/v2/sports/soccer/${leagueCode}/standings`);
      const standingsGroup = data.children?.[0]?.standings || data.standings?.[0] || [];
      const entries = standingsGroup.entries || [];

      if (!entries.length) {
        tableBox.innerHTML = '<p class="detail-empty">Tabla de posiciones no disponible.</p>';
        return;
      }

      const rows = entries.map((item, idx) => {
        const teamClean = cleanTeamSearchName(item.team?.displayName || item.team?.name);
        const isTarget = teamClean.includes(normTeam) || normTeam.includes(teamClean);
        const stats = item.stats || [];
        const getStat = (n) => stats.find(s => s.name === n)?.value ?? 0;

        return `
          <tr class="${isTarget ? 'highlight-row' : ''}">
            <td class="col-pos">${idx + 1}</td>
            <td class="col-team">
              ${item.team?.logos?.[0]?.href ? `<img class="team-mini-logo" src="${item.team.logos[0].href}" alt="" />` : ''}
              <strong>${item.team?.shortDisplayName || item.team?.displayName}</strong>
            </td>
            <td class="col-pts"><strong>${getStat("points")}</strong></td>
            <td>${getStat("gamesPlayed")}</td>
            <td>${getStat("wins")}</td>
            <td>${getStat("ties")}</td>
            <td>${getStat("losses")}</td>
            <td>${getStat("pointsFor")}</td>
            <td>${getStat("pointsAgainst")}</td>
            <td class="col-dg">${getStat("pointDifferential")}</td>
          </tr>
        `;
      }).join("");

      tableBox.innerHTML = `
        <div class="table-responsive">
          <table class="team-standings-table">
            <thead>
              <tr>
                <th class="col-pos">#</th>
                <th class="col-team">EQUIPO</th>
                <th class="col-pts">PTS</th>
                <th>PJ</th>
                <th>PG</th>
                <th>PE</th>
                <th>PP</th>
                <th>GF</th>
                <th>GC</th>
                <th class="col-dg">DG</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;
    } catch (err) {
      console.error(err);
      tableBox.innerHTML = '<p class="detail-empty">Error al cargar la tabla de posiciones.</p>';
    }
    return;
  }

  // 2. FÚTBOL ARGENTINO (AFA)
  const isB = isAscensoCategory(state.category) || state.category === "segunda";

  const loadAfaTable = async (torneoKey) => {
    const tableBox = container.querySelector("#team-standings-box");
    if (tableBox) tableBox.innerHTML = '<p class="detail-loading">Cargando posiciones de Argentina...</p>';

    try {
      // Sincronizamos la categoría nativa
      const categoryToFetch = (state.category === "segunda" || state.category === "b_nacional") ? "segunda" : "primera";
      const data = await fetchStandingsSafe(categoryToFetch, state.season, torneoKey);
      const zonas = data?.zonas || [];

      if (!zonas.length) {
        if (tableBox) tableBox.innerHTML = '<p class="detail-empty">Tabla de posiciones no disponible.</p>';
        return;
      }

      // Buscar la zona donde juega este club
      let targetZone = zonas.find((z) =>
        (z.tabla || []).some((r) => cleanTeamSearchName(r.equipo).includes(normTeam))
      ) || zonas[0];

      const rows = (targetZone.tabla || []).map((r, i) => {
        const teamClean = cleanTeamSearchName(r.equipo);
        const isTarget = teamClean.includes(normTeam) || normTeam.includes(teamClean);
        const pos = i + 1;
        const isQualified = pos <= 8;

        return `
          <tr class="${isTarget ? 'highlight-row' : ''} ${isQualified ? 'qualified-row' : ''}">
            <td class="col-pos">${pos}</td>
            <td class="col-team">
              ${r.logo ? `<img class="team-mini-logo" src="${r.logo}" alt="" />` : ''}
              <strong>${r.equipo}</strong>
            </td>
            <td class="col-pts"><strong>${r.pts}</strong></td>
            <td>${r.pj}</td>
            <td>${r.pg ?? (r.v ?? 0)}</td>
            <td>${r.pe ?? (r.e ?? 0)}</td>
            <td>${r.pp ?? (r.d ?? 0)}</td>
            <td>${r.gf ?? 0}</td>
            <td>${r.gc ?? 0}</td>
            <td class="col-dg">${r.dg > 0 ? `+${r.dg}` : r.dg}</td>
          </tr>
        `;
      }).join("");

      if (tableBox) {
        tableBox.innerHTML = `
          <div class="zone-header">
            <span class="zone-title-badge">${targetZone.nombre || "Posiciones"}</span>
          </div>
          <div class="table-responsive">
            <table class="team-standings-table">
              <thead>
                <tr>
                  <th class="col-pos">#</th>
                  <th class="col-team">EQUIPO</th>
                  <th class="col-pts">PTS</th>
                  <th>PJ</th>
                  <th>PG</th>
                  <th>PE</th>
                  <th>PP</th>
                  <th>GF</th>
                  <th>GC</th>
                  <th class="col-dg">DG</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        `;
      }
    } catch (e) {
      console.error("Error al cargar la tabla de AFA:", e);
      const tableBox = container.querySelector("#team-standings-box");
      if (tableBox) tableBox.innerHTML = '<p class="detail-empty">Error al cargar la tabla de posiciones.</p>';
    }
  };

  if (isB) {
    // La Primera Nacional (B) usa tabla Anual / General
    container.innerHTML = `<div id="team-standings-box"></div>`;
    await loadAfaTable("anual");
  } else {
    // Primera División tiene selector Apertura / Clausura
    let activeTorneo = state.torneo || "clausura";
    container.innerHTML = `
      <div class="torneo-selector-bar">
        <button class="torneo-sub-btn ${activeTorneo === 'apertura' ? 'active' : ''}" data-torneo="apertura">Apertura ${state.season}</button>
        <button class="torneo-sub-btn ${activeTorneo === 'clausura' ? 'active' : ''}" data-torneo="clausura">Clausura ${state.season}</button>
      </div>
      <div id="team-standings-box"></div>
    `;

    container.querySelectorAll(".torneo-sub-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        container.querySelectorAll(".torneo-sub-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        state.torneo = btn.dataset.torneo;
        loadAfaTable(btn.dataset.torneo);
      });
    });

    await loadAfaTable(activeTorneo);
  }
}

// ----------------------------------------------------
// PLANTEL
// ----------------------------------------------------
async function renderSquadTab(container, teamId, leagueCode = "arg.1") {
  if (!teamId) {
    container.innerHTML = '<p class="detail-empty">Identificador de equipo no disponible para cargar el plantel.</p>';
    return;
  }

  container.innerHTML = '<p class="detail-loading">Cargando plantel del club...</p>';

  try {
    const rosterUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/teams/${teamId}/roster`;
    const rosterData = await safeFetchJson(rosterUrl);

    let athletes = rosterData?.athletes || [];

    if (!athletes.length) {
      container.innerHTML = '<p class="detail-empty">Plantel oficial no disponible actualmente.</p>';
      return;
    }

    const cardsHtml = athletes.map((p) => {
      const rawPos = p.position?.displayName || p.position?.name || p.position?.abbreviation || p.position || "";
      const posEs = translatePosition(rawPos);

      return `
        <div class="squad-card">
          <span class="squad-jersey">${p.jersey || "•"}</span>
          <div class="squad-details">
            <span class="squad-name">${p.displayName || p.fullName}</span>
            <span class="squad-position">${posEs}</span>
          </div>
        </div>
      `;
    }).join("");

    container.innerHTML = `<div class="squad-grid">${cardsHtml}</div>`;

  } catch (e) {
    container.innerHTML = '<p class="detail-empty">Error al cargar el plantel.</p>';
  }
}

document.addEventListener("DOMContentLoaded", initTeamPage);