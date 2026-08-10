import { PLACEHOLDER_LOGO, CURRENT_SEASON, SPLIT_SEASON_MIN_YEAR } from "./config.js";
import { db, state } from "./state.js";
import { standingsSections, playoffList, playoffBox, annualBody, averagesBody, annualBox, averagesBox, $, isDetailPage } from "./dom.js";
import { bySearch, normalize } from "./utils.js";
import { seasonTypeCache } from "./season-types.js";
import { renderMatches } from "./render-matches.js";

function findCrossMatch(teamA, teamB, allMatches) {
  const nA = normalize(teamA);
  const nB = normalize(teamB);
  const sameTeam = (x, y) => x === y || x.includes(y) || y.includes(x);

  return (allMatches || []).find((m) => {
    const l = normalize(m.local);
    const v = normalize(m.visitante);
    return (sameTeam(l, nA) && sameTeam(v, nB)) || (sameTeam(l, nB) && sameTeam(v, nA));
  });
}

function annualRowClass(pos, len) {
  if (pos === 1) return "row-leader";
  if (pos >= 2 && pos <= 4) return "row-libertadores";
  if (pos >= 5 && pos <= 10) return "row-sudamericana";
  if (pos === len) return "row-descenso";
  return "";
}

function torneoLabel(torneoKey) {
  return torneoKey === "clausura" ? "Clausura" : "Apertura";
}

function updateTableContext() {
  const contextEl = $("#table-context");
  if (!contextEl) return;
  if (state.category !== "primera") {
    contextEl.textContent = `Temporada ${state.season}`;
    return;
  }
  const isSplit = state.season >= SPLIT_SEASON_MIN_YEAR;
  if (!isSplit) {
    contextEl.textContent = `Temporada ${state.season}`;
    return;
  }

  const discovered = seasonTypeCache.get(`${state.category}:${state.season}`);
  let text = `Torneo ${torneoLabel(state.torneo)} ${state.season}`;
  if (discovered?.onlyOneAvailable) {
    const otherTorneo = state.torneo === "apertura" ? "Clausura" : "Apertura";
    text += ` (el ${otherTorneo} no esta disponible por separado en esta fuente todavia)`;
  }
  contextEl.textContent = text;
}

