import { LEAGUE_CODE, SPLIT_SEASON_MIN_YEAR } from "./config.js";
import { normalize, noCacheFetch } from "./utils.js";
import { parseStandings } from "./api-parse.js";

function standingsBaseUrl(leagueCode, season, seasonTypeId) {
  const qs = seasonTypeId ? `&seasontype=${seasonTypeId}` : "";
  return `https://site.api.espn.com/apis/v2/sports/soccer/${leagueCode}/standings?season=${season}${qs}`;
}

function extractSeasonTypeName(raw) {
  return raw?.season?.type?.name || raw?.seasonType?.name || raw?.type?.name || raw?.name || "";
}

function tableFingerprint(parsed) {
  return (parsed.tabla || [])
    .map((r) => `${normalize(r.equipo)}:${r.pts}:${r.pj}`)
    .sort()
    .join("|");
}

function avgPj(parsed) {
  const rows = parsed.tabla || [];
  if (!rows.length) return 0;
  return rows.reduce((sum, r) => sum + Number(r.pj || 0), 0) / rows.length;
}

// No confiamos en un numero fijo de seasontype para distinguir Apertura de
// Clausura: la convencion estandar de ESPN (1/2/3 = pre/regular/postemporada)
// no aplica igual a un torneo partido en dos como el argentino. Probamos
// varios ids en paralelo y clasificamos con dos metodos, en orden:
//   1) el nombre que devuelve la propia respuesta (si viene informativo)
//   2) si no hay nombre util, comparamos partidos jugados: el torneo con
//      MENOS partidos en promedio es el que esta en curso (Clausura), el que
//      tiene MAS (cerca del total de fechas) es el que ya termino (Apertura).
// Si ambos ids devuelven exactamente la misma tabla, solo hay UN torneo
// disponible en esta fuente y lo clasificamos por cuan avanzado esta.
const seasonTypeCache = new Map();
const seasonTypeInFlight = new Map();

async function discoverSeasonTypes(category, season) {
  const key = `${category}:${season}`;
  if (seasonTypeCache.has(key)) return seasonTypeCache.get(key);
  if (seasonTypeInFlight.has(key)) return seasonTypeInFlight.get(key);

  const discoveryPromise = (async () => {
    const leagueCode = LEAGUE_CODE[category];
    const candidateIds = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, null];

    const result = {
      apertura: null,
      clausura: null,
      fallbackId: null,
      onlyOneAvailable: false,
      entries: []
    };

    try {
      const metaRes = await noCacheFetch(standingsBaseUrl(leagueCode, season, null));
      if (metaRes.ok) {
        const metaJson = await metaRes.json();
        const seasonEntry = (metaJson.seasons || []).find((s) => Number(s.year) === Number(season)) || metaJson.season || null;
        const seasonTypes = (seasonEntry?.types || []).filter((t) => t?.hasStandings);

        if (seasonTypes.length) {
          result.fallbackId = Number(seasonTypes[0].id);
          seasonTypes.forEach((type) => {
            const name = normalize(type.name || type.abbreviation || "");
            if (name.includes("apertura")) result.apertura = Number(type.id);
            else if (name.includes("clausura")) result.clausura = Number(type.id);
          });

          if (result.apertura === null && result.clausura === null && seasonTypes.length === 1) {
            const only = Number(seasonTypes[0].id);
            const onlyName = normalize(seasonTypes[0].name || seasonTypes[0].abbreviation || "");
            if (onlyName.includes("clausura")) result.clausura = only;
            else result.apertura = only;
            result.onlyOneAvailable = true;
          }
        }
      }
    } catch {
      // Si la metadata no responde, caemos al sondeo de ids como respaldo.
    }

    const probes = await Promise.all(
      candidateIds.map(async (id) => {
        try {
          const res = await noCacheFetch(standingsBaseUrl(leagueCode, season, id));
          if (!res.ok) return null;
          const json = await res.json();
          const parsed = parseStandings(json);
          if (!parsed.tabla.length) return null;
          return { id, name: extractSeasonTypeName(json), parsed };
        } catch {
          return null;
        }
      })
    );

    const valid = probes.filter(Boolean);
    result.entries = valid;
    if (result.fallbackId === null) result.fallbackId = valid[0]?.id ?? null;

    // Metodo 1: nombre informativo.
    valid.forEach((p) => {
      const n = normalize(p.name);
      if (n.includes("apertura")) result.apertura = p.id;
      else if (n.includes("clausura")) result.clausura = p.id;
    });

    // Metodo 2: si el nombre no sirvio, usamos partidos jugados sobre tablas
    // realmente distintas (deduplicadas por huella de datos).
    if (result.apertura === null && result.clausura === null && valid.length) {
      const distinctMap = new Map();
      valid.forEach((p) => {
        const fp = tableFingerprint(p.parsed);
        if (!distinctMap.has(fp)) distinctMap.set(fp, p);
      });
      const distinct = [...distinctMap.values()];

      if (distinct.length >= 2) {
        distinct.sort((a, b) => avgPj(a.parsed) - avgPj(b.parsed));
        result.clausura = distinct[0].id;
        result.apertura = distinct[distinct.length - 1].id;
      } else if (distinct.length === 1) {
        const only = distinct[0];
        const teamsCount = (only.parsed.tabla || []).length || 1;
        const roundsApprox = teamsCount - 1; // referencia: todos contra todos en la zona
        const pj = avgPj(only.parsed);
        result.onlyOneAvailable = true;
        if (pj > 0 && pj < roundsApprox * 0.6) {
          result.clausura = only.id;
        } else {
          result.apertura = only.id;
        }
      }
    }

    return result;
  })();

  // Cacheamos la promesa en vuelo para que llamados concurrentes (tabla
  // actual + anual/promedios pidiendo el mismo anio al mismo tiempo) reusen
  // el mismo sondeo en vez de disparar 5 fetches duplicados cada uno. El
  // resultado ya resuelto se guarda aparte para poder leerlo de forma
  // sincronica desde la UI (syncTorneoControls).
  seasonTypeInFlight.set(key, discoveryPromise);
  const result = await discoveryPromise;
  seasonTypeCache.set(key, result);
  seasonTypeInFlight.delete(key);
  return result;
}

async function fetchStandingsSafe(category, season, torneoKey) {
  const leagueCode = LEAGUE_CODE[category];
  const isSplit = category === "primera" && season >= SPLIT_SEASON_MIN_YEAR;

  if (!isSplit) {
    try {
      const res = await noCacheFetch(standingsBaseUrl(leagueCode, season, 1));
      if (!res.ok) return null;
      return parseStandings(await res.json());
    } catch {
      return null;
    }
  }

  const types = await discoverSeasonTypes(category, season);
  const seasonTypeId = types[torneoKey] ?? types.fallbackId;
  if (seasonTypeId === null || seasonTypeId === undefined) return null;

  const cached = types.entries.find((e) => e.id === seasonTypeId);
  if (cached) return cached.parsed;

  try {
    const res = await noCacheFetch(standingsBaseUrl(leagueCode, season, seasonTypeId));
    if (!res.ok) return null;
    return parseStandings(await res.json());
  } catch {
    return null;
  }
}

function summaryUrl(category, eventId) {
  return `https://site.api.espn.com/apis/site/v2/sports/soccer/${LEAGUE_CODE[category]}/summary?event=${eventId}`;
}

export { discoverSeasonTypes, fetchStandingsSafe, summaryUrl, seasonTypeCache };