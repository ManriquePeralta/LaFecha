import { PLACEHOLDER_LOGO } from "./config.js";
import { db, state } from "./state.js";
import { matchesTitle, matchesList } from "./dom.js";
import { bySearch } from "./utils.js";


// ==========================================
// HTML DE CADA PARTIDO
// ==========================================

function matchCardHtml(m, view) {

  // ========================================
  // RESULTADOS
  // ========================================

  if (view === "resultados") {

    const isLive =
      m.estado === "En juego" ||
      m.estado === "EN JUEGO" ||
      m.estado === "En vivo" ||
      m.estado === "EN VIVO" ||
      m.status === "LIVE" ||
      m.status === "IN_PLAY";

    const isFinal =
      m.estado === "Final" ||
      m.estado === "FINAL" ||
      m.status === "COMPLETED";


    const badgeClass =
      isLive
        ? "badge-live"
        : isFinal
          ? "badge-final"
          : "badge-scheduled";


    let liveTime = "";

    if (isLive) {
      if (m.tiempoJuego) {
        liveTime = `<span class="live-time">${m.tiempoJuego}</span>`;
      } else {
        const minute =
          m.minuto ??
          m.minute ??
          m.elapsed ??
          m.min ??
          null;

        const second =
          m.segundo ??
          m.second ??
          m.seconds ??
          0;

        if (minute !== null) {
          liveTime = `<span class="live-time">${minute}:${String(second).padStart(2, "0")}</span>`;
        } else {
          liveTime = `<span class="live-time">EN VIVO</span>`;
        }
      }
    }


    const statusText =
      isLive
        ? `EN VIVO${liveTime ? ` · ${liveTime}` : ""}`
        : m.estado;


    return `
      <article
        class="match-card clickable ${isLive ? "live" : ""}"
        data-match-id="${m.id}"
        tabindex="0"
        role="button"
        aria-label="Ver detalle del partido"
      >

        <p class="teams teams-line">

          <span class="team-with-logo team-link" data-team-name="${m.local}">
            <img
              class="team-logo"
              src="${m.localLogo || PLACEHOLDER_LOGO}"
              alt=""
            />
            <strong>${m.local}</strong>
          </span>

          <span class="vs">
            vs
          </span>

          <span class="team-with-logo team-link" data-team-name="${m.visitante}">
            <img
              class="team-logo"
              src="${m.visitanteLogo || PLACEHOLDER_LOGO}"
              alt=""
            />
            <strong>${m.visitante}</strong>
          </span>

        </p>

        <p class="meta">

          <strong>
            ${m.gl} - ${m.gv}
          </strong>

          <span class="status ${badgeClass}">
            ${statusText}
          </span>

          ${
            !isLive && m.hora
              ? `<span class="detail">${m.hora}</span>`
              : ""
          }

        </p>

      </article>
    `;
  }


  // ========================================
  // PRÓXIMOS PARTIDOS
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

        <span class="team-with-logo team-link" data-team-name="${m.local}">
          <img
            class="team-logo"
            src="${m.localLogo || PLACEHOLDER_LOGO}"
            alt=""
          />
          <strong>${m.local}</strong>
        </span>

        <span class="vs">
          vs
        </span>

        <span class="team-with-logo team-link" data-team-name="${m.visitante}">
          <img
            class="team-logo"
            src="${m.visitanteLogo || PLACEHOLDER_LOGO}"
            alt=""
          />
          <strong>${m.visitante}</strong>
        </span>

      </p>

      <p class="meta">

        ${m.hora}

        <span class="status badge-scheduled">
          Programado
        </span>

        ${
          m.detalle
            ? m.detalle
            : ""
        }

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

    if (m.fecha !== lastFecha) {

      lastFecha = m.fecha;

      groups.push({
        fecha: m.fecha,
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

  const liga =
    db[state.category];

  const source =
    liga[state.view] || [];


  // ========================================
  // TÍTULO
  // ========================================

  matchesTitle.textContent =
    state.view === "resultados"
      ? "Resultados"
      : state.view === "proximos"
        ? "Proximos"
        : "Resumen";


  // ========================================
  // TABLA
  // ========================================

  if (state.view === "tabla") {

    matchesList.innerHTML =
      "Selecciona Resultados o Proximos para ver partidos.";

    return;
  }


  // ========================================
  // FILTROS
  // ========================================

  const filtered =
    source.filter((m) => {

      const liveOk =
        !state.liveOnly ||
        m.estado === "En juego" ||
        m.estado === "EN JUEGO" ||
        m.estado === "En vivo" ||
        m.estado === "EN VIVO" ||
        m.status === "LIVE" ||
        m.status === "IN_PLAY";

      return (
        liveOk &&
        bySearch(
          m.local,
          m.visitante
        )
      );
    });


  // ========================================
  // SIN PARTIDOS
  // ========================================

  if (!filtered.length) {

    matchesList.innerHTML =
      "No hay partidos en la API para ese filtro.";

    return;
  }


  // ========================================
  // AGRUPAR
  // ========================================

  const groups =
    groupByFecha(filtered);


  // ========================================
  // RENDER
  // ========================================

  matchesList.innerHTML =
    groups
      .map(
        (g) => `
          <div class="day-divider">

            <span class="day-label">
              ${g.fecha}
            </span>

            <span class="day-count">
              ${g.items.length}
              partido${g.items.length === 1 ? "" : "s"}
            </span>

          </div>

          ${g.items
            .map((m) =>
              matchCardHtml(
                m,
                state.view
              )
            )
            .join("")}
        `
      )
      .join("");
}


// ==========================================
// EXPORTS
// ==========================================

export {
  matchCardHtml,
  groupByFecha,
  renderMatches
};