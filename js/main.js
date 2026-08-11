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
// AUTO-REFRESH EN SEGUNDO PLANO
// ==========================================
const AUTO_REFRESH_MS = 30000; // Recarga cada 30 segundos
let autoRefreshTimer = null;

function triggerAutoRefresh() {
  // Evitamos llamadas innecesarias si el usuario minimizó o cambió de pestaña
  if (document.hidden) return;
  
  // Refresca la data en background sin bloqueos
  loadCategoryData(state.category, true);
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
  document.querySelectorAll("[data-category]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.category = btn.dataset.category;
      setActiveButtons("[data-category]", "category", state.category);
      syncTorneoControls();
      renderAll();
      loadCategoryData(state.category, true);
    });
  });

  document.querySelectorAll("[data-torneo]").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.disabled) return;
      state.torneo = btn.dataset.torneo;
      setActiveButtons("[data-torneo]", "torneo", state.torneo);
      renderAll();
      loadCategoryData(state.category, true);
    });
  });

  seasonSelect.addEventListener("change", (e) => {
    state.season = Number(e.target.value);
    syncTorneoControls();
    renderAll();
    loadCategoryData(state.category, true);
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
    loadCategoryData(state.category, true);
  });

  // Interceptamos clics en listas de partidos y tablas de posiciones
  document.addEventListener("click", (e) => {
    // 1. Clic en un equipo (escudo o nombre) de las tablas o partidos
    const teamEl = e.target.closest(".team-link, .team-with-logo, [data-team-name]");
    if (teamEl) {
      e.stopPropagation();
      const teamName = teamEl.dataset.teamName || teamEl.querySelector("strong, .team-name")?.textContent;
      if (teamName) {
        goToTeamPage(teamName);
        return;
      }
    }

    // 2. Clic en la tarjeta de partido (si no tocó un equipo)
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