function renderStandingsAndCrosses() {
  updateTableContext();
  const liga = db[state.category];
  const zonasRaw = Array.isArray(liga.zonas) && liga.zonas.length ? liga.zonas : [{ nombre: "Tabla general", tabla: liga.tabla || [] }];

  const zonas = zonasRaw
    .map((z) => ({ nombre: z.nombre, tabla: (z.tabla || []).filter((r) => bySearch(r.equipo)) }))
    .filter((z) => z.tabla.length);

  if (!zonas.length) {
    standingsSections.innerHTML = '<article class="empty">No hay tabla disponible en la API para esta categoria.</article>';
    playoffList.innerHTML = '<article class="empty">Sin cruces para mostrar.</article>';
    return zonasRaw;
  }

  standingsSections.innerHTML = zonas
    .map((zona) => {
      const rows = zona.tabla
        .map((row, idx) => {
          const pos = row.rank || idx + 1;
          const rowClass = pos <= 8 ? "playoff" : "";
          return `
            <tr class="${rowClass}">
              <td>${pos}</td>
              <td><span class="team-with-logo"><img class="team-logo" src="${row.logo || PLACEHOLDER_LOGO}" alt="" />${row.equipo}</span></td>
              <td class="cell-pts">${row.pts}</td>
              <td>${row.pj}</td>
              <td>${row.dg > 0 ? "+" : ""}${row.dg}</td>
            </tr>
          `;
        })
        .join("");

      return `
        <section class="zone-block">
          <h3 class="sub-title">${zona.nombre}</h3>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Equipo</th>
                  <th>PTS</th>
                  <th>PJ</th>
                  <th>DG</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
        </section>
      `;
    })
    .join("");

  if (state.category !== "primera" || state.season !== CURRENT_SEASON) {
    playoffBox.style.display = "none";
    return zonasRaw;
  }

  playoffBox.style.display = "block";
  const zoneA = zonasRaw.find((z) => /a/i.test(z.nombre)) || zonasRaw[0];
  const zoneB = zonasRaw.find((z) => /b/i.test(z.nombre) && z !== zoneA) || zonasRaw[1];

  // El cruce cruzado (mejor de una zona vs peor de la otra) necesita dos zonas
  // con al menos 2 equipos cada una. Ya no exigimos exactamente 8: se adapta
  // al tamano real de las zonas que devuelva la API para este torneo/temporada.
  if (!zoneA?.tabla?.length || !zoneB?.tabla?.length || zoneA.tabla.length < 2 || zoneB.tabla.length < 2) {
    playoffList.innerHTML = '<article class="empty">No hay zonas completas para proyectar cruces.</article>';
    return zonasRaw;
  }

  const crossSize = Math.min(8, zoneA.tabla.length, zoneB.tabla.length);
  const half = Math.floor(crossSize / 2);

  if (half < 1) {
    playoffList.innerHTML = '<article class="empty">No hay suficientes equipos para proyectar cruces.</article>';
    return zonasRaw;
  }

  const a = zoneA.tabla.slice(0, crossSize);
  const b = zoneB.tabla.slice(0, crossSize);
  const allMatches = liga.allMatches || [];

  const rawCrosses = [];
  for (let i = 0; i < half; i++) rawCrosses.push([a[i], b[crossSize - 1 - i]]);
  for (let i = 0; i < half; i++) rawCrosses.push([b[i], a[crossSize - 1 - i]]);

  const crosses = rawCrosses.filter(([l, v]) => bySearch(l.equipo, v.equipo));

  playoffList.innerHTML = crosses
    .map(([local, visitante]) => {
      const current = findCrossMatch(local.equipo, visitante.equipo, allMatches);
      const marker = current ? `${current.gl}-${current.gv} (${current.estado})` : "Sin partido cargado";
      return `
        <article class="cross-card">
          <p class="teams"><strong>${local.equipo}</strong> vs <strong>${visitante.equipo}</strong></p>
          <p class="meta">${marker}</p>
        </article>
      `;
    })
    .join("");

  return zonasRaw;
}

function renderAnnualAndAverages() {
  const liga = db[state.category];

  if (!annualBox || !averagesBox) return;

  if (state.category !== "primera") {
    annualBox.style.display = "none";
    averagesBox.style.display = "none";
    return;
  }

  annualBox.style.display = "block";
  averagesBox.style.display = "block";

  const annual = (liga.annual || []).filter((r) => bySearch(r.equipo));
  const annualLen = annual.length;

  annualBody.innerHTML = annual
    .map((r, idx) => {
      const pos = idx + 1;
      return `
        <tr class="${annualRowClass(pos, annualLen)}">
          <td>${pos}</td>
          <td><span class="team-with-logo"><img class="team-logo" src="${r.logo || PLACEHOLDER_LOGO}" alt="" />${r.equipo}</span></td>
          <td class="cell-pts">${r.pts}</td>
          <td>${r.pj}</td>
          <td>${r.dg > 0 ? "+" : ""}${r.dg}</td>
        </tr>
      `;
    })
    .join("");

  const avg = (liga.averages || []).filter((r) => bySearch(r.equipo));
  const avgLen = avg.length;

  averagesBody.innerHTML = avg
    .map((r, idx) => {
      const pos = idx + 1;
      return `
        <tr class="${annualRowClass(pos, avgLen)}">
          <td>${pos}</td>
          <td><span class="team-with-logo"><img class="team-logo" src="${r.logo || PLACEHOLDER_LOGO}" alt="" />${r.equipo}</span></td>
          <td class="cell-pts">${r.pts}</td>
          <td>${r.pj}</td>
          <td>${r.prom.toFixed(3)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderAll() {
  if (isDetailPage) return;
  renderMatches();
  renderStandingsAndCrosses();
  renderAnnualAndAverages();
}

export { findCrossMatch, annualRowClass, torneoLabel, updateTableContext, renderStandingsAndCrosses, renderAnnualAndAverages, renderAll };