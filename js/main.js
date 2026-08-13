import { state } from "./state.js";

import {
  $,
  matchesList,
  refreshBtn,
  liveOnlyInput,
  matchModal,
  modalClose,
  seasonSelect,
  isDetailPage
} from "./dom.js";

import {
  setActiveButtons,
  syncTorneoControls,
  syncLiveOnlyAvailability,
  populateSeasonSelect
} from "./ui-controls.js";

import { renderAll } from "./render-standings.js";
import { renderMatches } from "./render-matches.js";

import {
  loadCategoryData,
  loadCache,
  setLiveBanner,
  setDate,
  loadHomeMatches
} from "./data-loader.js";

import {
  openMatchDetail,
  closeMatchDetail,
  initDetailPage
} from "./match-detail.js";


// =========================================================
// HELPERS
// =========================================================

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


// =========================================================
// URL
// =========================================================

function updateUrlParams() {
  const params = new URLSearchParams();

  const category = state.isEspnLeague
    ? "espn"
    : state.category;

  const leagueCode = state.isEspnLeague
    ? state.espnLeagueCode
    : "";

  params.set("category", category || "primera");

  if (leagueCode) {
    params.set("league", leagueCode);
  }

  if (state.season) {
    params.set("season", String(state.season));
  }

  if (state.torneo) {
    params.set("torneo", state.torneo);
  }

  const newUrl =
    `${window.location.pathname}?${params.toString()}`;

  window.history.replaceState(null, "", newUrl);
}


function restoreStateFromUrl() {
  const urlParams =
    new URLSearchParams(window.location.search);

  const category = urlParams.get("category");
  const league = urlParams.get("league");
  const season = urlParams.get("season");
  const torneo = urlParams.get("torneo");

  if (season) {
    state.season = Number(season);
  }

  if (torneo) {
    state.torneo = torneo;
  }

  if (!category) {
    return false;
  }

  // -----------------------------------------
  // ESPN
  // -----------------------------------------

  if (category === "espn" && league) {
    state.isEspnLeague = true;
    state.espnLeagueCode = league;

    const btn = document.querySelector(
      `[data-category="espn"][data-league="${league}"]`
    );

    if (btn) {
      document
        .querySelectorAll(".segment-btn")
        .forEach((b) => b.classList.remove("active"));

      btn.classList.add("active");

      const accordionItem =
        btn.closest(".accordion-item");

      if (accordionItem) {
        accordionItem.classList.add("active");
      }
    }

    return true;
  }

  // -----------------------------------------
  // Categoría normal
  // -----------------------------------------

  state.isEspnLeague = false;
  state.category = category;

  const btn = document.querySelector(
    `[data-category="${category}"]`
  );

  if (btn) {
    document
      .querySelectorAll(".segment-btn")
      .forEach((b) => b.classList.remove("active"));

    btn.classList.add("active");

    const accordionItem =
      btn.closest(".accordion-item");

    if (accordionItem) {
      accordionItem.classList.add("active");
    }
  }

  return false;
}


// =========================================================
// ESPN
// =========================================================

