// ── Config ─────────────────────────────────────────
const SHEET_ID = '1bVZCJROYXizZ2KNMu8QSSzBMef2NlxYkwlKRmkixEaM';
const MAX_WEEKS = 30;

// ── Team colours ──────────────────────────────────
const TEAM_COLORS = {
  'The (C)amp Town Ladies': '#e74c3c',
  'Urawa Red Simons': '#ff6b6b',
  'Wardynamo Kyiv': '#2ecc71',
  'Bolton Fondlers': '#27ae60',
  'Boltom Fondlers': '#27ae60',
  'Levski SOFia': '#e67e22',
  'eBBFleet United': '#1abc9c',
  'Torkey': '#f39c12',
  'Wender Bremban': '#3498db',
  'Rob Robi Mikel': '#95a5a6',
  'Inter MilAndy': '#2980b9',
  'GazzatasaJay': '#9b59b6',
  'Glennoble Foot 38': '#636e72',
  'AC MilAnthony': '#e84393',
  'Pabloca Juniors': '#0984e3',
  'Diogo Jota20 FC': '#fdcb6e',
  'Peter Griffinternazionale': '#6c5ce7',
  'Peter GriffInternazionale': '#6c5ce7',
};

function teamColor(name) {
  return TEAM_COLORS[name] || '#58a6ff';
}

