// ==========================================
// RENDER DE PARTIDOS (ESPN)
// ==========================================
async function loadMatches(leagueCode) {
  const container = document.getElementById("matches-list");
  if (!container) return;
  container.innerHTML = '<p style="color: #888;">Cargando partidos...</p>';

  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${leagueCode}/scoreboard`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const events = data.events || [];

    if (!events.length) {
      container.innerHTML = '<p style="color: #888;">No hay partidos programados actualmente.</p>';
      return;
    }

    container.innerHTML = events.map(e => {
      const comp = e.competitions?.[0];
      const home = comp?.competitors?.find(c => c.homeAway === "home") || comp?.competitors?.[0];
      const away = comp?.competitors?.find(c => c.homeAway === "away") || comp?.competitors?.[1];

      const state = comp?.status?.type?.state; // "in" (vivo), "post" (final), "pre" (programado)
      const statusText = state === "in" ? "EN VIVO" : state === "post" ? "Finalizado" : new Date(e.date).toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });

      return `
        <div class="match-card">
          <span class="match-date">${new Date(e.date).toLocaleDateString("es-AR")} - ${statusText}</span>
          <div class="match-row">
            <div class="team-info">
              <img src="${home?.team?.logo || ''}" class="team-logo" alt="" />
              <span>${home?.team?.shortDisplayName || home?.team?.name || 'Local'}</span>
            </div>
            <div class="score-box">
              ${home?.score ?? '-'} : ${away?.score ?? '-'}
            </div>
            <div class="team-info away">
              <span>${away?.team?.shortDisplayName || away?.team?.name || 'Visitante'}</span>
              <img src="${away?.team?.logo || ''}" class="team-logo" alt="" />
            </div>
          </div>
        </div>
      `;
    }).join("");
  } catch (err) {
    console.error("Error al cargar partidos:", err);
    container.innerHTML = `<p style="color: #ff6b6b;">Error al conectar con los datos de partidos.</p>`;
  }
}

// ==========================================
// RENDER DE TABLA DE POSICIONES (ESPN)
// ==========================================
async function loadStandings(leagueCode) {
  const container = document.getElementById("standings-wrap");
  if (!container) return;
  container.innerHTML = '<p style="color: #888;">Cargando tabla...</p>';

  const url = `https://site.api.espn.com/apis/v2/sports/soccer/${leagueCode}/standings`;

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    const standingsGroup = data.children?.[0]?.standings || data.standings?.[0] || [];
    const entries = standingsGroup.entries || [];

    if (!entries.length) {
      container.innerHTML = '<p style="color: #888;">No hay datos de posiciones disponibles para este torneo.</p>';
      return;
    }

    const rows = entries.map((item, idx) => {
      const stats = item.stats || [];
      const getStat = (name) => stats.find(s => s.name === name)?.value ?? 0;

      return `
        <tr>
          <td>${idx + 1}</td>
          <td class="td-team">
            <img src="${item.team?.logos?.[0]?.href || ''}" width="18" height="18" alt="" /> 
            <span>${item.team?.shortDisplayName || item.team?.displayName}</span>
          </td>
          <td><strong>${getStat("points")}</strong></td>
          <td>${getStat("gamesPlayed")}</td>
          <td>${getStat("pointDifferential")}</td>
        </tr>
      `;
    }).join("");

    container.innerHTML = `
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th class="th-team">Equipo</th>
            <th>PTS</th>
            <th>PJ</th>
            <th>DG</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
  } catch (err) {
    console.error("Error al cargar tabla:", err);
    container.innerHTML = `<p style="color: #ff6b6b;">Sin datos de tabla para este formato de torneo.</p>`;
  }
}

// ==========================================
// CONTROL DE DESPLIEGUE Y EVENTOS
// ==========================================
function loadLeague(leagueCode) {
  loadMatches(leagueCode);
  loadStandings(leagueCode);
}

// Acordeón desplegable de Países
document.querySelectorAll(".accordion-header").forEach(header => {
  header.addEventListener("click", () => {
    const item = header.closest(".accordion-item");
    const isActive = item.classList.contains("active");

    document.querySelectorAll(".accordion-item").forEach(i => i.classList.remove("active"));
    if (!isActive) item.classList.add("active");
  });
});

// Botones de Ligas
document.querySelectorAll(".comp-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".comp-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    loadLeague(btn.dataset.league);
  });
});

// Carga inicial (Premier League por defecto)
loadLeague("eng.1");