async function loadEspnLeagueData(leagueCode) {
  if (!matchesList) return;

  state.isEspnLeague = true;
  state.espnLeagueCode = leagueCode;

  matchesList.innerHTML =
    `<p class="detail-loading">
      Cargando partidos y posiciones...
    </p>`;

  try {
    const [
      matchesRes,
      standingsRes
    ] = await Promise.all([
      fetch(
        `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/scoreboard`
      ),
      fetch(
        `https://site.api.espn.com/apis/v2/sports/soccer/${leagueCode}/standings`
      )
    ]);

    if (!matchesRes.ok || !standingsRes.ok) {
      throw new Error("Error HTTP al consultar ESPN");
    }

    const matchesData =
      await matchesRes.json();

    const standingsData =
      await standingsRes.json();


    // -----------------------------------------
    // PARTIDOS
    // -----------------------------------------

    state.currentMatches =
      (matchesData.events || []).map((event) => {

        const comp =
          event.competitions?.[0];

        const home =
          comp?.competitors?.find(
            (c) => c.homeAway === "home"
          ) ||
          comp?.competitors?.[0];

        const away =
          comp?.competitors?.find(
            (c) => c.homeAway === "away"
          ) ||
          comp?.competitors?.[1];

        const status =
          comp?.status?.type;

        const isLive =
          status?.state === "in";

        const isCompleted =
          status?.state === "post";

        return {
          id: event.id,

          dateIso: event.date,

          homeName:
            home?.team?.shortDisplayName ||
            home?.team?.name ||
            "Local",

          homeLogo:
            home?.team?.logo ||
            "",

          homeScore:
            home?.score ?? "-",

          awayName:
            away?.team?.shortDisplayName ||
            away?.team?.name ||
            "Visitante",

          awayLogo:
            away?.team?.logo ||
            "",

          awayScore:
            away?.score ?? "-",

          isCompleted,

          isLive,

          statusText:
            isLive
              ? "EN VIVO"
              : isCompleted
                ? "Finalizado"
                : "Programado"
        };
      });


    // -----------------------------------------
    // TABLA
    // -----------------------------------------

    const standingsGroup =
      standingsData.children?.[0]?.standings ||
      standingsData.standings?.[0] ||
      {};

    const entries =
      standingsGroup.entries || [];

    state.currentStandings = {
      zonas: [
        {
          nombre: "Tabla de Posiciones",

          tabla: entries.map((item) => {

            const stats =
              item.stats || [];

            const getStat = (name) =>
              stats.find(
                (s) => s.name === name
              )?.value ?? 0;

            return {
              equipo:
                item.team?.shortDisplayName ||
                item.team?.displayName ||
                "Equipo",

              logo:
                item.team?.logos?.[0]?.href ||
                "",

              pts:
                getStat("points"),

              pj:
                getStat("gamesPlayed"),

              pg:
                getStat("wins"),

              pe:
                getStat("ties"),

              pp:
                getStat("losses"),

              gf:
                getStat("pointsFor"),

              gc:
                getStat("pointsAgainst"),

              dg:
                getStat("pointDifferential")
            };
          })
        }
      ]
    };


    renderMatches();
    renderAll();

  } catch (error) {

    console.error(
      "Error al cargar liga de ESPN:",
      error
    );

    matchesList.innerHTML =
      `<p class="detail-empty">
        Error al cargar partidos de esta competencia.
      </p>`;

    state.currentMatches = [];

    state.currentStandings = {
      zonas: []
    };

    renderMatches();
    renderAll();
  }
}


// =========================================================
// AUTO REFRESH
// =========================================================

const AUTO_REFRESH_MS = 30000;

let autoRefreshTimer = null;


function triggerAutoRefresh() {
  if (document.hidden) return;

  if (state.isHomeMode) {
    loadHomeMatches(state.homeDate || new Date());
    return;
  }

  if (
    state.isEspnLeague &&
    state.espnLeagueCode
  ) {
    loadEspnLeagueData(
      state.espnLeagueCode
    );
  } else {
    state.isEspnLeague = false;

    loadCategoryData(
      state.category,
      true
    );
  }
}


function startAutoRefresh() {
  stopAutoRefresh();

  autoRefreshTimer =
    setInterval(
      triggerAutoRefresh,
      AUTO_REFRESH_MS
    );
}


function stopAutoRefresh() {
  if (autoRefreshTimer) {
    clearInterval(autoRefreshTimer);
    autoRefreshTimer = null;
  }
}


// =========================================================
// DETALLE DE PARTIDO
// =========================================================

function handleOpenMatchDetail(
  matchId,
  cardElement
) {
  if (!matchId) return;

  let category = "primera";
  let league = "";

  if (cardElement) {

    const teamWithData =
      cardElement.querySelector(
        "[data-category]"
      );

    if (teamWithData) {

      category =
        teamWithData.dataset.category ||
        category;

      league =
        teamWithData.dataset.league ||
        league;
    }
  }


  if (
    category === "primera" &&
    state.isEspnLeague
  ) {
    category = "espn";
    league =
      state.espnLeagueCode || "";
  }


  const params =
    new URLSearchParams({
      matchId: String(matchId),
      category,
      league,
      season: String(
        state.season || 2026
      ),
      torneo:
        state.torneo || "clausura"
    });


  window.location.href =
    `detail.html?${params.toString()}`;
}


// =========================================================
// APLICACIÓN PRINCIPAL
// =========================================================

