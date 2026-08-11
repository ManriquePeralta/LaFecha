import { PLACEHOLDER_LOGO } from "./config.js";
import { normalize, fmtDateLong, fmtHour } from "./utils.js";

function getStatValue(stats, names) {
  const found = (stats || []).find((s) =>
    names.includes(normalize(s.name))
  );

  const n = Number(
    found?.value ??
    found?.displayValue ??
    0
  );

  return Number.isFinite(n) ? n : 0;
}


// ==========================================
// OBTENER RELOJ DEL PARTIDO
// ==========================================

function getGameClock(status) {
  if (!status) {
    return {
      minuto: 0,
      segundo: 0,
      tiempoJuego: null
    };
  }

  // ==========================================
  // 1. ESPN puede mandar "24:10" directamente
  // ==========================================

  const displayClock =
    status.displayClock ??
    status.type?.displayClock ??
    null;

  if (displayClock) {
    const match = String(displayClock)
      .trim()
      .match(/^(\d+):(\d+)$/);

    if (match) {
      const minuto = Number(match[1]);
      const segundo = Number(match[2]);

      return {
        minuto,
        segundo,
        tiempoJuego:
          `${minuto}:${String(segundo).padStart(2, "0")}`
      };
    }
  }


  // ==========================================
  // 2. ESPN puede mandar "clock" en segundos
  //
  // Ejemplo:
  // clock: 1450
  //
  // 1450 / 60 = 24 minutos
  // 1450 % 60 = 10 segundos
  //
  // Resultado: 24:10
  // ==========================================

// ==========================================
// 2. ESPN puede mandar "clock" como minutos
//    con decimales.
//
//    Ejemplo:
//    clock: 24.166666
//
//    24 minutos + 0.166666 minutos
//    = 24 minutos + 10 segundos
//
//    También contemplamos que pueda venir
//    directamente en segundos.
// ==========================================

const clock =
  status.clock ??
  status.type?.clock ??
  null;

if (
  clock !== null &&
  clock !== undefined &&
  clock !== ""
) {
  const numericClock = Number(clock);

  if (
    Number.isFinite(numericClock) &&
    numericClock >= 0
  ) {

    let minuto;
    let segundo;

    /*
     * Si es un número grande, lo tratamos
     * como segundos.
     *
     * Ejemplo:
     * 1450 → 24:10
     */
    if (numericClock >= 120) {

      minuto =
        Math.floor(numericClock / 60);

      segundo =
        Math.floor(numericClock % 60);

    } else {

      /*
       * Si es menor a 120, ESPN puede estar
       * expresándolo como minutos decimales.
       *
       * 24.166666
       *
       * parte entera = 24 minutos
       * parte decimal × 60 = 9.9999 segundos
       */
      minuto =
        Math.floor(numericClock);

      segundo =
        Math.floor(
          (numericClock - minuto) * 60
        );
    }

    return {
      minuto,
      segundo,
      tiempoJuego:
        `${minuto}:${String(segundo).padStart(2, "0")}`
    };
  }
}


  // ==========================================
  // 3. No encontramos el reloj
  // ==========================================

  return {
    minuto: 0,
    segundo: 0,
    tiempoJuego: null
  };
}

