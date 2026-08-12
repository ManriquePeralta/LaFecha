import { state } from "./state.js";
import {
  $, matchesList, refreshBtn, liveOnlyInput, matchModal, modalClose, seasonSelect, isDetailPage
} from "./dom.js";
import { setActiveButtons, syncTorneoControls, syncLiveOnlyAvailability, populateSeasonSelect } from "./ui-controls.js";
import { renderAll } from "./render-standings.js";
import { renderMatches } from "./render-matches.js";
import { loadCategoryData, loadCache, setLiveBanner, setDate } from "./data-loader.js";
import { openMatchDetail, closeMatchDetail, initDetailPage } from "./match-detail.js";

// Helper para ir a la ficha del equipo
function goToTeamPage(teamName) {
  if (!teamName) return;

  const params = new URLSearchParams({
    team: teamName.trim(),
    category: state.isEspnLeague ? "espn" : state.category,
    league: state.isEspnLeague ? (state.espnLeagueCode || "") : "",
    season: String(state.season || 2026),
    torneo: state.torneo || "clausura"
  });

  window.location.href = `team.html?${params.toString()}`;
}

// Sincronizar URL del navegador
function updateUrlParams() {
  const params = new URLSearchParams();

  const category = state.isEspnLeague ? "espn" : state.category;
  const leagueCode = state.isEspnLeague ? state.espnLeagueCode : "";

  params.set("category", category || "primera");
  if (leagueCode) params.set("league", leagueCode);
  if (state.season) params.set("season", String(state.season));
  if (state.torneo) params.set("torneo", state.torneo);

  const newUrl = `${window.location.pathname}?${params.toString()}`;
  window.history.replaceState(null, "", newUrl);
}

// Restaurar Estado desde la URL (para cuando volvés de detail.html)
function restoreStateFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  const category = urlParams.get("category");
  const league = urlParams.get("league");
  const season = urlParams.get("season");
  const torneo = urlParams.get("torneo");

  if (season) state.season = Number(season);
  if (torneo) state.torneo = torneo;

  if (category) {
    if (category === "espn" && league) {
      state.isEspnLeague = true;
      state.espnLeagueCode = league;

      const btn = document.querySelector(`[data-category="espn"][data-league="${league}"]`);
      if (btn) {
        document.querySelectorAll(".segment-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const accordionItem = btn.closest(".accordion-item");
        if (accordionItem) accordionItem.classList.add("active");
      }
      return true; // Era liga de ESPN
    } else {
      state.isEspnLeague = false;
      state.category = category;

      const btn = document.querySelector(`[data-category="${category}"]`);
      if (btn) {
        document.querySelectorAll(".segment-btn").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
      }
    }
  }
  return false;
}

