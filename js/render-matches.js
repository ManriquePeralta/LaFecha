import { PLACEHOLDER_LOGO } from "./config.js";
import { db, state } from "./state.js";
import { matchesTitle, matchesList } from "./dom.js";
import { bySearch } from "./utils.js";

function matchCardHtml(m, view) {
  if (view === "resultados") {
    const badgeClass = m.estado === "En juego" ? "badge-live" : m.estado === "Final" ? "badge-final" : "badge-scheduled";
    return `
      <article class="match-card clickable ${m.estado === "En juego" ? "live" : ""}" data-match-id="${m.id}" tabindex="0" role="button" aria-label="Ver detalle del partido">
        <p class="teams teams-line">
          <span class="team-with-logo"><img class="team-logo" src="${m.localLogo || PLACEHOLDER_LOGO}" alt="" /><strong>${m.local}</strong></span>
          <span class="vs">vs</span>
          <span class="team-with-logo"><img class="team-logo" src="${m.visitanteLogo || PLACEHOLDER_LOGO}" alt="" /><strong>${m.visitante}</strong></span>
        </p>
        <p class="meta">${m.gl} - ${m.gv} <span class="status ${badgeClass}">${m.estado}</span> <span class="detail">${m.hora}</span></p>
      </article>
    `;
  }

  return `
    <article class="match-card clickable" data-match-id="${m.id}" tabindex="0" role="button" aria-label="Ver detalle del partido">
      <p class="teams teams-line">
        <span class="team-with-logo"><img class="team-logo" src="${m.localLogo || PLACEHOLDER_LOGO}" alt="" /><strong>${m.local}</strong></span>
        <span class="vs">vs</span>
        <span class="team-with-logo"><img class="team-logo" src="${m.visitanteLogo || PLACEHOLDER_LOGO}" alt="" /><strong>${m.visitante}</strong></span>
      </p>
      <p class="meta">${m.hora} <span class="status badge-scheduled">Programado</span> ${m.detalle ? `<span class="detail">${m.detalle}</span>` : ""}</p>
    </article>
  `;
}

function groupByFecha(matches) {
  const groups = [];
  let lastFecha = null;
  matches.forEach((m) => {
    if (m.fecha !== lastFecha) {
      lastFecha = m.fecha;
      groups.push({ fecha: m.fecha, items: [] });
    }
    groups[groups.length - 1].items.push(m);
  });
  return groups;
}

function renderMatches() {
  const liga = db[state.category];
  const source = liga[state.view] || [];

  matchesTitle.textContent = state.view === "resultados" ? "Resultados" : state.view === "proximos" ? "Proximos" : "Resumen";

  if (state.view === "tabla") {
    matchesList.innerHTML = '<article class="empty">Selecciona Resultados o Proximos para ver partidos.</article>';
    return;
  }

  const filtered = source.filter((m) => {
    const liveOk = !state.liveOnly || m.estado === "En juego";
    return liveOk && bySearch(m.local, m.visitante);
  });

  if (!filtered.length) {
    matchesList.innerHTML = '<article class="empty">No hay partidos en la API para ese filtro.</article>';
    return;
  }

  const groups = groupByFecha(filtered);

  matchesList.innerHTML = groups
    .map(
      (g) => `
        <div class="day-divider">
          <span class="day-label">${g.fecha}</span>
          <span class="day-count">${g.items.length} partido${g.items.length === 1 ? "" : "s"}</span>
        </div>
        ${g.items.map((m) => matchCardHtml(m, state.view)).join("")}
      `
    )
    .join("");
}

export { matchCardHtml, groupByFecha, renderMatches };