// ── Google Sheets fetch ───────────────────────────
async function fetchSheet(sheetName) {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}`;
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(resp.status);
  const text = await resp.text();
  const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*?)\);?$/);
  if (!match) throw new Error('Bad response');
  return JSON.parse(match[1]).table;
}

function cellVal(cell) {
  return cell ? (cell.v ?? '') : '';
}

// ── Parsers ───────────────────────────────────────
function parseTable(table) {
  return table.rows.map(r => {
    const c = r.c.map(cellVal);
    return {
      pos: c[0],
      club: c[1],
      pl: Number(c[2]) || 0,
      w: Number(c[3]) || 0,
      d: Number(c[4]) || 0,
      l: Number(c[5]) || 0,
      f: Number(c[6]) || 0,
      a: Number(c[7]) || 0,
      gd: Number(c[8]) || 0,
      pts: Number(c[9]) || 0,
      form: [c[10], c[11], c[12], c[13], c[14]].filter(v => 'WDL'.includes(v)),
    };
  });
}

function parseWeek(table, teamSet) {
  const matches = [];
  let current = null;
  for (const row of table.rows) {
    const c = row.c.map(cellVal);
    const col0 = String(c[0]).trim();
    const col4 = String(c[4]).trim();
    if (col0 && col4 && teamSet.has(col0) && teamSet.has(col4)) {
      current = {
        home: col0,
        hScore: Number(c[1]),
        away: col4,
        aScore: Number(c[3]),
        homeScorers: [],
        awayScorers: [],
      };
      matches.push(current);
    } else if (current && col0) {
      const hGoals = Number(c[1]) || 0;
      const aGoals = Number(c[3]) || 0;
      if (hGoals > 0) current.homeScorers.push({ name: col0, goals: hGoals });
      if (aGoals > 0 && col4) current.awayScorers.push({ name: col4, goals: aGoals });
    }
  }
  const allZero = matches.every(m => m.hScore === 0 && m.aScore === 0);
  const noScorers = matches.every(m => m.homeScorers.length === 0 && m.awayScorers.length === 0);
  if (allZero && noScorers && matches.length > 0) {
    matches.forEach(m => { m.hScore = null; m.aScore = null; });
  }
  return matches;
}

function parsePlayerList(table) {
  return table.rows.map(r => {
    const c = r.c.map(cellVal);
    return {
      name: String(c[0]).trim(),
      total: Number(c[1]) || 0,
      team: String(c[2]).trim(),
    };
  }).filter(p => p.name && p.total > 0);
}

function parseSquads(table) {
  const squads = [];
  for (let i = 1; i < table.rows.length; i++) {
    const c = table.rows[i].c.map(cellVal);
    const team = String(c[0]).trim();
    if (!team) continue;
    const players = [];
    for (let r = 1; r <= 8; r++) {
      const name = String(c[r] || '').trim();
      if (name) players.push({ name, round: r });
    }
    if (players.length > 0) squads.push({ team, players });
  }
  return squads;
}

function parseGazette(table) {
  return table.rows.map((r, i) => {
    const c = r.c.map(cellVal);
    return { week: i + 1, title: String(c[0]), url: String(c[1]) };
  }).filter(g => g.url);
}

// ── Data store ────────────────────────────────────
let DATA = { table: [], fixtures: {}, squads: [], cup: [], gazette: [], players: [] };
let currentGw = 1;
let teamSet = new Set();

// ── Fallback cup data (can't parse colours from API) ──
// MMH Cup: last-man-standing — eliminated if none of your 8 players score
const FALLBACK_CUP = {
  totalWeeks: 10,
  teams: [
    { name: 'AC MilAnthony', eliminatedWeek: null },
    { name: 'Inter MilAndy', eliminatedWeek: null },
    { name: 'Levski SOFia', eliminatedWeek: null },
    { name: 'The (C)amp Town Ladies', eliminatedWeek: null },
    { name: 'GazzatasaJay', eliminatedWeek: 9 },
    { name: 'Urawa Red Simons', eliminatedWeek: 9 },
    { name: 'eBBFleet United', eliminatedWeek: 5 },
    { name: 'Torkey', eliminatedWeek: 5 },
    { name: 'Wender Bremban', eliminatedWeek: 5 },
    { name: 'Diogo Jota20 FC', eliminatedWeek: 3 },
    { name: 'Rob Robi Mikel', eliminatedWeek: 3 },
    { name: 'Wardynamo Kyiv', eliminatedWeek: 3 },
    { name: 'Glennoble Foot 38', eliminatedWeek: 2 },
    { name: 'Boltom Fondlers', eliminatedWeek: 1 },
    { name: 'Pabloca Juniors', eliminatedWeek: 1 },
    { name: 'Peter Griffinternazionale', eliminatedWeek: 1 },
  ],
};

// ── Live data fetching ────────────────────────────
async function fetchAllData() {
  setStatus('Loading live data…');

  try {
    const tableData = await fetchSheet('Table');
    DATA.table = parseTable(tableData);
    teamSet = new Set(DATA.table.map(t => t.club));
    // also add common typo variants to the lookup set
    for (const name of [...teamSet]) {
      teamSet.add(name);
    }
    renderTable();
    setStatus('Table loaded — fetching fixtures…');
  } catch {
    setStatus('Could not connect to sheet — using cached data');
    return;
  }

  // Build an expanded team set that includes known variants
  const expandedTeamSet = new Set(teamSet);
  expandedTeamSet.add('Boltom Fondlers');
  expandedTeamSet.add('Peter GriffInternazionale');

  // Fetch weeks in parallel
  const weekPromises = [];
  for (let w = 1; w <= MAX_WEEKS; w++) {
    weekPromises.push(
      fetchSheet('Wk ' + w)
        .then(t => ({ week: w, data: t }))
        .catch(() => null)
    );
  }

  const [squadsResult, gazetteResult, playerListResult, ...weekResults] = await Promise.all([
    fetchSheet('Draft Squads').catch(() => null),
    fetchSheet('RFF Gazette').catch(() => null),
    fetchSheet('Master Player List').catch(() => null),
    ...weekPromises,
  ]);

  // Parse weeks
  DATA.fixtures = {};
  let latestPlayedWeek = 0;
  for (const result of weekResults) {
    if (!result) continue;
    const matches = parseWeek(result.data, expandedTeamSet);
    if (matches.length > 0) {
      DATA.fixtures[result.week] = matches;
      if (matches.some(m => m.hScore !== null)) {
        latestPlayedWeek = Math.max(latestPlayedWeek, result.week);
      }
    }
  }
  currentGw = latestPlayedWeek || 1;
  renderGwSelector();
  renderFixtures(currentGw);

  // Parse squads
  if (squadsResult) {
    DATA.squads = parseSquads(squadsResult);
    renderSquads();
  }

  // Parse gazette
  if (gazetteResult) {
    DATA.gazette = parseGazette(gazetteResult);
    renderGazette();
  }

  // Parse player list
  if (playerListResult) {
    DATA.players = parsePlayerList(playerListResult);
    renderScorers();
  }

  // Cup stays as fallback
  DATA.cup = FALLBACK_CUP;
  renderCup();

  const weekCount = Object.keys(DATA.fixtures).length;
  setStatus(`Live — ${DATA.table.length} teams, ${weekCount} gameweeks`);
}

function setStatus(msg) {
  const label = document.querySelector('.gameweek-label');
  if (label) label.textContent = msg;
}

// ── Renderers ─────────────────────────────────────
function renderTable() {
  const tbody = document.getElementById('tableBody');
  const totalTeams = DATA.table.length;
  tbody.innerHTML = DATA.table.map(t => {
    const posClass = t.pos <= 1 ? 'top' : t.pos >= totalTeams ? 'bottom' : '';
    const gdClass = t.gd > 0 ? 'gd-positive' : t.gd < 0 ? 'gd-negative' : 'gd-zero';
    const gdStr = t.gd > 0 ? `+${t.gd}` : String(t.gd);
    const formHtml = (t.form || []).map(f =>
      `<span class="form-pill ${f}">${f}</span>`
    ).join('');

    return `<tr>
      <td class="stat-cell"><span class="pos-num ${posClass}">${t.pos}</span></td>
      <td><div class="club-cell">
        <div class="team-badge" style="background:${teamColor(t.club)}"></div>
        <span class="team-name">${esc(t.club)}</span>
      </div></td>
      <td class="stat-cell">${t.pl}</td>
      <td class="stat-cell">${t.w}</td>
      <td class="stat-cell">${t.d}</td>
      <td class="stat-cell">${t.l}</td>
      <td class="stat-cell hide-mobile">${t.f}</td>
      <td class="stat-cell hide-mobile">${t.a}</td>
      <td class="stat-cell ${gdClass}">${gdStr}</td>
      <td class="pts-cell">${t.pts}</td>
      <td class="hide-mobile"><div class="form-pills">${formHtml}</div></td>
    </tr>`;
  }).join('');
}

function renderFixtures(week) {
  const matches = DATA.fixtures[week];
  const grid = document.getElementById('fixturesGrid');
  if (!matches || matches.length === 0) {
    grid.innerHTML = '<p style="color:var(--text-muted);padding:20px 0">No fixtures for this gameweek.</p>';
    return;
  }

  grid.innerHTML = matches.map(m => {
    const played = m.hScore !== null && m.aScore !== null;
    const hWin = played && m.hScore > m.aScore;
    const aWin = played && m.aScore > m.hScore;

    const hScorers = (m.homeScorers || []);
    const aScorers = (m.awayScorers || []);
    const hasScorers = hScorers.length > 0 || aScorers.length > 0;

    const scorerGoalText = (s) => s.goals > 1 ? ` (${s.goals})` : '';
    const scorersHtml = hasScorers ? `<div class="fixture-scorers">
      <div class="fixture-scorers-side home-scorers">${hScorers.map(s =>
        `<span class="scorer">${esc(s.name)}${scorerGoalText(s)}</span>`
      ).join('')}</div>
      <div class="fixture-scorers-side away-scorers">${aScorers.map(s =>
        `<span class="scorer">${esc(s.name)}${scorerGoalText(s)}</span>`
      ).join('')}</div>
    </div>` : '';

    return `<div class="fixture-card">
      <div class="fixture-team home">
        <div class="team-badge" style="background:${teamColor(m.home)}"></div>
        <span class="fixture-team-name">${esc(m.home)}</span>
      </div>
      <div class="fixture-score">
        <span class="score-val ${hWin ? 'winner' : ''}">${played ? m.hScore : '-'}</span>
        <span class="divider">:</span>
        <span class="score-val ${aWin ? 'winner' : ''}">${played ? m.aScore : '-'}</span>
      </div>
      <div class="fixture-team away">
        <div class="team-badge" style="background:${teamColor(m.away)}"></div>
        <span class="fixture-team-name">${esc(m.away)}</span>
      </div>
      ${scorersHtml}
    </div>`;
  }).join('');
}

function renderGwSelector() {
  const sel = document.getElementById('gwSelector');
  const weeks = Object.keys(DATA.fixtures).map(Number).sort((a, b) => a - b);
  if (weeks.length === 0) return;

  sel.innerHTML = weeks.map(w =>
    `<button class="gw-btn${w === currentGw ? ' active' : ''}" data-gw="${w}">GW ${w}</button>`
  ).join('');

  sel.querySelectorAll('.gw-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentGw = Number(btn.dataset.gw);
      sel.querySelectorAll('.gw-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderFixtures(currentGw);
    });
  });
}

function renderSquads() {
  const grid = document.getElementById('squadsGrid');
  if (DATA.squads.length === 0) return;

  grid.innerHTML = DATA.squads.map(s => {
    const playersHtml = s.players.map(p =>
      `<div class="squad-player">
        <span class="player-name">${esc(p.name)}</span>
        <span class="player-round">R${p.round}</span>
      </div>`
    ).join('');

    return `<div class="squad-card">
      <div class="squad-card-header">
        <div class="squad-team-color" style="background:${teamColor(s.team)}"></div>
        <span class="squad-team-name">${esc(s.team)}</span>
      </div>
      <div class="squad-players">${playersHtml}</div>
    </div>`;
  }).join('');
}

function renderCup() {
  const bracket = document.getElementById('cupBracket');
  const cup = DATA.cup;
  if (!cup || !cup.teams) return;

  const alive = cup.teams.filter(t => t.eliminatedWeek === null);
  const eliminated = cup.teams.filter(t => t.eliminatedWeek !== null);

  const statsHtml = `<div class="cup-stats">
    <div class="cup-stat-card cup-stat-alive">
      <div class="cup-stat-num">${alive.length}</div>
      <div class="cup-stat-label">Still Standing</div>
    </div>
    <div class="cup-stat-card cup-stat-eliminated">
      <div class="cup-stat-num">${eliminated.length}</div>
      <div class="cup-stat-label">Eliminated</div>
    </div>
    <div class="cup-stat-card">
      <div class="cup-stat-num">${cup.totalWeeks}</div>
      <div class="cup-stat-label">Weeks Played</div>
    </div>
  </div>`;

  const weekHeaders = Array.from({ length: cup.totalWeeks }, (_, i) =>
    `<th class="cup-wk-header">${i + 1}</th>`
  ).join('');

  const teamRows = cup.teams.map(t => {
    const isAlive = t.eliminatedWeek === null;
    const cells = Array.from({ length: cup.totalWeeks }, (_, i) => {
      const wk = i + 1;
      if (isAlive) {
        return `<td class="cup-cell cup-cell-alive"></td>`;
      }
      if (wk < t.eliminatedWeek) {
        return `<td class="cup-cell cup-cell-alive"></td>`;
      }
      if (wk === t.eliminatedWeek) {
        return `<td class="cup-cell cup-cell-eliminated"></td>`;
      }
      return `<td class="cup-cell cup-cell-out"></td>`;
    }).join('');

    const statusHtml = isAlive
      ? `<span class="cup-status cup-status-alive">ALIVE</span>`
      : `<span class="cup-status cup-status-elim">OUT WK ${t.eliminatedWeek}</span>`;

    return `<tr class="${isAlive ? 'cup-row-alive' : 'cup-row-elim'}">
      <td class="cup-team-cell">
        <div class="cup-team-info">
          <div class="team-badge" style="background:${teamColor(t.name)}"></div>
          <span class="cup-team-name">${esc(t.name)}</span>
        </div>
      </td>
      ${cells}
      <td class="cup-status-cell">${statusHtml}</td>
    </tr>`;
  }).join('');

  bracket.innerHTML = `${statsHtml}
    <div class="cup-tracker">
      <table class="cup-table">
        <thead><tr>
          <th class="cup-team-header">Team</th>
          ${weekHeaders}
          <th class="cup-status-header">Status</th>
        </tr></thead>
        <tbody>${teamRows}</tbody>
      </table>
    </div>`;
}

function renderScorers() {
  const container = document.getElementById('scorersGrid');
  if (DATA.players.length === 0) return;

  const rows = DATA.players.map((p, i) =>
    `<tr>
      <td class="stat-cell"><span class="pos-num ${i < 3 ? 'top' : ''}">${i + 1}</span></td>
      <td><div class="club-cell">
        <div class="team-badge" style="background:${teamColor(p.team)}"></div>
        <span class="team-name">${esc(p.name)}</span>
      </div></td>
      <td class="stat-cell hide-mobile"><span class="scorer-team-name">${esc(p.team)}</span></td>
      <td class="pts-cell">${p.total}</td>
    </tr>`
  ).join('');

  container.innerHTML = `<div class="table-wrapper">
    <table class="league-table scorers-table">
      <thead><tr>
        <th class="col-pos">#</th>
        <th>Player</th>
        <th class="hide-mobile">Fantasy Team</th>
        <th class="col-pts">Goals</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderGazette() {
  const list = document.getElementById('gazetteList');
  if (DATA.gazette.length === 0) return;

  list.innerHTML = DATA.gazette.slice().reverse().map(g =>
    `<a class="gazette-item" href="${esc(g.url)}" target="_blank" rel="noopener">
      <div class="gazette-info">
        <div class="gazette-week-num">${g.week}</div>
        <span class="gazette-title">${esc(g.title)}</span>
      </div>
      <span class="gazette-arrow">&rarr;</span>
    </a>`
  ).join('');
}

// ── Helpers ───────────────────────────────────────
function esc(str) {
  const el = document.createElement('span');
  el.textContent = str;
  return el.innerHTML;
}

// ── Navigation ────────────────────────────────────
function switchView(viewName) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`view-${viewName}`).classList.add('active');
  document.querySelector(`[data-view="${viewName}"]`).classList.add('active');
}

document.getElementById('mainNav').addEventListener('click', e => {
  const btn = e.target.closest('.nav-btn');
  if (!btn) return;
  switchView(btn.dataset.view);
});

// ── Init ──────────────────────────────────────────
fetchAllData();