// Carga de ligas ESPN
async function loadEspnLeagueData(leagueCode) {
  if (!matchesList) return;

  state.isEspnLeague = true;
  state.espnLeagueCode = leagueCode;

  matchesList.innerHTML = '<p class="detail-loading">Cargando partidos y posiciones...</p>';

  try {
    const [matchesRes, standingsRes] = await Promise.all([
      fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/scoreboard`),
      fetch(`https://site.api.espn.com/apis/v2/sports/soccer/${leagueCode}/standings`)
    ]);

    const matchesData = await matchesRes.json();
    const standingsData = await standingsRes.json();

    state.currentMatches = (matchesData.events || []).map((e) => {
      const comp = e.competitions?.[0];
      const home = comp?.competitors?.find((c) => c.homeAway === "home") || comp?.competitors?.[0];
      const away = comp?.competitors?.find((c) => c.homeAway === "away") || comp?.competitors?.[1];
      const isLive = comp?.status?.type?.state === "in";
      const isCompleted = comp?.status?.type?.state === "post";

      return {
        id: e.id,
        dateIso: e.date,
        homeName: home?.team?.shortDisplayName || home?.team?.name || "Local",
        homeLogo: home?.team?.logo || "",
        homeScore: home?.score ?? "-",
        awayName: away?.team?.shortDisplayName || away?.team?.name || "Visitante",
        awayLogo: away?.team?.logo || "",
        awayScore: away?.score ?? "-",
        isCompleted,
        isLive,
        statusText: isLive ? "EN VIVO" : isCompleted ? "Finalizado" : "Programado"
      };
    });

    const standingsGroup = standingsData.children?.[0]?.standings || standingsData.standings?.[0] || [];
    const entries = standingsGroup.entries || [];

    state.currentStandings = {
      zonas: [
        {
          nombre: "Tabla de Posiciones",
          tabla: entries.map((item) => {
            const stats = item.stats || [];
            const getStat = (name) => stats.find((s) => s.name === name)?.value ?? 0;
            return {
              equipo: item.team?.shortDisplayName || item.team?.displayName || "Equipo",
              logo: item.team?.logos?.[0]?.href || "",
              pts: getStat("points"),
              pj: getStat("gamesPlayed"),
              pg: getStat("wins"),
              pe: getStat("ties"),
              pp: getStat("losses"),
              gf: getStat("pointsFor"),
              gc: getStat("pointsAgainst"),
              dg: getStat("pointDifferential")
            };
          })
        }
      ]
    };

    renderMatches();
    renderAll();
  } catch (err) {
    console.error("Error al cargar liga de ESPN:", err);
    matchesList.innerHTML = '<p class="detail-empty">Error al cargar partidos de esta competencia.</p>';
    state.currentMatches = [];
    state.currentStandings = { zonas: [] };
    renderMatches();
    renderAll();
  }
}

// Auto Refresh
const AUTO_REFRESH_MS = 30000;
let autoRefreshTimer = null;

function triggerAutoRefresh() {
  if (document.hidden) return;
  if (state.isEspnLeague && state.espnLeagueCode) {
    loadEspnLeagueData(state.espnLeagueCode);
  } else {
    state.isEspnLeague = false;
    loadCategoryData(state.category, true);
  }
}

function startAutoRefresh() {
  stopAutoRefresh();
  autoRefreshTimer = setInterval(triggerAutoRefresh, AUTO_REFRESH_MS);
}

function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}

// Helper local para abrir el detalle capturando la categoría/liga de la tarjeta
function handleOpenMatchDetail(matchId, cardElement) {
  if (!matchId) return;

  let category = "primera";
  let league = "";

  // 1. Intentar leer data-category / data-league de la tarjeta clickeada
  if (cardElement) {
    const teamWithData = cardElement.querySelector("[data-category]");
    if (teamWithData) {
      category = teamWithData.dataset.category || category;
      league = teamWithData.dataset.league || league;
    }
  }

  // 2. Fallback al estado global si no los traía el HTML
  if (category === "primera" && state.isEspnLeague) {
    category = "espn";
    league = state.espnLeagueCode || "";
  }

  const params = new URLSearchParams({
    matchId: String(matchId),
    category: category,
    league: league,
    season: String(state.season || 2026),
    torneo: state.torneo || "clausura"
  });

  window.location.href = `detail.html?${params.toString()}`;
}

// =========================================================
// INICIALIZACIÓN DE LA APLICACIÓN
// =========================================================

