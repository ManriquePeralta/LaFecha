// cup-loader.js

// 1. Extraer las tablas de posiciones por Grupo (ej: Libertadores, Sudamericana, Champions)
export function parseCupGroups(raw) {
  const groupsData = raw?.children || [];
  
  if (!groupsData.length) return [];

  return groupsData.map((group) => {
    const groupName = group?.name || group?.abbreviation || "Grupo";
    const entries = group?.standings?.entries || [];

    const teams = entries.map((entry) => {
      const stats = entry?.stats || [];
      const getStat = (name) => stats.find((s) => s.name === name)?.value || 0;

      return {
        teamName: entry?.team?.displayName || "",
        logo: entry?.team?.logos?.[0]?.href || "",
        points: getStat("points"),
        played: getStat("gamesPlayed"),
        gd: getStat("pointDifferential")
      };
    });

    return {
      groupName,
      teams
    };
  });
}

// 2. Renderizar las minitablas HTML de cada grupo
export function renderCupGroupsHtml(groups) {
  if (!groups.length) return '<p class="empty-inline">No hay datos de grupos disponibles.</p>';

  return groups
    .map((g) => `
      <div class="cup-group-card">
        <h4 class="group-title">${g.groupName}</h4>
        <table class="standings-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Equipo</th>
              <th>PTS</th>
              <th>PJ</th>
              <th>DG</th>
            </tr>
          </thead>
          <tbody>
            ${g.teams.map((t, idx) => `
              <tr>
                <td>${idx + 1}</td>
                <td class="team-cell">
                  <img src="${t.logo}" class="team-logo" alt="" />
                  <span>${t.teamName}</span>
                </td>
                <td><strong>${t.points}</strong></td>
                <td>${t.played}</td>
                <td>${t.gd > 0 ? `+${t.gd}` : t.gd}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    `).join("");
}