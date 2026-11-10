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

  /** 검색창 필터가 적용된 행 (표와 CSV 다운로드가 같은 결과를 쓰도록 한 곳에서 계산) */
  function filteredRows(sheet) {
    const query = $('search').value.trim().toLowerCase();
    return query ? sheet.rows.filter((r) => Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(query))) : sheet.rows;
  }

  // ── CSV 다운로드 ─────────────────────────────────────
  /** CSV 한 칸: 쉼표·따옴표·줄바꿈이 있으면 따옴표로 감싸고 따옴표는 두 번 쓴다.
   *  =, +, -, @, 탭, CR 로 시작하는 텍스트는 엑셀이 수식으로 실행하지 않도록 앞에 ' 를 붙인다(CSV 인젝션 방지).
   *  숫자 여부는 컬럼 메타데이터가 아니라 값의 실제 타입으로 판단한다(data.json을 그대로 믿지 않기). */
  const FORMULA_PREFIX = /^[=+\-@\t\r]/;
  function csvCell(value) {
    if (value === null || value === undefined) return '';
    let text = String(value);
    if (typeof value !== 'number' && FORMULA_PREFIX.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function toCsv(sheet, rows) {
    const header = sheet.columns.map((c) => csvCell(c.name)).join(',');
    const lines = rows.map((row) => sheet.columns.map((c) => csvCell(row[c.name])).join(','));
    return [header, ...lines].join('\r\n');
  }

  function downloadCsv(sheet) {
    const today = new Date();
    const stamp = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, '0')}${String(today.getDate()).padStart(2, '0')}`;
    const safeName = sheet.name.replace(/[\\/:*?"<>|]/g, '_');
    // UTF-8 BOM(\uFEFF): 엑셀이 한글 CSV를 깨짐 없이 열도록
    const blob = new Blob(['\uFEFF' + toCsv(sheet, filteredRows(sheet))], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${safeName}_${stamp}.csv`;
    document.body.append(link); // 일부 브라우저는 DOM에 붙은 링크만 클릭을 처리한다
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0); // 다운로드가 시작된 뒤 해제
  }

  function renderTable(sheet) {
    const rows = filteredRows(sheet);
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
  // 데이터를 못 불러온 경우(state.sheet 없음)에는 아무것도 하지 않는다
  $('search').addEventListener('input', () => state.sheet && renderTable(state.sheet));
  $('csv-download').addEventListener('click', () => state.sheet && downloadCsv(state.sheet));

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
