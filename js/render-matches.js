import { PLACEHOLDER_LOGO } from "./config.js";
import { db, state } from "./state.js";
import { matchesTitle, matchesList } from "./dom.js";
import { bySearch } from "./utils.js";

// ==========================================
// HTML DE CADA PARTIDO (COMPATIBLE AFA Y ESPN)
// ==========================================

function matchCardHtml(m, view) {
  // Normalización de propiedades (AFA vs ESPN)
  const localName = m.local || m.homeName || "Local";
  const visitanteName = m.visitante || m.awayName || "Visitante";
  const localLogo = m.localLogo || m.homeLogo || PLACEHOLDER_LOGO;
  const visitanteLogo = m.visitanteLogo || m.awayLogo || PLACEHOLDER_LOGO;
  const gl = m.gl ?? m.homeScore ?? "-";
  const gv = m.gv ?? m.awayScore ?? "-";

  // Resolver Categoría y Liga para la navegación
  const matchCategory = m.category || (state.isEspnLeague ? "espn" : state.category) || "primera";
  const matchLeague = m.league || m.leagueCode || (state.isEspnLeague ? state.espnLeagueCode : "") || "";

  const isLive =
    m.isLive ||
    m.estado === "En juego" ||
    m.estado === "EN JUEGO" ||
    m.estado === "En vivo" ||
    m.estado === "EN VIVO" ||
    m.status === "LIVE" ||
    m.status === "IN_PLAY";

  const isFinal =
    m.isCompleted ||
    m.estado === "Final" ||
    m.estado === "FINAL" ||
    m.status === "COMPLETED";

  const badgeClass = isLive
    ? "badge-live"
    : isFinal
      ? "badge-final"
      : "badge-scheduled";

  // ========================================
  // TIEMPO DE JUEGO / HORA
  // ========================================

  let liveTime = "";

  if (isLive) {
    if (m.tiempoJuego) {
      liveTime = `<span class="live-time">${m.tiempoJuego}</span>`;
    } else {
      const minute = m.minuto ?? m.minute ?? m.elapsed ?? m.min ?? null;
      const second = m.segundo ?? m.second ?? m.seconds ?? 0;

      if (minute !== null) {
        liveTime = `<span class="live-time">${minute}:${String(second).padStart(2, "0")}</span>`;
      } else {
        liveTime = `<span class="live-time">EN VIVO</span>`;
      }
    }
  }

  const horaFormat = m.hora || (m.dateIso ? new Date(m.dateIso).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" }) : "");
  const statusText = isLive
    ? `EN VIVO${liveTime ? ` · ${liveTime}` : ""}`
    : m.estado || (isFinal ? "Finalizado" : "Programado");

  // ========================================
  // TARJETA PARA RESULTADOS / FINALIZADOS
  // ========================================

  if (view === "resultados") {
    return `
      <article
        class="match-card clickable ${isLive ? "live" : ""}"
        data-match-id="${m.id}"
        tabindex="0"
        role="button"
        aria-label="Ver detalle del partido"
      >
        <p class="teams teams-line">
          <span 
            class="team-with-logo" 
            data-team-name="${localName}"
            data-category="${matchCategory}"
            data-league="${matchLeague}"
          >
            <img
              class="team-logo"
              src="${localLogo}"
              alt=""
            />
            <strong>${localName}</strong>
          </span>

          <span class="vs">vs</span>

          <span 
            class="team-with-logo" 
            data-team-name="${visitanteName}"
            data-category="${matchCategory}"
            data-league="${matchLeague}"
          >
            <img
              class="team-logo"
              src="${visitanteLogo}"
              alt=""
            />
            <strong>${visitanteName}</strong>
          </span>
        </p>

        <p class="meta">
          <strong>${gl} - ${gv}</strong>

          <span class="status ${badgeClass}">
            ${statusText}
          </span>

          ${!isLive && horaFormat ? `<span class="detail">${horaFormat}</span>` : ""}
        </p>
      </article>
    `;
  }

  // ========================================
  // TARJETA PARA PRÓXIMOS PARTIDOS
  // ========================================

  return `
    <article
      class="match-card clickable"
      data-match-id="${m.id}"
      tabindex="0"
      role="button"
      aria-label="Ver detalle del partido"
    >
      <p class="teams teams-line">
        <span 
          class="team-with-logo" 
          data-team-name="${localName}"
          data-category="${matchCategory}"
          data-league="${matchLeague}"
        >
          <img
            class="team-logo"
            src="${localLogo}"
            alt=""
          />
          <strong>${localName}</strong>
        </span>

        <span class="vs">vs</span>

        <span 
          class="team-with-logo" 
          data-team-name="${visitanteName}"
          data-category="${matchCategory}"
          data-league="${matchLeague}"
        >
          <img
            class="team-logo"
            src="${visitanteLogo}"
            alt=""
          />
          <strong>${visitanteName}</strong>
        </span>
      </p>

      <p class="meta">
        ${horaFormat}

        <span class="status badge-scheduled">
          Programado
        </span>

        ${m.detalle ? m.detalle : ""}
      </p>
    </article>
  `;
}

// ==========================================
// AGRUPAR POR FECHA
// ==========================================

function groupByFecha(matches) {
  const groups = [];
  let lastFecha = null;

  matches.forEach((m) => {
    // Generar string de fecha legible si viene desde ISO (ESPN)
    let fechaLabel = m.fecha;
    if (!fechaLabel && m.dateIso) {
      fechaLabel = new Date(m.dateIso).toLocaleDateString("es-AR", {
        weekday: "long",
        day: "numeric",
        month: "long"
      });
      // Capitalizar primer letra del día
      fechaLabel = fechaLabel.charAt(0).toUpperCase() + fechaLabel.slice(1);
    }

    if (!fechaLabel) fechaLabel = "Partidos";

    if (fechaLabel !== lastFecha) {
      lastFecha = fechaLabel;
      groups.push({
        fecha: fechaLabel,
        items: []
      });
    }

    groups[groups.length - 1].items.push(m);
  });

  return groups;
}

// ==========================================
// RENDER DE PARTIDOS
// ==========================================

function renderMatches() {
  if (!matchesList) return;

  // ========================================
  // SELECCIÓN DE ORIGEN DE DATOS
  // ========================================

  let source = [];

  if (state.isHomeMode) {
    renderHomeMatches();
    return;
  }

  if (state.isEspnLeague) {
    source = state.currentMatches || [];
  } else {
    const liga = db[state.category] || {};
    source = liga[state.view] || [];
  }

  // ========================================
  // TÍTULO
  // ========================================

  if (matchesTitle) {
    matchesTitle.textContent =
      state.view === "resultados"
        ? "Resultados"
        : state.view === "proximos"
          ? "Proximos"
          : "Resumen";
  }

  // ========================================
  // VISTA TABLA
  // ========================================

  if (state.view === "tabla") {
    matchesList.innerHTML = "Selecciona Resultados o Proximos para ver partidos.";
    return;
  }

  // ========================================
  // FILTROS (BÚSQUEDA Y SOLO EN JUEGO)
  // ========================================

  const filtered = source.filter((m) => {
    const local = m.local || m.homeName || "";
    const visitante = m.visitante || m.awayName || "";

    const liveOk =
      !state.liveOnly ||
      m.isLive ||
      m.estado === "En juego" ||
      m.estado === "EN JUEGO" ||
      m.estado === "En vivo" ||
      m.estado === "EN VIVO" ||
      m.status === "LIVE" ||
      m.status === "IN_PLAY";

    return liveOk && bySearch(local, visitante);
  });

  // ========================================
  // SIN PARTIDOS
  // ========================================

  if (!filtered.length) {
    matchesList.innerHTML = "No hay partidos disponibles para ese filtro.";
    return;
  }

  // ========================================
  // AGRUPAR Y DIBUJAR
  // ========================================

  const groups = groupByFecha(filtered);

  matchesList.innerHTML = groups
    .map(
      (g) => `
        <div class="day-divider">
          <span class="day-label">
            ${g.fecha}
          </span>
          <span class="day-count">
            ${g.items.length} partido${g.items.length === 1 ? "" : "s"}
          </span>
        </div>

        ${g.items
          .map((m) => matchCardHtml(m, state.view))
          .join("")}
      `
    )
    .join("");
}

function renderHomeMatches() {
  if (!matchesList) return;

  if (matchesTitle) {
    const firstMatch = state.homeMatches?.[0];
    matchesTitle.textContent = state.homeLeagueFilter && firstMatch
      ? firstMatch.competition
      : state.homeLeagueFilter
        ? state.homeLeagueName
        : "Partidos del día";
  }

  const filtered = (state.homeMatches || []).filter((m) => {
    const local = m.local || m.homeName || "";
    const visitante = m.visitante || m.awayName || "";
    const isLive = m.estado === "En juego" || m.statusType === "in" || m.isLive;
    return (!state.liveOnly || isLive) && bySearch(local, visitante);
  });

  if (!filtered.length) {
    matchesList.innerHTML = '<p class="empty">No hay partidos programados para esta fecha.</p>';
    return;
  }

  const groups = new Map();
  filtered.forEach((match) => {
    const key = `${match.competitionPriority}:${match.competition}`;
    if (!groups.has(key)) groups.set(key, { name: match.competition, items: [] });
    groups.get(key).items.push(match);
  });

  matchesList.innerHTML = [...groups.values()]
    .map((group) => `
      <section class="competition-group">
        <div class="competition-header">
          <span>${group.name}</span>
          <span>${group.items.length} partido${group.items.length === 1 ? "" : "s"}</span>
        </div>
        ${group.items.map((match) => matchCardHtml(match, match.statusType === "pre" ? "proximos" : "resultados")).join("")}
      </section>
    `)
    .join("");
}

// ==========================================
// EXPORTS
// ==========================================

export {
  matchCardHtml,
  groupByFecha,
  renderHomeMatches,
  renderMatches
};
