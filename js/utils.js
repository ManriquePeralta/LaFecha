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

export { normalize, bySearch, toYmd, getDateRangeParam, fmtDateLong, fmtHour, noCacheFetch };