import { PLACEHOLDER_LOGO } from "./config.js";
import { normalize, fmtDateLong, fmtHour } from "./utils.js";

function getStatValue(stats, names) {
  const found = (stats || []).find((s) => names.includes(normalize(s.name)));
  const n = Number(found?.value ?? found?.displayValue ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function parseScoreboard(raw) {
  const all = (raw.events || [])
    .map((event) => {
      const comp = event.competitions?.[0];
      if (!comp?.competitors) return null;

      const home = comp.competitors.find((c) => c.homeAway === "home") || comp.competitors[0];
      const away = comp.competitors.find((c) => c.homeAway === "away") || comp.competitors[1];
      if (!home || !away) return null;

      const statusType = comp.status?.type?.state || "pre";
      const dateIso = comp.date || event.date;

      return {
        id: String(comp.id || event.id || `${home.team?.id || home.team?.displayName}-${away.team?.id || away.team?.displayName}`),
        local: home.team?.shortDisplayName || home.team?.displayName || "Local",
        localLogo: home.team?.logo || PLACEHOLDER_LOGO,
        visitante: away.team?.shortDisplayName || away.team?.displayName || "Visitante",
        visitanteLogo: away.team?.logo || PLACEHOLDER_LOGO,
        gl: Number(home.score || 0),
        gv: Number(away.score || 0),
        estado: statusType === "in" ? "En juego" : statusType === "post" ? "Final" : "Programado",
        statusType,
        detalle: comp.status?.type?.shortDetail || comp.status?.type?.description || "",
        date: dateIso,
        fecha: fmtDateLong(dateIso),
        hora: fmtHour(dateIso)
      };
    })
    .filter(Boolean);

  return {
    all,
    resultados: all.filter((m) => m.statusType !== "pre").sort((a, b) => new Date(b.date) - new Date(a.date)),
    proximos: all.filter((m) => m.statusType === "pre").sort((a, b) => new Date(a.date) - new Date(b.date))
  };
}

function normalizeZoneName(name) {
  const raw = String(name || "").trim();
  if (/group a/i.test(raw)) return "Zona A";
  if (/group b/i.test(raw)) return "Zona B";
  if (/group/i.test(raw)) return raw.replace(/group/i, "Zona");
  return raw;
}

function parseStandingsEntries(entries) {
  return (entries || [])
    .map((entry) => {
      const stats = entry.stats || [];
      const gf = getStatValue(stats, ["pointsfor"]);
      const gc = getStatValue(stats, ["pointsagainst"]);
      return {
        equipo: entry.team?.shortDisplayName || entry.team?.displayName || "Equipo",
        logo: entry.team?.logos?.[0]?.href || PLACEHOLDER_LOGO,
        pts: getStatValue(stats, ["points"]),
        pj: getStatValue(stats, ["gamesplayed"]),
        dg: getStatValue(stats, ["pointdifferential"]),
        gf,
        gc,
        rank: getStatValue(stats, ["rank"])
      };
    })
    .sort((a, b) => {
      if (a.rank && b.rank) return a.rank - b.rank;
      if (b.pts !== a.pts) return b.pts - a.pts;
      if (b.dg !== a.dg) return b.dg - a.dg;
      if (b.gf !== a.gf) return b.gf - a.gf;
      return a.equipo.localeCompare(b.equipo);
    });
}

function parseStandings(raw) {
  if (Array.isArray(raw.children) && raw.children.length) {
    const zonas = raw.children
      .map((child) => {
        const tabla = parseStandingsEntries(child.standings?.entries || []);
        if (!tabla.length) return null;
        return { nombre: normalizeZoneName(child.name || child.abbreviation || "Zona"), tabla };
      })
      .filter(Boolean);

    const seen = new Set();
    zonas.forEach((z) => {
      z.tabla = z.tabla.filter((r) => {
        const k = normalize(r.equipo);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    });

    return { zonas, tabla: zonas.flatMap((z) => z.tabla) };
  }

  const entries = raw.standings?.entries || (Array.isArray(raw.standings) ? raw.standings.flatMap((s) => s.entries || []) : []);
  const tabla = parseStandingsEntries(entries);
  return { zonas: tabla.length ? [{ nombre: "Tabla general", tabla }] : [], tabla };
}

// Suma pts/pj/dg/gf/gc de un mismo equipo a traves de varias tablas (por
// ejemplo Apertura + Clausura de un mismo anio, o de varios anios para
// promedios). Sirve tanto para la Tabla Anual (1 anio, 2 torneos) como para
// la Tabla de Promedios (3 anios, hasta 2 torneos cada uno).
function mergeStandingsTables(results) {
  const map = new Map();

  results.forEach((result) => {
    if (!result) return;
    (result.tabla || []).forEach((row) => {
      const key = normalize(row.equipo);
      if (!map.has(key)) {
        map.set(key, { equipo: row.equipo, logo: row.logo || PLACEHOLDER_LOGO, pts: 0, pj: 0, dg: 0, gf: 0, gc: 0 });
      }
      const acc = map.get(key);
      acc.pts += Number(row.pts || 0);
      acc.pj += Number(row.pj || 0);
      acc.dg += Number(row.dg || 0);
      acc.gf += Number(row.gf || 0);
      acc.gc += Number(row.gc || 0);
      if (acc.logo === PLACEHOLDER_LOGO && row.logo) acc.logo = row.logo;
    });
  });

  return [...map.values()].sort((a, b) => {
    if (b.pts !== a.pts) return b.pts - a.pts;
    if (b.dg !== a.dg) return b.dg - a.dg;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return a.equipo.localeCompare(b.equipo);
  });
}


function parseSummaryMatch(raw, fallbackMatchId) {
  const comp = raw?.header?.competitions?.[0] || raw?.competition || raw?.events?.[0]?.competitions?.[0];
  if (!comp?.competitors) return null;

  const home = comp.competitors.find((c) => c.homeAway === "home") || comp.competitors[0];
  const away = comp.competitors.find((c) => c.homeAway === "away") || comp.competitors[1];
  if (!home || !away) return null;

  const statusType = comp.status?.type?.state || "pre";
  const dateIso = comp.date || raw?.header?.competitions?.[0]?.date || raw?.eventDate || raw?.date;

  return {
    id: String(comp.id || fallbackMatchId || raw?.header?.id || raw?.id || ""),
    local: home.team?.shortDisplayName || home.team?.displayName || "Local",
    localLogo: home.team?.logo || PLACEHOLDER_LOGO,
    visitante: away.team?.shortDisplayName || away.team?.displayName || "Visitante",
    visitanteLogo: away.team?.logo || PLACEHOLDER_LOGO,
    gl: Number(home.score || 0),
    gv: Number(away.score || 0),
    estado: statusType === "in" ? "En juego" : statusType === "post" ? "Final" : "Programado",
    statusType,
    detalle: comp.status?.type?.shortDetail || comp.status?.type?.description || "",
    date: dateIso,
    fecha: fmtDateLong(dateIso),
    hora: fmtHour(dateIso)
  };
}


export { getStatValue, parseScoreboard, normalizeZoneName, parseStandingsEntries, parseStandings, mergeStandingsTables, parseSummaryMatch };
