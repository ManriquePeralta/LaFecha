import { state } from "./state.js";
import {
  $, matchesList, refreshBtn, liveOnlyInput, matchModal, modalClose, seasonSelect, isDetailPage
} from "./dom.js";
import { setActiveButtons, syncTorneoControls, syncLiveOnlyAvailability, populateSeasonSelect } from "./ui-controls.js";
import { renderAll } from "./render-standings.js";
import { renderMatches } from "./render-matches.js";
import { loadCategoryData, loadCache, setLiveBanner, setDate } from "./data-loader.js";
import { openMatchDetail, closeMatchDetail, initDetailPage } from "./match-detail.js";

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

  matchesList.addEventListener("click", (e) => {
    const card = e.target.closest(".match-card[data-match-id]");
    if (!card) return;
    openMatchDetail(card.dataset.matchId);
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

  setDate();
  populateSeasonSelect();
  syncTorneoControls();
  loadCache();
  setLiveBanner();
  syncLiveOnlyAvailability();
  renderAll();
  loadCategoryData(state.category, true);
} else {
  initDetailPage();
}