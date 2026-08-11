import { state } from "./state.js";
import { normalize, noCacheFetch, fmtDateLong } from "./utils.js";
import { API, PLACEHOLDER_LOGO } from "./config.js";
import { fetchStandingsSafe } from "./season-types.js";

function getEspnLeagueCode(category) {
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

async function initTeamPage() {
  const params = new URLSearchParams(window.location.search);
  const teamParam = params.get("team");
  state.category = params.get("category") || "primera";
  state.season = Number(params.get("season")) || 2026;
  state.torneo = params.get("torneo") || "clausura";

  const heroRoot = document.querySelector("#team-hero-content");
  const tabContent = document.querySelector("#team-tab-content");

  if (!teamParam) {
    if (heroRoot) heroRoot.innerHTML = '<p class="detail-empty">No se indicó ningún equipo.</p>';
    return;
  }

  const normTeam = cleanTeamSearchName(teamParam);
  const leagueCode = getEspnLeagueCode(state.category);

  let teamId = null;
  let teamOfficialName = teamParam;
  let teamLogo = PLACEHOLDER_LOGO;

  try {
    // 1. Petición inicial para obtener ID del club
    const baseApiObj = API[state.category] || API.primera;
    const scoreUrl = `${baseApiObj.scoreboard}?dates=${state.season}0101-${state.season}1231`;
    let scoreData = { events: [] };

    try {
      const scoreRes = await noCacheFetch(scoreUrl);
      scoreData = await scoreRes.json();

      for (const e of (scoreData.events || [])) {
        const comps = e.competitions?.[0]?.competitors || [];
        const found = comps.find((c) => {
          const disp = cleanTeamSearchName(c.team?.displayName);
          const short = cleanTeamSearchName(c.team?.shortDisplayName);
          return disp.includes(normTeam) || normTeam.includes(disp) ||
                 short.includes(normTeam) || normTeam.includes(short);
        });

        if (found) {
          teamId = found.team.id;
          teamOfficialName = found.team.displayName || teamParam;
          teamLogo = getTeamLogoUrl(found.team);
          break;
        }
      }
    } catch (e) {
      console.warn("Scoreboard general no respondió", e);
    }

    // Fallback de ID para B Nacional
    if (!teamId) {
      const teamsUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/teams`;
      try {
        const teamsRes = await noCacheFetch(teamsUrl);
        const teamsData = await teamsRes.json();
        const allTeams = teamsData?.sports?.[0]?.leagues?.[0]?.teams || [];

        const matchedTeam = allTeams.find((item) => {
          const t = item.team;
          const disp = cleanTeamSearchName(t?.displayName);
          const name = cleanTeamSearchName(t?.name);
          return disp.includes(normTeam) || normTeam.includes(disp) || name.includes(normTeam);
        })?.team;

        if (matchedTeam) {
          teamId = matchedTeam.id;
          teamOfficialName = matchedTeam.displayName || teamParam;
          teamLogo = getTeamLogoUrl(matchedTeam);
        }
      } catch (err) {
        console.warn("No se pudo obtener lista estática de equipos", err);
      }
    }

    // 2. Traer partidos (Schedule + Fallback por Scoreboard)
    let teamMatches = [];

    if (teamId) {
      try {
        const scheduleUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/teams/${teamId}/schedule?season=${state.season}`;
        const schedRes = await noCacheFetch(scheduleUrl);
        const schedData = await schedRes.json();

        teamMatches = parseEventsToMatches(schedData.events || [], teamId);
      } catch (e) {
        console.warn("Schedule falló, buscando en scoreboard...", e);
      }
    }

    // Si el schedule de la B vino vacío, rastreamos en los eventos del scoreboard global
    if (!teamMatches.length && scoreData.events) {
      teamMatches = parseEventsToMatches(scoreData.events, teamId, normTeam);
    }

    teamMatches.sort((a, b) => new Date(b.dateIso) - new Date(a.dateIso));

    renderHero(heroRoot, teamOfficialName, teamLogo, teamMatches.length);
    renderMatchesTab(tabContent, teamMatches);

    // Listeners Pestañas
    document.querySelectorAll(".team-tab-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        document.querySelectorAll(".team-tab-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");

        const tab = btn.dataset.tab;
        if (tab === "matches") {
          renderMatchesTab(tabContent, teamMatches);
        } else if (tab === "standings") {
          await renderStandingsTab(tabContent, normTeam);
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

// Helper para procesar partidos en formato unificado
function parseEventsToMatches(events, teamId, normTeam = "") {
  return events.map((e) => {
    const comp = e.competitions?.[0];
    if (!comp?.competitors) return null;

    const home = comp.competitors.find((c) => c.homeAway === "home") || comp.competitors[0];
    const away = comp.competitors.find((c) => c.homeAway === "away") || comp.competitors[1];

    const homeClean = cleanTeamSearchName(home.team?.displayName);
    const awayClean = cleanTeamSearchName(away.team?.displayName);

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

function renderHero(container, name, logo, matchCount) {
  container.innerHTML = `
    <div class="team-profile-header">
      <img class="team-profile-logo" src="${logo}" alt="" />
      <div class="team-profile-info">
        <h2>${name}</h2>
        <div class="team-profile-meta">
          <span>LIGA: ${state.category.toUpperCase()}</span>
          <span>PARTIDOS TEMPORADA: ${matchCount}</span>
        </div>
      </div>
    </div>
  `;
}

function renderMatchesTab(container, matches) {
  if (!matches.length) {
    container.innerHTML = '<p class="detail-empty">Sin partidos registrados en esta temporada.</p>';
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

  // Listener de clics para redirigir al detalle del partido
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
// POSICIONES ADAPTATIVAS (Sin Apertura/Clausura en la B Nacional)
// ----------------------------------------------------
async function renderStandingsTab(container, normTeam) {
  const isB = isAscensoCategory(state.category);

  const loadTable = async (torneoKey) => {
    const tableBox = container.querySelector("#team-standings-box");
    if (tableBox) tableBox.innerHTML = '<p class="detail-loading">Cargando posiciones...</p>';

    try {
      const data = await fetchStandingsSafe(state.category, state.season, torneoKey);
      const zonas = data?.zonas || [];

      if (!zonas.length) {
        if (tableBox) tableBox.innerHTML = '<p class="detail-empty">Tabla de posiciones no disponible.</p>';
        return;
      }

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
            <span class="zone-title-badge">${targetZone.nombre || "Zona A"}</span>
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
          <div class="table-legend">
            <span class="legend-indicator"></span> Clasifican a zona de Reducido / Octavos
          </div>
        `;
      }
    } catch (e) {
      console.error(e);
      if (tableBox) tableBox.innerHTML = '<p class="detail-empty">Error al cargar la tabla de posiciones.</p>';
    }
  };

  // En la B Nacional no renderizamos el selector Apertura/Clausura
  if (isB) {
    container.innerHTML = `<div id="team-standings-box"></div>`;
    await loadTable("anual");
  } else {
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
        loadTable(btn.dataset.torneo);
      });
    });

    await loadTable(activeTorneo);
  }
}

// ----------------------------------------------------
// PLANTEL CON FALLBACK A RESÚMENES
// ----------------------------------------------------
async function renderSquadTab(container, teamId, leagueCode = "arg.1") {
  if (!teamId) {
    container.innerHTML = '<p class="detail-empty">Identificador de equipo no disponible para cargar el plantel.</p>';
    return;
  }

  container.innerHTML = '<p class="detail-loading">Cargando plantel del club...</p>';

  try {
    const rosterUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/teams/${teamId}/roster`;
    const rosterRes = await noCacheFetch(rosterUrl);
    const rosterData = await rosterRes.json();

    let athletes = rosterData?.athletes || [];

    // Fallback: Reconstruir plantel con partidos recientes de la B
    if (!athletes.length) {
      const schedUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/teams/${teamId}/schedule?season=${state.season}`;
      const schedRes = await noCacheFetch(schedUrl);
      const schedData = await schedRes.json();

      const completedEvents = (schedData.events || []).filter((e) => e.competitions?.[0]?.status?.type?.state === "post");
      const playerMap = new Map();

      for (const e of completedEvents.slice(-6)) {
        const comp = e.competitions?.[0];
        if (!comp) continue;

        const summaryUrl = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/summary?event=${comp.id}`;
        try {
          const sumRes = await noCacheFetch(summaryUrl);
          const sumData = await sumRes.json();
          const rosters = sumData?.rosters || [];

          for (const r of rosters) {
            if (String(r.team?.id) === String(teamId)) {
              for (const entry of (r.roster || [])) {
                const ath = entry.athlete;
                if (ath && !playerMap.has(ath.id)) {
                  playerMap.set(ath.id, {
                    jersey: entry.jersey || ath.jersey || "•",
                    displayName: ath.displayName || ath.fullName,
                    position: entry.position?.displayName || ath.position?.displayName || "Jugador"
                  });
                }
              }
            }
          }
        } catch (err) {}
      }

      athletes = Array.from(playerMap.values());
    }

    if (!athletes.length) {
      container.innerHTML = '<p class="detail-empty">Plantel oficial no disponible en la API para este club del ascenso.</p>';
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