// Helper para garantizar que el logo de ESPN cargue bien siempre
function getTeamLogoUrl(team) {
  if (team?.logos?.[0]?.href) return team.logos[0].href;
  if (team?.logo) return team.logo;
  if (team?.id) return `https://a.espncdn.com/i/teamlogos/soccer/500/${team.id}.png`;
  return PLACEHOLDER_LOGO;
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
      const gameClock = getGameClock(comp.status);

      return {
        id: String(comp.id || event.id || `${home.team?.id}-${away.team?.id}`),
        local: home.team?.shortDisplayName || home.team?.displayName || "Local",
        localLogo: getTeamLogoUrl(home.team),
        visitante: away.team?.shortDisplayName || away.team?.displayName || "Visitante",
        visitanteLogo: getTeamLogoUrl(away.team),
        gl: Number(home.score || 0),
        gv: Number(away.score || 0),
        estado: statusType === "in" ? "En juego" : statusType === "post" ? "Final" : "Programado",
        statusType,
        detalle: comp.status?.type?.shortDetail || comp.status?.type?.description || "",
        minuto: gameClock.minuto,
        segundo: gameClock.segundo,
        minutoJuego: gameClock.minuto,
        segundoJuego: gameClock.segundo,
        tiempoJuego: gameClock.tiempoJuego,
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

function parseSummaryMatch(raw, fallbackMatchId) {
  const comp = raw?.header?.competitions?.[0] || raw?.competition || raw?.events?.[0]?.competitions?.[0];
  if (!comp?.competitors) return null;

  const home = comp.competitors.find((c) => c.homeAway === "home") || comp.competitors[0];
  const away = comp.competitors.find((c) => c.homeAway === "away") || comp.competitors[1];

  if (!home || !away) return null;

  const statusType = comp.status?.type?.state || "pre";
  const dateIso = comp.date || raw?.header?.competitions?.[0]?.date || raw?.eventDate || raw?.date;
  const gameClock = getGameClock(comp.status);

  return {
    id: String(comp.id || fallbackMatchId || raw?.header?.id || raw?.id || ""),
    local: home.team?.shortDisplayName || home.team?.displayName || "Local",
    localLogo: getTeamLogoUrl(home.team),
    visitante: away.team?.shortDisplayName || away.team?.displayName || "Visitante",
    visitanteLogo: getTeamLogoUrl(away.team),
    gl: Number(home.score || 0),
    gv: Number(away.score || 0),
    estado: statusType === "in" ? "En juego" : statusType === "post" ? "Final" : "Programado",
    statusType,
    detalle: comp.status?.type?.shortDetail || comp.status?.type?.description || "",
    minuto: gameClock.minuto,
    segundo: gameClock.segundo,
    minutoJuego: gameClock.minuto,
    segundoJuego: gameClock.segundo,
    tiempoJuego: gameClock.tiempoJuego,
    date: dateIso,
    fecha: fmtDateLong(dateIso),
    hora: fmtHour(dateIso)
  };
}


function normalizeZoneName(name) {
  const raw =
    String(name || "").trim();

  if (/group a/i.test(raw)) {
    return "Zona A";
  }

  if (/group b/i.test(raw)) {
    return "Zona B";
  }

  if (/group/i.test(raw)) {
    return raw.replace(
      /group/i,
      "Zona"
    );
  }

  return raw;
}


function parseStandingsEntries(entries) {
  return (entries || [])
    .map((entry) => {
      const stats =
        entry.stats || [];

      const gf =
        getStatValue(
          stats,
          ["pointsfor"]
        );

      const gc =
        getStatValue(
          stats,
          ["pointsagainst"]
        );

      return {
        equipo:
          entry.team?.shortDisplayName ||
          entry.team?.displayName ||
          "Equipo",

        logo:
          entry.team?.logos?.[0]?.href ||
          PLACEHOLDER_LOGO,

        pts:
          getStatValue(
            stats,
            ["points"]
          ),

        pj:
          getStatValue(
            stats,
            ["gamesplayed"]
          ),

        dg:
          getStatValue(
            stats,
            ["pointdifferential"]
          ),

        gf,
        gc,

        rank:
          getStatValue(
            stats,
            ["rank"]
          )
      };
    })
    .sort((a, b) => {
      if (a.rank && b.rank) {
        return a.rank - b.rank;
      }

      if (b.pts !== a.pts) {
        return b.pts - a.pts;
      }

      if (b.dg !== a.dg) {
        return b.dg - a.dg;
      }

      if (b.gf !== a.gf) {
        return b.gf - a.gf;
      }

      return a.equipo.localeCompare(
        b.equipo
      );
    });
}


function parseStandings(raw) {
  if (
    Array.isArray(raw.children) &&
    raw.children.length
  ) {
    const zonas =
      raw.children
        .map((child) => {
          const tabla =
            parseStandingsEntries(
              child.standings?.entries || []
            );

          if (!tabla.length) {
            return null;
          }

          return {
            nombre:
              normalizeZoneName(
                child.name ||
                child.abbreviation ||
                "Zona"
              ),

            tabla
          };
        })
        .filter(Boolean);


    const seen =
      new Set();

    zonas.forEach((z) => {
      z.tabla =
        z.tabla.filter((r) => {
          const k =
            normalize(r.equipo);

          if (seen.has(k)) {
            return false;
          }

          seen.add(k);
          return true;
        });
    });


    return {
      zonas,
      tabla:
        zonas.flatMap(
          (z) => z.tabla
        )
    };
  }


  const entries =
    raw.standings?.entries ||
    (
      Array.isArray(raw.standings)
        ? raw.standings.flatMap(
            (s) => s.entries || []
          )
        : []
    );


  const tabla =
    parseStandingsEntries(entries);


  return {
    zonas:
      tabla.length
        ? [
            {
              nombre:
                "Tabla general",
              tabla
            }
          ]
        : [],

    tabla
  };
}


// Suma pts/pj/dg/gf/gc de un mismo equipo a traves de varias tablas.
function mergeStandingsTables(results) {
  const map =
    new Map();

  results.forEach((result) => {
    if (!result) return;

    (result.tabla || [])
      .forEach((row) => {
        const key =
          normalize(row.equipo);

        if (!map.has(key)) {
          map.set(key, {
            equipo: row.equipo,
            logo:
              row.logo ||
              PLACEHOLDER_LOGO,

            pts: 0,
            pj: 0,
            dg: 0,
            gf: 0,
            gc: 0
          });
        }

        const acc =
          map.get(key);

        acc.pts +=
          Number(row.pts || 0);

        acc.pj +=
          Number(row.pj || 0);

        acc.dg +=
          Number(row.dg || 0);

        acc.gf +=
          Number(row.gf || 0);

        acc.gc +=
          Number(row.gc || 0);

        if (
          acc.logo === PLACEHOLDER_LOGO &&
          row.logo
        ) {
          acc.logo = row.logo;
        }
      });
  });


  return [...map.values()]
    .sort((a, b) => {
      if (b.pts !== a.pts) {
        return b.pts - a.pts;
      }

      if (b.dg !== a.dg) {
        return b.dg - a.dg;
      }

      if (b.gf !== a.gf) {
        return b.gf - a.gf;
      }

      return a.equipo.localeCompare(
        b.equipo
      );
    });
}





export {
  getStatValue,
  parseScoreboard,
  normalizeZoneName,
  parseStandingsEntries,
  parseStandings,
  mergeStandingsTables,
  parseSummaryMatch,
  getGameClock
};