if (!isDetailPage) {
  // Manejador del Acordeón Desplegable
  document.querySelectorAll(".accordion-header").forEach((header) => {
    header.addEventListener("click", () => {
      const item = header.closest(".accordion-item");
      const isActive = item.classList.contains("active");
      document.querySelectorAll(".accordion-item").forEach((i) => i.classList.remove("active"));
      if (!isActive) item.classList.add("active");
    });
  });

  // Manejador ÚNICO de selección de liga
  document.querySelectorAll("[data-category]").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".segment-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      const category = btn.dataset.category;
      const leagueCode = btn.dataset.league;

      if (category === "espn" && leagueCode) {
        state.isEspnLeague = true;
        state.espnLeagueCode = leagueCode;
        updateUrlParams();
        loadEspnLeagueData(leagueCode);
      } else {
        state.isEspnLeague = false;
        state.espnLeagueCode = null;
        state.currentMatches = [];
        state.category = category;

        updateUrlParams();
        syncTorneoControls();
        syncLiveOnlyAvailability();
        loadCategoryData(state.category, true);
      }
    });
  });

  document.querySelectorAll("[data-torneo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      state.torneo = btn.dataset.torneo;
      setActiveButtons("[data-torneo]", "torneo", state.torneo);
      updateUrlParams();
      renderAll();
      if (!state.isEspnLeague) {
        loadCategoryData(state.category, true);
      }
    });
  });

  seasonSelect.addEventListener("change", (e) => {
    state.season = Number(e.target.value);
    updateUrlParams();
    syncTorneoControls();
    renderAll();
    if (!state.isEspnLeague) {
      loadCategoryData(state.category, true);
    }
  });

  document.querySelectorAll("[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.view = btn.dataset.view;
      setActiveButtons("[data-view]", "view", state.view);
      syncLiveOnlyAvailability();
      renderMatches();

      if (window.innerWidth <= 900) {
        const matchesPanel = document.querySelector(".panel-matches");
        const tablePanel = document.querySelector(".panel-table");
        if (state.view === "tabla") {
          if (matchesPanel) matchesPanel.style.display = "none";
          if (tablePanel) tablePanel.style.display = "block";
        } else {
          if (matchesPanel) matchesPanel.style.display = "block";
          if (tablePanel) tablePanel.style.display = "none";
        }
      }
    });
  });

  $("#team-search")?.addEventListener("input", (e) => {
    state.search = e.target.value.trim();
    renderAll();
  });

  if (liveOnlyInput) {
    liveOnlyInput.addEventListener("change", (e) => {
      state.liveOnly = e.target.checked;
      renderMatches();
    });
  }

  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => triggerAutoRefresh());
  }

  // Delegación de clics
  document.addEventListener("click", (e) => {
    const teamEl = e.target.closest(".team-link, .team-with-logo, [data-team-name], .modal-team, .team-info");
    
    if (teamEl) {
      e.stopPropagation();
      const teamName = 
        teamEl.dataset.teamName || 
        teamEl.querySelector(".team-name, strong, span")?.textContent?.trim() || 
        teamEl.textContent?.trim();

      if (teamName && teamName !== "vs" && teamName !== "Local" && teamName !== "Visitante") {
        goToTeamPage(teamName);
        return;
      }
    }

    const card = e.target.closest(".match-card[data-match-id]");
    if (card) {
      // Pasamos card para que extraiga los atributos data-category y data-league de ese partido en particular
      handleOpenMatchDetail(card.dataset.matchId, card);
    }
  });

  if (modalClose) modalClose.addEventListener("click", closeMatchDetail);
  if (matchModal) {
    matchModal.addEventListener("click", (e) => {
      if (e.target === matchModal) closeMatchDetail();
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && matchModal && !matchModal.classList.contains("hidden")) closeMatchDetail();
  });

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopAutoRefresh();
    else { triggerAutoRefresh(); startAutoRefresh(); }
  });

  // PREPARAR E INICIALIZAR VISTA
  setDate();
  populateSeasonSelect();
  syncTorneoControls();
  loadCache();
  setLiveBanner();
  syncLiveOnlyAvailability();

  // Restaurar liga desde la URL
  const isEspnRestored = restoreStateFromUrl();

  if (isEspnRestored && state.espnLeagueCode) {
    loadEspnLeagueData(state.espnLeagueCode);
  } else {
    renderAll();
    loadCategoryData(state.category || "primera", true);
  }

  startAutoRefresh();
} else {
  initDetailPage();
}