if (!isDetailPage) {

  // =======================================================
  // ELEMENTOS DEL DRAWER MOBILE
  // =======================================================

  const mobileMenuBtn =
    document.getElementById(
      "mobile-menu-btn"
    );

  const mobileDrawerOverlay =
    document.getElementById(
      "mobile-drawer-overlay"
    );

  const controlsPanel =
    document.querySelector(
      ".panel-controls"
    );

  const mobileDrawerClose =
    document.getElementById(
      "mobile-drawer-close"
    );


  // =======================================================
  // ABRIR DRAWER
  // =======================================================

  function openMobileDrawer() {

    if (!controlsPanel) return;

    controlsPanel.classList.add(
      "mobile-open"
    );

    mobileDrawerOverlay?.classList.add(
      "active"
    );

    document.body.classList.add(
      "drawer-open"
    );

    mobileMenuBtn?.setAttribute(
      "aria-expanded",
      "true"
    );
  }


  // =======================================================
  // CERRAR DRAWER
  // =======================================================

  function closeMobileDrawer() {

    if (!controlsPanel) return;

    controlsPanel.classList.remove(
      "mobile-open"
    );

    mobileDrawerOverlay?.classList.remove(
      "active"
    );

    document.body.classList.remove(
      "drawer-open"
    );

    mobileMenuBtn?.setAttribute(
      "aria-expanded",
      "false"
    );
  }


  // =======================================================
  // TOGGLE DRAWER
  // =======================================================

  function toggleMobileDrawer() {

    if (!controlsPanel) return;

    const isOpen =
      controlsPanel.classList.contains(
        "mobile-open"
      );

    if (isOpen) {
      closeMobileDrawer();
    } else {
      openMobileDrawer();
    }
  }


  // =======================================================
  // BOTÓN "COMPETENCIAS"
  // =======================================================

  mobileMenuBtn?.addEventListener(
    "click",
    toggleMobileDrawer
  );


  // =======================================================
  // BOTÓN X
  // =======================================================

  mobileDrawerClose?.addEventListener(
    "click",
    (event) => {

      event.preventDefault();
      event.stopPropagation();

      closeMobileDrawer();
    }
  );


  // =======================================================
  // CLICK EN EL OVERLAY
  // =======================================================

  mobileDrawerOverlay?.addEventListener(
    "click",
    (event) => {

      if (
        event.target ===
        mobileDrawerOverlay
      ) {
        closeMobileDrawer();
      }
    }
  );


  // =======================================================
  // ESC
  // =======================================================

  document.addEventListener(
    "keydown",
    (event) => {

      if (
        event.key === "Escape" &&
        controlsPanel?.classList.contains(
          "mobile-open"
        )
      ) {
        closeMobileDrawer();
      }
    }
  );


  // =======================================================
  // ACORDEÓN
  // =======================================================

  document
    .querySelectorAll(".accordion-header")
    .forEach((header) => {

      header.addEventListener(
        "click",
        () => {
          const item =
            header.closest(
              ".accordion-item"
            );

          if (!item) return;

          const isActive =
            item.classList.contains(
              "active"
            );


          document
            .querySelectorAll(
              ".accordion-item"
            )
            .forEach((i) => {
              i.classList.remove(
                "active"
              );
            });


          if (!isActive) {
            item.classList.add(
              "active"
            );
          }
        }
      );
    });


  // =======================================================
  // SELECCIÓN DE COMPETENCIA
  // =======================================================

  document
    .querySelectorAll(
      "[data-category]"
    )
    .forEach((btn) => {

      btn.addEventListener(
        "click",
        () => {

          const category = btn.dataset.category;
          const leagueCode = btn.dataset.league;

          // La competencia seleccionada conserva el selector de fecha, pero
          // el feed diario pasa a traer solamente esa liga.
          state.isHomeMode = true;
          state.homeLeagueFilter = category === "espn"
            ? leagueCode
            : category === "segunda"
              ? "arg.2"
              : "arg.1";
          state.homeLeagueName = btn.textContent.trim();
          state.homeDate = state.homeDate || new Date();
          state.homeDate.setHours(0, 0, 0, 0);
          document.body.classList.add("home-mode", "has-selected-league");
          document.getElementById("home-date-nav")?.removeAttribute("hidden");
          renderHomeDate(state.homeDate);
          loadHomeMatches(state.homeDate);

          document
            .querySelectorAll(
              ".segment-btn"
            )
            .forEach((b) => {
              b.classList.remove(
                "active"
              );
            });


          btn.classList.add(
            "active"
          );

          // -----------------------------------------
          // ESPN
          // -----------------------------------------

          if (
            category === "espn" &&
            leagueCode
          ) {

            state.isEspnLeague =
              true;

            state.espnLeagueCode =
              leagueCode;

            updateUrlParams();

            loadEspnLeagueData(
              leagueCode
            );

          }

          // -----------------------------------------
          // Categorías propias
          // -----------------------------------------

          else {

            state.isEspnLeague =
              false;

            state.espnLeagueCode =
              null;

            state.currentMatches =
              [];

            state.category =
              category;

            updateUrlParams();

            syncTorneoControls();

            syncLiveOnlyAvailability();

            loadCategoryData(
              state.category,
              true
            );
          }


          // -----------------------------------------
          // MOBILE
          // -----------------------------------------

          if (
            window.innerWidth <= 900
          ) {
            closeMobileDrawer();
          }
        }
      );
    });


  // =======================================================
  // TORNEO
  // =======================================================

  document
    .querySelectorAll(
      "[data-torneo]"
    )
    .forEach((btn) => {

      btn.addEventListener(
        "click",
        () => {

          if (btn.disabled) return;

          state.torneo =
            btn.dataset.torneo;

          setActiveButtons(
            "[data-torneo]",
            "torneo",
            state.torneo
          );

          updateUrlParams();

          renderAll();

          if (
            !state.isEspnLeague
          ) {
            loadCategoryData(
              state.category,
              true
            );
          }
        }
      );
    });


  // =======================================================
  // TEMPORADA
  // =======================================================

  if (seasonSelect) {

    seasonSelect.addEventListener(
      "change",
      (event) => {

        state.season =
          Number(
            event.target.value
          );

        updateUrlParams();

        syncTorneoControls();

        renderAll();

        if (
          !state.isEspnLeague
        ) {
          loadCategoryData(
            state.category,
            true
          );
        }
      }
    );
  }


  // =======================================================
  // VISTAS
  // =======================================================

  document
    .querySelectorAll(
      "[data-view]"
    )
    .forEach((btn) => {

      btn.addEventListener(
        "click",
        () => {

          if (state.isHomeMode) return;

          state.view =
            btn.dataset.view;

          setActiveButtons(
            "[data-view]",
            "view",
            state.view
          );

          syncLiveOnlyAvailability();

          renderMatches();


          if (
            window.innerWidth <= 900
          ) {

            const matchesPanel =
              document.querySelector(
                ".panel-matches"
              );

            const tablePanel =
              document.querySelector(
                ".panel-table"
              );


            if (
              state.view === "tabla"
            ) {

              if (matchesPanel) {
                matchesPanel.style.display =
                  "none";
              }

              if (tablePanel) {
                tablePanel.style.display =
                  "block";
              }

            } else {

              if (matchesPanel) {
                matchesPanel.style.display =
                  "block";
              }

              if (tablePanel) {
                tablePanel.style.display =
                  "none";
              }
            }
          }
        }
      );
    });


  // =======================================================
  // BUSCADOR
  // =======================================================

  $("#team-search")?.addEventListener(
    "input",
    (event) => {

      state.search =
        event.target.value.trim();

      renderAll();
    }
  );


  // =======================================================
  // SOLO EN JUEGO
  // =======================================================

  if (liveOnlyInput) {

    liveOnlyInput.addEventListener(
      "change",
      (event) => {

        state.liveOnly =
          event.target.checked;

        renderMatches();
      }
    );
  }


  // =======================================================
  // REFRESH
  // =======================================================

  if (refreshBtn) {

    refreshBtn.addEventListener(
      "click",
      () => {
        triggerAutoRefresh();
      }
    );
  }

  // =======================================================
  // NAVEGACIÓN DE FECHAS EN LA PORTADA
  // =======================================================

  const homeDateLabel = document.getElementById("home-date-label");

  function renderHomeDate(date) {
    if (!homeDateLabel) return;
    const label = new Intl.DateTimeFormat("es-AR", {
      weekday: "long",
      day: "numeric",
      month: "long"
    }).format(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    homeDateLabel.textContent = date.getTime() === today.getTime()
      ? "PARTIDOS DE HOY"
      : label.toUpperCase();
  }

  function moveHomeDate(days) {
    const current = state.homeDate || new Date();
    const next = new Date(current);
    next.setDate(next.getDate() + days);
    renderHomeDate(next);
    loadHomeMatches(next);
  }

  document.getElementById("home-date-prev")?.addEventListener("click", () => moveHomeDate(-1));
  document.getElementById("home-date-next")?.addEventListener("click", () => moveHomeDate(1));

  document.getElementById("all-matches-btn")?.addEventListener("click", () => {
    state.isHomeMode = true;
    state.homeLeagueFilter = null;
    state.homeLeagueName = "";
    state.isEspnLeague = false;
    state.espnLeagueCode = null;
    state.homeDate = state.homeDate || new Date();
    state.homeDate.setHours(0, 0, 0, 0);

    document.body.classList.add("home-mode");
    document.body.classList.remove("has-selected-league");
    document.getElementById("home-date-nav")?.removeAttribute("hidden");
    document.querySelectorAll(".segment-btn.active").forEach((btn) => btn.classList.remove("active"));
    window.history.replaceState(null, "", window.location.pathname);
    renderHomeDate(state.homeDate);
    loadHomeMatches(state.homeDate);
  });


  // =======================================================
  // DELEGACIÓN DE CLICS
  // =======================================================

  document.addEventListener(
    "click",
    (event) => {

      // -----------------------------------------
      // TORNEO
      // -----------------------------------------

      const tournamentEl =
        event.target.closest(
          "[data-open-tournament]"
        );


      if (tournamentEl) {

        const params =
          new URLSearchParams({
            category:
              tournamentEl.dataset.category ||
              (state.isEspnLeague
                ? "espn"
                : state.category),

            season:
              String(
                state.season || 2026
              ),

            torneo:
              state.torneo ||
              "clausura"
          });


        const tournamentLeague = tournamentEl.dataset.league || state.espnLeagueCode;

        if (tournamentLeague) {

          params.set(
            "league",
            tournamentLeague
          );
        }


        window.location.href =
          `tournament.html?${params.toString()}`;

        return;
      }


      // -----------------------------------------
      // EQUIPO
      // -----------------------------------------

      const teamEl =
        event.target.closest(
          ".team-link, " +
          ".team-with-logo, " +
          "[data-team-name], " +
          ".modal-team, " +
          ".team-info"
        );


      if (teamEl) {

        event.stopPropagation();

        const teamName =
          teamEl.dataset.teamName ||
          teamEl
            .querySelector(
              ".team-name, strong, span"
            )
            ?.textContent
            ?.trim() ||
          teamEl.textContent?.trim();


        if (
          teamName &&
          teamName !== "vs" &&
          teamName !== "Local" &&
          teamName !== "Visitante"
        ) {

          goToTeamPage(
            teamName
          );

          return;
        }
      }


      // -----------------------------------------
      // PARTIDO
      // -----------------------------------------

      const card =
        event.target.closest(
          ".match-card[data-match-id]"
        );


      if (card) {

        handleOpenMatchDetail(
          card.dataset.matchId,
          card
        );
      }
    }
  );


  // =======================================================
  // MODAL
  // =======================================================

  if (modalClose) {

    modalClose.addEventListener(
      "click",
      () => {
        closeMatchDetail();
      }
    );
  }


  if (matchModal) {

    matchModal.addEventListener(
      "click",
      (event) => {

        if (
          event.target ===
          matchModal
        ) {
          closeMatchDetail();
        }
      }
    );
  }


  // =======================================================
  // ESC PARA MODAL
  // =======================================================

  document.addEventListener(
    "keydown",
    (event) => {

      if (
        event.key === "Escape" &&
        matchModal &&
        !matchModal.classList.contains(
          "hidden"
        )
      ) {
        closeMatchDetail();
      }
    }
  );


  // =======================================================
  // VISIBILIDAD
  // =======================================================

  document.addEventListener(
    "visibilitychange",
    () => {

      if (document.hidden) {

        stopAutoRefresh();

      } else {

        triggerAutoRefresh();

        startAutoRefresh();
      }
    }
  );


  // =======================================================
  // INICIALIZACIÓN
  // =======================================================

  setDate();

  populateSeasonSelect();

  syncTorneoControls();

  loadCache();

  setLiveBanner();

  syncLiveOnlyAvailability();


  // =======================================================
  // RESTAURAR URL
  // =======================================================

  const isEspnRestored =
    restoreStateFromUrl();


  if (
    isEspnRestored &&
    state.espnLeagueCode
  ) {

    loadEspnLeagueData(
      state.espnLeagueCode
    );

  } else {
    // Sin una competencia en la URL, index es la portada diaria.
    const hasCompetitionInUrl = new URLSearchParams(window.location.search).has("category");
    if (!hasCompetitionInUrl) {
      state.isHomeMode = true;
      state.homeLeagueFilter = null;
      state.homeLeagueName = "";
      state.homeDate = new Date();
      state.homeDate.setHours(0, 0, 0, 0);
      document.body.classList.add("home-mode");
      document.body.classList.remove("has-selected-league");
      document.getElementById("home-date-nav")?.removeAttribute("hidden");
      renderHomeDate(state.homeDate);
      loadHomeMatches(state.homeDate);
    } else {
      renderAll();
      loadCategoryData(state.category || "primera", true);
    }
  }


  // =======================================================
  // AUTO REFRESH
  // =======================================================

  startAutoRefresh();


} else {

  // =======================================================
  // DETAIL PAGE
  // =======================================================

  initDetailPage();
}
