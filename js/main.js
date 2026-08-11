import { state } from "./state.js";
import {
  $, matchesList, refreshBtn, liveOnlyInput, matchModal, modalClose, seasonSelect, isDetailPage
} from "./dom.js";
import { setActiveButtons, syncTorneoControls, syncLiveOnlyAvailability, populateSeasonSelect } from "./ui-controls.js";
import { renderAll } from "./render-standings.js";
import { renderMatches } from "./render-matches.js";
import { loadCategoryData, loadCache, setLiveBanner, setDate } from "./data-loader.js";
import { openMatchDetail, closeMatchDetail, initDetailPage } from "./match-detail.js";

// Helper para navegar a la ficha del equipo
function goToTeamPage(teamName) {
  if (!teamName) return;
  const params = new URLSearchParams({
    team: teamName.trim(),
    category: state.category,
    season: String(state.season)
  });
  window.location.href = `team.html?${params.toString()}`;
}

// ==========================================
// CARGA DE COMPETENCIAS VÍA ESPN (Copa Arg, LATAM, Europa)
// ==========================================
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

    // 1. Asignamos los partidosLimpios al estado de partidos actual
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

    // 2. Asignamos las posiciones al estado actual
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

    // 3. Renderizamos ambas vistas
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

// ==========================================
// AUTO-REFRESH EN SEGUNDO PLANO
// ==========================================
const AUTO_REFRESH_MS = 30000;
let autoRefreshTimer = null;

function triggerAutoRefresh() {
  if (document.hidden) return;

  if (state.isEspnLeague && state.espnLeagueCode) {
    loadEspnLeagueData(state.espnLeagueCode);
  } else {
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

if (!isDetailPage) {
  // Manejador del Acordeón Desplegable por Países
  document.querySelectorAll(".accordion-header").forEach((header) => {
    header.addEventListener("click", () => {
      const item = header.closest(".accordion-item");
      const isActive = item.classList.contains("active");

      document.querySelectorAll(".accordion-item").forEach((i) => i.classList.remove("active"));

      if (!isActive) {
        item.classList.add("active");
      }
    });
  });

  // Manejador de Clic en Competencias (Botones dentro del acordeón)
// Manejador de Clic en Competencias (Botones dentro del acordeón)
// Escuchador de botones de categorías / ligas
// Manejador de clic en competencias (AFA + ESPN)
  document.querySelectorAll("[data-category]").forEach((btn) => {
    btn.addEventListener("click", () => {
      // 1. Limpiar estado activo visual en todos los botones
      document.querySelectorAll(".accordion-content .segment-btn, .segment-btn").forEach((b) => {
        b.classList.remove("active");
        b.setAttribute("aria-selected", "false");
      });

      btn.classList.add("active");
      btn.setAttribute("aria-selected", "true");

      const category = btn.dataset.category;
      const leagueCode = btn.dataset.league;

      // 2. Rama Ligas ESPN (Internacional / Copa Argentina)
      if (category === "espn" && leagueCode) {
        state.isEspnLeague = true;
        state.espnLeagueCode = leagueCode;
        loadEspnLeagueData(leagueCode);
      } 
      // 3. Rama Fútbol Argentino Nativo (Primera o Primera Nacional)
      else {
        state.isEspnLeague = false;
        state.espnLeagueCode = null;
        state.category = category;

        // Resetear controles visuales de AFA y forzar carga
        syncTorneoControls();
        syncLiveOnlyAvailability();
        
        // Poner estado de carga temporario
        if (matchesList) {
          matchesList.innerHTML = '<p class="detail-loading">Cargando partidos de Argentina...</p>';
        }

        // Cargar datos de AFA y forzar renderizado
        loadCategoryData(state.category, true);
      }
    });
  });

  document.querySelectorAll("[data-torneo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      state.torneo = btn.dataset.torneo;
      setActiveButtons("[data-torneo]", "torneo", state.torneo);
      renderAll();
      if (!state.isEspnLeague) {
        loadCategoryData(state.category, true);
      }
    });
  });

  seasonSelect.addEventListener("change", (e) => {
    state.season = Number(e.target.value);
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
    });
  });

  $("#team-search").addEventListener("input", (e) => {
    state.search = e.target.value.trim();
    renderAll();
  });

  liveOnlyInput.addEventListener("change", (e) => {
    state.liveOnly = e.target.checked;
    renderMatches();
  });

  refreshBtn.addEventListener("click", () => {
    triggerAutoRefresh();
  });

  // Interceptamos clics en listas de partidos y tablas de posiciones
  document.addEventListener("click", (e) => {
    const teamEl = e.target.closest(".team-link, .team-with-logo, [data-team-name]");
    if (teamEl) {
      e.stopPropagation();
      const teamName = teamEl.dataset.teamName || teamEl.querySelector("strong, .team-name")?.textContent;
      if (teamName) {
        goToTeamPage(teamName);
        return;
      }
    }

    const card = e.target.closest(".match-card[data-match-id]");
    if (card) {
      openMatchDetail(card.dataset.matchId);
    }
  });

  matchesList.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".match-card[data-match-id]");
    if (!card) return;
    e.preventDefault();
    openMatchDetail(card.dataset.matchId);
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

  // Control de pestaña visible para pausar/reanudar el polling
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopAutoRefresh();
    } else {
      triggerAutoRefresh();
      startAutoRefresh();
    }
  });

  setDate();
  populateSeasonSelect();
  syncTorneoControls();
  loadCache();
  setLiveBanner();
  syncLiveOnlyAvailability();
  renderAll();
  loadCategoryData(state.category, true);
  
  // Arranca el refresco automático al cargar
  startAutoRefresh();
} else {
  initDetailPage();
}