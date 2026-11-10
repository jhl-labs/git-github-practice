/* 매출 대시보드 — 정적 사이트(GitHub Pages)용
 *  1) 비밀번호 SHA-256 비교로 "로그인 흉내"
 *  2) data/data.json(엑셀 변환 결과)을 읽어 KPI·차트·표로 표시
 * 사용자 데이터는 항상 textContent로 출력한다 (innerHTML 금지 → XSS 방지)
 */
(() => {
  'use strict';

  const config = window.DASHBOARD_CONFIG;
  const $ = (id) => document.getElementById(id);
  const number = new Intl.NumberFormat('ko-KR');
  const state = { data: null, sheet: null, chart: null };

  // ── 인증 (흉내) ───────────────────────────────────────

  async function sha256Hex(text) {
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  const auth = {
    isLoggedIn: () => sessionStorage.getItem(config.sessionKey) === 'ok',
    async login(password) {
      const ok = (await sha256Hex(password)) === config.passwordSha256;
      if (ok) sessionStorage.setItem(config.sessionKey, 'ok');
      return ok;
    },
    logout: () => sessionStorage.removeItem(config.sessionKey),
  };

  function showLogin() {
    $('dashboard-view').hidden = true;
    $('login-view').hidden = false;
    $('login-title').textContent = config.title;
    $('password').focus();
  }

  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const ok = await auth.login($('password').value);
    $('login-error').hidden = ok;
    if (ok) start();
    else $('password').select();
  });

  $('logout').addEventListener('click', () => {
    auth.logout();
    showLogin();
  });

  // ── 데이터 ───────────────────────────────────────────

  async function loadData() {
    const res = await fetch(`${config.dataUrl}?t=${Date.now()}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`데이터를 불러오지 못했습니다 (HTTP ${res.status})`);
    return res.json();
  }

  const numericColumns = (sheet) => sheet.columns.filter((c) => c.type === 'number').map((c) => c.name);
  const categoryColumns = (sheet) => sheet.columns.filter((c) => c.type !== 'number').map((c) => c.name);

  function groupSum(rows, groupBy, valueKey) {
    const totals = new Map();
    for (const row of rows) {
      const key = row[groupBy] ?? '(빈 값)';
      totals.set(key, (totals.get(key) ?? 0) + (Number(row[valueKey]) || 0));
    }
    return [...totals.entries()].sort((a, b) => b[1] - a[1]);
  }

  // ── 렌더링 ───────────────────────────────────────────

  function fillSelect(select, options, selected) {
    select.replaceChildren(
      ...options.map((name) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        opt.selected = name === selected;
        return opt;
      }),
    );
  }

  function renderKpis(sheet) {
    const cards = [['행 수', number.format(sheet.summary.rowCount)]];
    for (const [name, total] of Object.entries(sheet.summary.totals).slice(0, 3)) cards.push([`${name} 합계`, number.format(total)]);
    $('kpis').replaceChildren(
      ...cards.map(([label, value]) => {
        const card = document.createElement('div');
        card.className = 'kpi';
        const small = document.createElement('small');
        small.textContent = label;
        const strong = document.createElement('strong');
        strong.textContent = value;
        card.append(small, strong);
        return card;
      }),
    );
  }

  function renderChart(sheet) {
    const groupBy = $('group-select').value;
    const valueKey = $('value-select').value;
    const pairs = groupBy && valueKey ? groupSum(sheet.rows, groupBy, valueKey) : [];
    state.chart?.destroy();
    if (!window.Chart || !pairs.length) return;
    state.chart = new window.Chart($('chart'), {
      type: 'bar',
      data: {
        labels: pairs.map(([k]) => String(k)),
        datasets: [{ label: `${valueKey} 합계`, data: pairs.map(([, v]) => v), backgroundColor: '#4f46e5', borderRadius: 6 }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => number.format(ctx.parsed.y) } } },
        scales: { y: { ticks: { callback: (v) => number.format(v) } } },
      },
    });
  }

  function renderTable(sheet) {
    const query = $('search').value.trim().toLowerCase();
    const rows = query ? sheet.rows.filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(query))) : sheet.rows;
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const col of sheet.columns) {
      const th = document.createElement('th');
      th.textContent = col.name;
      if (col.type === 'number') th.className = 'num';
      headRow.append(th);
    }
    thead.append(headRow);
    const tbody = document.createElement('tbody');
    for (const row of rows.slice(0, 500)) {
      const tr = document.createElement('tr');
      for (const col of sheet.columns) {
        const td = document.createElement('td');
        const value = row[col.name];
        td.textContent = col.type === 'number' && value !== null ? number.format(value) : value ?? '';
        if (col.type === 'number') td.className = 'num';
        tr.append(td);
      }
      tbody.append(tr);
    }
    $('table').replaceChildren(thead, tbody);
    $('row-count').textContent = `${number.format(rows.length)}행${rows.length > 500 ? ' (앞 500행만 표시)' : ''}`;
  }

  function selectSheet(name) {
    const sheet = state.data.sheets.find((s) => s.name === name) ?? state.data.sheets[0];
    state.sheet = sheet;
    const values = numericColumns(sheet);
    const groups = categoryColumns(sheet);
    fillSelect($('group-select'), groups, groups.find((g) => /지역|제품|분류|이름/.test(g)) ?? groups[0]);
    fillSelect($('value-select'), values, values.find((v) => /매출|금액|합계/.test(v)) ?? values[0]);
    renderKpis(sheet);
    renderChart(sheet);
    renderTable(sheet);
  }

  $('sheet-select').addEventListener('change', (e) => selectSheet(e.target.value));
  $('group-select').addEventListener('change', () => renderChart(state.sheet));
  $('value-select').addEventListener('change', () => renderChart(state.sheet));
  $('search').addEventListener('input', () => renderTable(state.sheet));

  async function start() {
    $('login-view').hidden = true;
    $('dashboard-view').hidden = false;
    $('dash-title').textContent = config.title;
    try {
      state.data = await loadData();
    } catch (error) {
      $('dash-source').textContent = error.message;
      return;
    }
    const hasData = !!state.data?.sheets?.length;
    $('empty').hidden = hasData;
    document.querySelectorAll('.panel, #kpis, #sheet-select').forEach((n) => (n.hidden = !hasData));
    if (!hasData) return;
    const { source, generatedAt } = state.data;
    $('dash-source').textContent = `${source.file}${source.issue ? ` · 이슈 #${source.issue}` : ''} · ${source.engine} · ${new Date(generatedAt).toLocaleString('ko-KR')} 갱신`;
    fillSelect($('sheet-select'), state.data.sheets.map((s) => s.name), state.data.sheets[0].name);
    selectSheet(state.data.sheets[0].name);
  }

  auth.isLoggedIn() ? start() : showLogin();
})();
