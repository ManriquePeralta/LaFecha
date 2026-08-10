import { CURRENT_SEASON } from "./config.js";
import { state } from "./state.js";

function normalize(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function bySearch(teamA, teamB) {
  if (!state.search) return true;
  const needle = normalize(state.search);
  return normalize(teamA).includes(needle) || normalize(teamB || "").includes(needle);
}

function toYmd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

// Ventana acotada (una semana para atras, un mes para adelante). Un rango
// enorme (meses) puede hacer que el endpoint de ESPN devuelva datos
// truncados o inconsistentes; esta ventana es la que realmente le sirve a
// alguien mirando resultados recientes y proximos partidos.
function getDateRangeParam() {
  const now = new Date();
  const from = new Date(now);
  from.setDate(from.getDate() - 7);
  const to = new Date(now);
  to.setDate(to.getDate() + 30);
  return `${toYmd(from)}-${toYmd(to)}`;
}

function fmtDateLong(iso) {
  if (!iso) return "Fecha a confirmar";
  return new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "2-digit", month: "long" }).format(new Date(iso));
}

function fmtHour(iso) {
  if (!iso) return "--:--";
  return new Intl.DateTimeFormat("es-AR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

// Evita que el navegador (o una CDN intermedia) devuelva una respuesta de
// fetch cacheada. "cache: no-store" es la forma correcta de pedirlo desde
// fetch del browser (agregar headers custom tipo Cache-Control/Pragma desde
// el cliente puede disparar un preflight CORS que la API no siempre
// responde bien). El timestamp en la URL es un segundo cinturon de
// seguridad para CDNs que cachean por URL exacta.
function noCacheFetch(url, options = {}) {
  const sep = url.includes("?") ? "&" : "?";
  const bustedUrl = `${url}${sep}_=${Date.now()}`;
  return fetch(bustedUrl, { ...options, cache: "no-store" });
}
// Recalcula Puntos, Partidos Jugados y Diferencia de Gol en tiempo real
// Función para recalcular la tabla en tiempo real con los partidos en juego o recién terminados
function computeLiveStandings(baseTable, matches) {
  if (!Array.isArray(baseTable) || !baseTable.length) return [];
  if (!Array.isArray(matches) || !matches.length) return baseTable;

  try {
    const table = baseTable.map((item) => ({ ...item }));

    matches.forEach((m) => {
      // 1. Aceptamos partidos EN JUEGO y recién FINALIZADOS
      const isRelevant = m.estado === "FINAL" || m.estado === "EN JUEGO" || m.inPlay || m.status === "IN_PLAY";
      if (!isRelevant) return;

      const localName = m.local || m.equipoLocal || "";
      const visitName = m.visitante || m.equipoVisitante || "";
      if (!localName || !visitName) return;

      const localNorm = normalize(localName);
      const visitNorm = normalize(visitName);

      const teamLocal = table.find((t) => t.equipo && (normalize(t.equipo) === localNorm || normalize(t.equipo).includes(localNorm)));
      const teamVisit = table.find((t) => t.equipo && (normalize(t.equipo) === visitNorm || normalize(t.equipo).includes(visitNorm)));

      if (teamLocal && teamVisit) {
        // 2. CONTROL DE SEGURIDAD:
        // Si el partido está FINAL, pero la API base YA le actualizó el PJ a este equipo, NO le volvemos a sumar.
        // Solo sumamos si el partido terminó/está en juego Y los PJ de la tabla base están desfasados.
        const isLive = m.estado === "EN JUEGO" || m.inPlay || m.status === "IN_PLAY";
        
        // Si la API no le contó este partido en el PJ base (o si está en juego):
        if (isLive || m._unapplied) { 
          const gl = Number(m.gl ?? m.golesLocal ?? 0);
          const gv = Number(m.gv ?? m.golesVisitante ?? 0);

          if (gl > gv) {
            teamLocal.pts = (Number(teamLocal.pts) || 0) + 3;
          } else if (gv > gl) {
            teamVisit.pts = (Number(teamVisit.pts) || 0) + 3;
          } else {
            teamLocal.pts = (Number(teamLocal.pts) || 0) + 1;
            teamVisit.pts = (Number(teamVisit.pts) || 0) + 1;
          }

          teamLocal.pj = (Number(teamLocal.pj) || 0) + 1;
          teamLocal.dg = (Number(teamLocal.dg) || 0) + (gl - gv);
          teamVisit.dg = (Number(teamVisit.dg) || 0) + (gv - gl);
        }
      }
    });

    // Reordenar por PTS y DG
    return table.sort((a, b) => {
      const ptsA = Number(a.pts) || 0;
      const ptsB = Number(b.pts) || 0;
      if (ptsB !== ptsA) return ptsB - ptsA;

      const dgA = Number(a.dg) || 0;
      const dgB = Number(b.dg) || 0;
      if (dgB !== dgA) return dgB - dgA;

      return String(a.equipo || "").localeCompare(String(b.equipo || ""));
    });
  } catch (err) {
    console.error("Error calculando tabla en vivo:", err);
    return baseTable;
  }
}
export { normalize, bySearch, toYmd, getDateRangeParam, fmtDateLong, fmtHour, noCacheFetch, computeLiveStandings };