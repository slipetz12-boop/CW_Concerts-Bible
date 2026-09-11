// ═══════════════════════════════════════════════════
// AUTH
// ═══════════════════════════════════════════════════
function getToken() {
  return sessionStorage.getItem('cw_token');
}
function signOut() {
  sessionStorage.removeItem('cw_token');
  sessionStorage.removeItem('cw_user');
  window.location.href = '/login.html';
}
// Redirect to login if no token
if (!getToken()) {
  window.location.href = '/login.html';
}
// Show username
const username = sessionStorage.getItem('cw_user') || '';
const userEl = document.getElementById('hdr-user');
if (userEl) userEl.textContent = username;

// ═══════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════
let ALL = [], FILT = [], page = 0;
const PG = 50;
let SK = 'date', SD = -1, SCORES = {};

// ═══════════════════════════════════════════════════
// BOOT — fetch data from Netlify function
// ═══════════════════════════════════════════════════
// ── INFINITE SCROLL STATE ───────────────────────────────────────────────────
let isLoadingMore = false;
let allLoaded = false;
let displayedCount = 0;
const DISPLAY_BATCH = 100; // rows to render at a time as user scrolls

async function boot() {
  const msg = document.getElementById('load-msg');
  const badge = document.getElementById('hdr-badge');
  try {
    ALL = [];
    let page = 0, totalPages = 1;
    // Load ALL data pages from API in background
    while (page < totalPages) {
      if (msg) msg.textContent = totalPages > 1
        ? `Loading data… ${Math.round((page/totalPages)*100)}%`
        : 'Connecting to database…';
      const res = await fetch(`/api/shows?page=${page}`, {
        headers: { 'Authorization': 'Bearer ' + getToken() }
      });
      if (res.status === 401) { signOut(); return; }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `HTTP ${res.status}`);
      }
      const data = await res.json();
      ALL = ALL.concat(data.rows || []);
      totalPages = data.totalPages || 1;
      page++;
      if (badge) badge.textContent = ALL.length.toLocaleString() + ' shows';
      // After first page renders immediately so UI feels instant
      if (page === 1) { populateDDs(); go(); }
    }
    allLoaded = true;
    populateDDs(); go();
    if (badge) badge.textContent = ALL.length.toLocaleString() + ' shows';
  } catch (err) {
    const tbody = document.getElementById('tbody');
    if (tbody) tbody.innerHTML = `<tr><td colspan="18"><div class="empty-state">
      <strong>Failed to load data</strong>
      <span>${err.message}</span>
      <button class="btn" onclick="boot()" style="margin-top:8px">Retry</button>
    </div></td></tr>`;
    if (badge) badge.textContent = 'Error';
    console.error('Boot error:', err);
  }
}

// ═══════════════════════════════════════════════════
// FUZZY SEARCH
// ═══════════════════════════════════════════════════
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 99;
  const d = Array.from({length: a.length+1}, (_,i) =>
    Array.from({length: b.length+1}, (_,j) => i || j));
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      d[i][j] = a[i-1] === b[j-1] ? d[i-1][j-1]
               : 1 + Math.min(d[i-1][j], d[i][j-1], d[i-1][j-1]);
  return d[a.length][b.length];
}
function fscore(str, q) {
  if (!str || !q) return 0;
  const s = str.toLowerCase(), t = q.toLowerCase();
  if (s === t) return 100;
  if (s.includes(t)) return s.startsWith(t) ? 95 : 88;
  const qt = t.split(/\s+/), st = s.split(/[\s&,\/\-]+/);
  let matched = 0;
  for (const tok of qt) {
    let best = 0;
    for (const stok of st) {
      if (stok.startsWith(tok)) { best = 80; break; }
      if (tok.startsWith(stok) && stok.length >= 3) { best = Math.max(best, 72); continue; }
      if (tok.length >= 4 && stok.length >= 4 && lev(tok, stok) <= 2) best = Math.max(best, 65);
    }
    matched += best;
  }
  const ratio = matched / (qt.length * 80);
  if (ratio >= 0.9) return 82;
  if (ratio >= 0.6) return 60;
  const bg = s => { const b = new Set(); for (let i = 0; i < s.length-1; i++) b.add(s[i]+s[i+1]); return b; };
  const qb = bg(t), sb = bg(s); let c = 0;
  for (const b of qb) if (sb.has(b)) c++;
  const sim = 2 * c / (qb.size + sb.size || 1);
  return sim > 0.4 ? Math.round(sim * 55) : 0;
}

// ═══════════════════════════════════════════════════
// NUMBER UTILS
// ═══════════════════════════════════════════════════
const pf = v => { if (v === null || v === undefined) return null; const n = parseFloat(v); return isNaN(n) ? null : n; };
const pv = v => {
  if (v === null || v === undefined) return null;
  const s = String(v), n = parseFloat(s.replace('%', ''));
  if (isNaN(n)) return null;
  if (s.includes('%') && n > 1.5) return n;
  if (n > 0 && n <= 1.5) return n * 100;
  return n;
};
function fm(v, t = '$') {
  if (t === '$') {
    const n = pf(v); if (n === null) return '—';
    if (n >= 1e6) return '$' + (n/1e6).toFixed(2) + 'M';
    if (n >= 1e3) return '$' + (n/1e3).toFixed(1) + 'K';
    return '$' + Math.round(n).toLocaleString();
  }
  if (t === 'n') { const n = pf(v); return n === null ? '—' : Math.round(n).toLocaleString(); }
  if (t === '%') { const n = pv(v); return n === null ? '—' : n.toFixed(1) + '%'; }
  return String(v ?? '—');
}
const inR  = (v, lo, hi) => { const n = pf(v); if (n === null) return !(lo || hi); return (!lo || n >= +lo) && (!hi || n <= +hi); };
const inRv = (v, lo, hi) => { const n = pv(v); if (n === null) return !(lo || hi); return (!lo || n >= +lo) && (!hi || n <= +hi); };
const gv = id => (document.getElementById(id) || {}).value || '';
const ge = id => document.getElementById(id);

// ═══════════════════════════════════════════════════
// FILTER ENGINE
// ═══════════════════════════════════════════════════
function onQ() { page = 0; go(); }

function go() {
  const q = gv('q').trim(), hasFuzz = q.length > 1;
  const ftag = ge('ftag');
  if (ftag) ftag.style.display = hasFuzz ? 'inline' : 'none';

  let res = ALL;

  // Categorical
  const mk=gv('f-mk'), rm=gv('f-rm'), gn=gv('f-gn'), dw=gv('f-dw'), yr=gv('f-yr');
  const d0=gv('f-d0'), d1=gv('f-d1');
  if (mk) res = res.filter(r => r.market === mk);
  if (rm) res = res.filter(r => r.room === rm);
  if (gn) res = res.filter(r => r.genre === gn);
  if (dw) res = res.filter(r => r.dow === dw);
  if (yr) res = res.filter(r => r.date && r.date.startsWith(yr));
  if (d0) res = res.filter(r => r.date && r.date >= d0);
  if (d1) res = res.filter(r => r.date && r.date <= d1);

  // Numeric ranges
  if (gv('f-gr0')||gv('f-gr1')) res = res.filter(r => inR(r.gross,          gv('f-gr0'), gv('f-gr1')));
  if (gv('f-ns0')||gv('f-ns1')) res = res.filter(r => inR(r.net,            gv('f-ns0'), gv('f-ns1')));
  if (gv('f-hf0')||gv('f-hf1')) res = res.filter(r => inR(r.headliner_fee,  gv('f-hf0'), gv('f-hf1')));
  if (gv('f-at0')||gv('f-at1')) res = res.filter(r => inR(r.avg_ticket,     gv('f-at0'), gv('f-at1')));
  if (gv('f-pm0')||gv('f-pm1')) res = res.filter(r => inRv(r.profit_margin, gv('f-pm0'), gv('f-pm1')));
  if (gv('f-fb0')||gv('f-fb1')) res = res.filter(r => inR(r.fb_sales,       gv('f-fb0'), gv('f-fb1')));
  if (gv('f-pp0')||gv('f-pp1')) res = res.filter(r => inR(r.ppa,            gv('f-pp0'), gv('f-pp1')));
  if (gv('f-te0')||gv('f-te1')) res = res.filter(r => inR(r.total_exp,      gv('f-te0'), gv('f-te1')));
  if (gv('f-ts0')||gv('f-ts1')) res = res.filter(r => inR(r.total_tix_sold, gv('f-ts0'), gv('f-ts1')));
  if (gv('f-cp0')||gv('f-cp1')) res = res.filter(r => inR(r.capacity,       gv('f-cp0'), gv('f-cp1')));
  if (gv('f-pc0')||gv('f-pc1')) res = res.filter(r => inRv(r.pct_capacity,  gv('f-pc0'), gv('f-pc1')));
  if (gv('f-nv0')||gv('f-nv1')) res = res.filter(r => inRv(r.total_no_show_pct, gv('f-nv0'), gv('f-nv1')));
  if (gv('f-ct0')||gv('f-ct1')) res = res.filter(r => inR(r.comp_tickets,   gv('f-ct0'), gv('f-ct1')));
  if (gv('f-ds0')||gv('f-ds1')) res = res.filter(r => inR(r.days_on_sale,   gv('f-ds0'), gv('f-ds1')));

  // Fuzzy search
  SCORES = {};
  if (hasFuzz) {
    const scored = [];
    for (const r of res) {
      const s = fscore(r.artist || '', q);
      if (s >= 25) { SCORES[ALL.indexOf(r)] = s; scored.push(r); }
    }
    res = scored.sort((a, b) => (SCORES[ALL.indexOf(b)]||0) - (SCORES[ALL.indexOf(a)]||0));
  } else {
    sortArr(res);
  }

  FILT = res; page = 0;
  renderMets(); renderChips(); renderTable(); hiliteInputs();
}

// ═══════════════════════════════════════════════════
// SORT
// ═══════════════════════════════════════════════════
const PCT_FIELDS = new Set(['profit_margin', 'pct_capacity', 'total_no_show_pct']);

function sortArr(arr) {
  const isPct = PCT_FIELDS.has(SK);
  arr.sort((a, b) => {
    const av = isPct ? pv(a[SK]) : pf(a[SK]);
    const bv = isPct ? pv(b[SK]) : pf(b[SK]);
    if (av !== null && bv !== null) return SD * (bv - av);
    if (av !== null) return SD * -1;
    if (bv !== null) return SD * 1;
    return SD * String(b[SK] ?? '').localeCompare(String(a[SK] ?? ''));
  });
}

function thC(k) {
  if (SK === k) SD *= -1; else { SK = k; SD = -1; }
  sortArr(FILT); renderTable();
  document.querySelectorAll('th').forEach(th => th.classList.remove('s'));
}

function onSrtDD() {
  const parts = gv('srt').split(',');
  SK = parts[0]; SD = parseInt(parts[1]) || -1;
  sortArr(FILT); renderTable();
}

// ═══════════════════════════════════════════════════
// METRICS
// ═══════════════════════════════════════════════════
function renderMets() {
  const r = FILT;
  const sum = k => r.reduce((t, x) => t + (pf(x[k]) || 0), 0);
  const ts = sum('total_tix_sold'), gr = sum('gross');
  ge('m-n').textContent  = r.length.toLocaleString();
  ge('m-gr').textContent = fm(gr);
  ge('m-ns').textContent = fm(sum('net'));
  ge('m-ts').textContent = fm(ts, 'n');
  ge('m-fb').textContent = fm(sum('fb_sales'));
  ge('m-hf').textContent = fm(sum('headliner_fee'));
  ge('m-at').textContent = ts ? fm(gr / ts) : '—';
  ge('m-mk').textContent = new Set(r.map(x => x.market)).size;
}

// ═══════════════════════════════════════════════════
// CHIPS
// ═══════════════════════════════════════════════════
const CHIP_DEFS = [
  {id:'f-mk',l:'Market'},{id:'f-rm',l:'Room'},{id:'f-gn',l:'Genre'},
  {id:'f-dw',l:'Day'},{id:'f-yr',l:'Year'},{id:'f-d0',l:'From'},{id:'f-d1',l:'To'},
  {id:'f-gr0',l:'Gross≥'},{id:'f-gr1',l:'Gross≤'},{id:'f-ns0',l:'Net≥'},{id:'f-ns1',l:'Net≤'},
  {id:'f-hf0',l:'Fee≥'},{id:'f-hf1',l:'Fee≤'},{id:'f-at0',l:'Tix≥'},{id:'f-at1',l:'Tix≤'},
  {id:'f-pm0',l:'Margin≥'},{id:'f-pm1',l:'Margin≤'},{id:'f-fb0',l:'F&B≥'},{id:'f-fb1',l:'F&B≤'},
  {id:'f-pp0',l:'PPA≥'},{id:'f-pp1',l:'PPA≤'},{id:'f-te0',l:'Exp≥'},{id:'f-te1',l:'Exp≤'},
  {id:'f-ts0',l:'Sold≥'},{id:'f-ts1',l:'Sold≤'},{id:'f-cp0',l:'Cap≥'},{id:'f-cp1',l:'Cap≤'},
  {id:'f-pc0',l:'%Cap≥'},{id:'f-pc1',l:'%Cap≤'},{id:'f-nv0',l:'NS≥'},{id:'f-nv1',l:'NS≤'},
  {id:'f-ct0',l:'Comp≥'},{id:'f-ct1',l:'Comp≤'},{id:'f-ds0',l:'OnSale≥'},{id:'f-ds1',l:'OnSale≤'},
];

function renderChips() {
  const bar = ge('chips'); if (!bar) return;
  const chips = [];
  const q = gv('q');
  if (q) chips.push(`<span class="chip">Artist: ${q} <span class="chip-x" onclick="clrF('q')">×</span></span>`);
  for (const {id, l} of CHIP_DEFS) {
    const v = gv(id); if (!v) continue;
    chips.push(`<span class="chip">${l}: ${v} <span class="chip-x" onclick="clrF('${id}')">×</span></span>`);
  }
  bar.innerHTML = chips.join('');
  bar.classList.toggle('empty', chips.length === 0);
}

function clrF(id) {
  const el = ge(id); if (el) { el.value = ''; el.classList.remove('act'); }
  go();
}

// ═══════════════════════════════════════════════════
// TABLE
// ═══════════════════════════════════════════════════
function renderTable() {
  const tot = FILT.length;
  const s = page * PG, e = Math.min(s + PG, tot);
  const sl = FILT.slice(s, e);

  const tblCt = ge('tbl-ct');
  if (tblCt) tblCt.textContent = tot.toLocaleString() + ' shows';
  const pgInfo = ge('pg-info');
  if (pgInfo) pgInfo.textContent = tot ? `${(s+1).toLocaleString()} – ${e.toLocaleString()} of ${tot.toLocaleString()}` : '0 shows';
  const pgp = ge('pgp'), pgn = ge('pgn');
  if (pgp) pgp.disabled = page === 0;
  if (pgn) pgn.disabled = e >= tot;

  const tbody = ge('tbody');
  if (!tbody) return;

  if (!sl.length) {
    tbody.innerHTML = '<tr><td colspan="18"><div class="empty-state">No shows match these filters.<br>Try adjusting the search or clearing some filters.</div></td></tr>';
    return;
  }

  const ai = ALL.indexOf.bind(ALL);
  tbody.innerHTML = sl.map(r => {
    const sc  = SCORES[ai(r)];
    const rm  = r.room || '';
    const rmL = rm.toLowerCase();
    const pillCls = rmL === 'main' ? 'pill-main' : (rmL === 'loft' || rmL === 'secondary') ? 'pill-loft' : 'pill-other';
    const pmv = pv(r.profit_margin);
    const mg  = pmv !== null ? `<span class="${pmv >= 0 ? 'pos' : 'neg'}">${pmv.toFixed(1)}%</span>` : '—';
    const artist = (r.artist || '—').replace(/</g, '&lt;');
    return '<tr>'
      + '<td><span style="font-family:var(--f-num);font-size:11.5px">' + (r.date || '—') + '</span></td>'
      + '<td style="color:var(--ink3)">' + (r.dow || '—') + '</td>'
      + '<td style="font-weight:500;max-width:195px;overflow:hidden;text-overflow:ellipsis">' + (sc ? '<span class="mdot"></span>' : '') + artist + '</td>'
      + '<td style="color:var(--ink3)">' + (r.genre || '—') + '</td>'
      + '<td>' + (r.market || '—') + '</td>'
      + '<td><span class="pill ' + pillCls + '">' + (rm || '—') + '</span></td>'
      + '<td class="num">' + fm(r.gross) + '</td>'
      + '<td class="num">' + fm(r.net) + '</td>'
      + '<td class="num">' + mg + '</td>'
      + '<td class="num">' + fm(r.headliner_fee) + '</td>'
      + '<td class="num">' + fm(r.avg_ticket) + '</td>'
      + '<td class="num">' + fm(r.total_tix_sold, 'n') + '</td>'
      + '<td class="num">' + fm(r.capacity, 'n') + '</td>'
      + '<td class="num">' + fm(r.pct_capacity, '%') + '</td>'
      + '<td class="num">' + fm(r.fb_sales) + '</td>'
      + '<td class="num">' + fm(r.ppa) + '</td>'
      + '<td class="num">' + fm(r.total_no_show_pct, '%') + '</td>'
      + '<td class="num">' + fm(r.days_on_sale, 'n') + '</td>'
      + '</tr>';
  }).join('');
}

function cp(d) {
  page = Math.max(0, Math.min(page + d, Math.ceil(FILT.length / PG) - 1));
  renderTable();
  const wrap = ge('tbl-wrap');
  if (wrap) wrap.scrollTop = 0;
}

// ═══════════════════════════════════════════════════
// DROPDOWNS
// ═══════════════════════════════════════════════════
function populateDDs() {
  const fill = (id, vals, lbl) => {
    const el = ge(id); if (!el) return;
    el.innerHTML = `<option value="">${lbl}</option>` +
      [...new Set(vals.filter(Boolean))].sort().map(v => `<option value="${v.replace(/"/g,'&quot;')}">${v}</option>`).join('');
  };
  fill('f-mk', ALL.map(r => r.market), 'All markets');
  fill('f-rm', ALL.map(r => r.room),   'All rooms');
  fill('f-gn', ALL.map(r => r.genre),  'All genres');
  fill('f-yr', ALL.map(r => r.date && r.date.slice(0, 4)), 'All years');
}

function hiliteInputs() {
  const ids = ['f-mk','f-rm','f-gn','f-dw','f-yr','f-d0','f-d1',
    'f-gr0','f-gr1','f-ns0','f-ns1','f-hf0','f-hf1','f-at0','f-at1',
    'f-pm0','f-pm1','f-fb0','f-fb1','f-pp0','f-pp1','f-te0','f-te1',
    'f-ts0','f-ts1','f-cp0','f-cp1','f-pc0','f-pc1','f-nv0','f-nv1',
    'f-ct0','f-ct1','f-ds0','f-ds1'];
  ids.forEach(id => { const el = ge(id); if (el) el.classList.toggle('act', !!el.value); });
}

function clearAll() {
  const q = ge('q'); if (q) q.value = '';
  ['f-mk','f-rm','f-gn','f-dw','f-yr'].forEach(id => { const el = ge(id); if (el) el.value = ''; });
  ['f-d0','f-d1','f-gr0','f-gr1','f-ns0','f-ns1','f-hf0','f-hf1',
   'f-at0','f-at1','f-pm0','f-pm1','f-fb0','f-fb1','f-pp0','f-pp1',
   'f-te0','f-te1','f-ts0','f-ts1','f-cp0','f-cp1','f-pc0','f-pc1',
   'f-nv0','f-nv1','f-ct0','f-ct1','f-ds0','f-ds1'
  ].forEach(id => { const el = ge(id); if (el) { el.value = ''; el.classList.remove('act'); } });
  SK = 'date'; SD = -1; page = 0; go();
}

// ═══════════════════════════════════════════════════
// ARTIST LOOKUP
// ═══════════════════════════════════════════════════
function doArtist() {
  const q = (ge('aq').value || '').trim();
  const out = ge('aout');
  if (!out) return;
  if (q.length < 2) {
    out.innerHTML = '<div class="empty-state">Type at least 2 characters to search</div>';
    return;
  }
  const map = {};
  for (const r of ALL) {
    const a = r.artist; if (!a) continue;
    const s = fscore(a, q); if (s < 28) continue;
    if (!map[a]) map[a] = { s: 0, rows: [] };
    if (s > map[a].s) map[a].s = s;
    map[a].rows.push(r);
  }
  const hits = Object.entries(map).sort((a,b) => b[1].s - a[1].s).slice(0, 8);
  if (!hits.length) {
    out.innerHTML = '<div class="empty-state">No matches found — try a different spelling</div>';
    return;
  }
  out.innerHTML = hits.map(([name, {s, rows}]) => {
    const sum = k => rows.reduce((t,r) => t + (pf(r[k]) || 0), 0);
    const gr = sum('gross'), ns = sum('net'), hf = sum('headliner_fee'), fb = sum('fb_sales'), ts = sum('total_tix_sold');
    const avgFee = hf / rows.length;
    const oLo = Math.round(avgFee * 1.05 / 500) * 500;
    const oHi = Math.round(avgFee * 1.25 / 500) * 500;
    const mkts = [...new Set(rows.map(r => r.market).filter(Boolean))].join(', ');
    const gns  = [...new Set(rows.map(r => r.genre).filter(Boolean))].join(', ');
    const sorted = [...rows].sort((a,b) => String(b.date||'').localeCompare(String(a.date||'')));
    const ml = s >= 90 ? 'Exact match' : s >= 70 ? 'Strong match' : s >= 45 ? 'Good match' : 'Possible match';
    const mc = s >= 90 ? 'var(--green)' : s >= 70 ? 'var(--wine)' : 'var(--amber)';
    const safeN = name.replace(/</g,'&lt;');
    return '<div class="acard">'
      + '<div class="acard-hd"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">'
        + '<div><div class="acard-name">' + safeN + '</div>'
        + '<div class="acard-meta">' + (gns || 'Genre unknown') + ' · ' + mkts + ' · ' + rows.length + ' show' + (rows.length !== 1 ? 's' : '')
        + ' · <span style="color:' + mc + ';font-weight:600">' + ml + '</span></div>'
        + (oLo ? '<div class="offer-badge">Suggested offer: ' + fm(oLo) + ' – ' + fm(oHi) + '</div>' : '')
        + '</div></div></div>'
      + '<div class="astats">'
        + '<div class="astat"><div class="astat-l">Total gross</div><div class="astat-v">' + fm(gr) + '</div></div>'
        + '<div class="astat"><div class="astat-l">Total net</div><div class="astat-v">' + fm(ns) + '</div></div>'
        + '<div class="astat"><div class="astat-l">Fees paid</div><div class="astat-v">' + fm(hf) + '</div></div>'
        + '<div class="astat"><div class="astat-l">F&amp;B total</div><div class="astat-v">' + fm(fb) + '</div></div>'
        + '<div class="astat"><div class="astat-l">Tix sold</div><div class="astat-v">' + fm(ts, 'n') + '</div></div>'
      + '</div>'
      + '<div class="atblw"><table class="atbl">'
        + '<thead><tr><th>Date</th><th>Market</th><th>Room</th><th>Billing</th>'
        + '<th style="text-align:right">Gross</th><th style="text-align:right">Net</th>'
        + '<th style="text-align:right">Fee</th><th style="text-align:right">Tix</th>'
        + '<th style="text-align:right">% Cap</th><th style="text-align:right">F&B</th>'
        + '<th style="text-align:right">PPA</th></tr></thead><tbody>'
        + sorted.map(r => {
            const rm = r.room || ''; const rmL = rm.toLowerCase();
            const pc = rmL === 'main' ? 'pill-main' : rmL === 'loft' ? 'pill-loft' : 'pill-other';
            return '<tr>'
              + '<td style="font-family:var(--f-num);font-size:11px">' + (r.date || '—') + '</td>'
              + '<td>' + (r.market || '—') + '</td>'
              + '<td><span class="pill ' + pc + '" style="font-size:8px">' + rm + '</span></td>'
              + '<td style="color:var(--ink3);font-style:italic;max-width:150px;overflow:hidden;text-overflow:ellipsis">' + (r.artist || '—').replace(/</g,'&lt;') + '</td>'
              + '<td class="num">' + fm(r.gross) + '</td>'
              + '<td class="num">' + fm(r.net) + '</td>'
              + '<td class="num" style="color:var(--ink3)">' + fm(r.headliner_fee) + '</td>'
              + '<td class="num">' + fm(r.total_tix_sold, 'n') + '</td>'
              + '<td class="num">' + fm(r.pct_capacity, '%') + '</td>'
              + '<td class="num">' + fm(r.fb_sales) + '</td>'
              + '<td class="num">' + fm(r.ppa) + '</td>'
              + '</tr>';
          }).join('')
        + '</tbody></table></div></div>';
  }).join('');
}

// ═══════════════════════════════════════════════════
// ANALYTICS
// ═══════════════════════════════════════════════════
function buildAnalytics() {
  const el = ge('angrid');
  if (!el || !ALL.length) return;

  const aggSum = (k, vk, top=12) => {
    const m = {}; ALL.forEach(r => { const key=r[k]; if(!key)return; const v=pf(r[vk]); if(v!==null)m[key]=(m[key]||0)+v; });
    return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,top);
  };
  const aggAvg = (k, vk, top=12, minCnt=5) => {
    const m = {}; ALL.forEach(r => { const key=r[k]; if(!key)return; const v=pf(r[vk]); if(v!==null){if(!m[key])m[key]={s:0,c:0};m[key].s+=v;m[key].c++;} });
    return Object.entries(m).filter(([,x])=>x.c>=minCnt).map(([key,x])=>[key,x.s/x.c,x.c]).sort((a,b)=>b[1]-a[1]).slice(0,top);
  };

  const DOWS = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  const card = (title, rows, fmtF, cls='', note='') => {
    const mx = Math.max(...rows.map(x=>x[1]), 1);
    return '<div class="an-card"><div class="an-title">' + title
      + (note ? '<span style="font-size:9px;font-weight:400;text-transform:none;letter-spacing:0;color:var(--ink3);margin-left:6px">' + note + '</span>' : '')
      + '</div>'
      + rows.map(([l,v,c]) =>
          '<div class="bar-row">'
          + '<div class="bar-lbl" title="' + l + '">' + l + '</div>'
          + '<div class="bar-track"><div class="bar-fill ' + cls + '" style="width:' + Math.round(v/mx*100) + '%"></div></div>'
          + '<div class="bar-num">' + fmtF(v) + (c > 0 ? '<span style="font-size:8px;color:var(--ink4)"> (' + c + ')</span>' : '') + '</div>'
          + '</div>'
        ).join('')
      + '</div>';
  };

  const tiers = [{l:'<$30',lo:0,hi:30},{l:'$30–50',lo:30,hi:50},{l:'$50–75',lo:50,hi:75},{l:'$75–100',lo:75,hi:100},{l:'>$100',lo:100,hi:9999}];
  const tierFB = tiers.map(t => {
    const rs = ALL.filter(r => { const p=pf(r.avg_ticket); return p!==null&&p>=t.lo&&p<t.hi&&(pf(r.fb_sales)||0)>0; });
    return [t.l, rs.length ? rs.reduce((s,r)=>s+(pf(r.fb_sales)||0),0)/rs.length : 0, rs.length];
  }).filter(x => x[2] >= 5);

  const dowNS = DOWS.map(d => {
    const vs = ALL.filter(r=>r.dow===d).map(r=>pv(r.total_no_show_pct)).filter(v=>v!==null&&v>0&&v<100);
    return [d, vs.length ? vs.reduce((a,b)=>a+b)/vs.length : 0, vs.length];
  }).filter(x => x[1] > 0);

  const yrGr = Object.entries(ALL.reduce((m,r)=>{ const y=r.date&&r.date.slice(0,4); if(y)m[y]=(m[y]||0)+(pf(r.gross)||0); return m; },{}))
    .sort().map(([y,v])=>[y,v,ALL.filter(r=>r.date&&r.date.startsWith(y)).length]);

  const dowGrossAvg = DOWS.map(d => {
    const rs = ALL.filter(r=>r.dow===d&&(pf(r.gross)||0)>0);
    return [d, rs.length ? rs.reduce((s,r)=>s+(pf(r.gross)||0),0)/rs.length : 0, rs.length];
  }).filter(x => x[1] > 0);

  el.innerHTML = [
    card('Total gross by market',       aggSum('market','gross'),      v=>fm(v)),
    card('Avg gross per show by day',   dowGrossAvg,                   v=>fm(v), '', 'avg'),
    card('Total gross by genre',        aggSum('genre','gross'),        v=>fm(v)),
    card('Avg net per show by genre',   aggAvg('genre','net'),          v=>fm(v), 'g', 'avg'),
    card('Avg F&B sales by market',     aggAvg('market','fb_sales'),    v=>fm(v), 'g', 'avg'),
    card('Avg PPA by market',           aggAvg('market','ppa'),         v=>fm(v), 'g', 'avg'),
    card('Avg F&B by ticket price tier',tierFB,                         v=>fm(v), 'g', 'avg per show'),
    card('Avg no-show % by day',        dowNS,                          v=>v.toFixed(1)+'%'),
    card('Total gross by year',         yrGr,                           v=>fm(v)),
  ].join('');
}

// ═══════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════
function xcsv() {
  const cols = ['Date','Day','Artist','Genre','Market','Room','Gross','Net','Margin%','Fee','Avg Ticket','Tix Sold','Capacity','% Cap','F&B','PPA','No-show%','Days on Sale'];
  const keys = ['date','dow','artist','genre','market','room','gross','net','profit_margin','headliner_fee','avg_ticket','total_tix_sold','capacity','pct_capacity','fb_sales','ppa','total_no_show_pct','days_on_sale'];
  const esc  = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [cols.map(esc).join(','), ...FILT.map(r => keys.map(k => esc(r[k] ?? '')).join(','))];
  const blob  = new Blob([lines.join('\n')], {type: 'text/csv'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'CW_' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
}

// ═══════════════════════════════════════════════════
// TABS
// ═══════════════════════════════════════════════════
function switchTab(el) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  const pane = el.dataset.pane;
  const sidebar = ge('sidebar');
  ge('pane-shows').style.display     = 'none';
  ge('pane-artist').style.display    = 'none';
  ge('pane-analytics').style.display = 'none';
  if (pane === 'shows') {
    ge('pane-shows').style.display = 'flex';
    if (sidebar) sidebar.style.display = 'flex';
  } else if (pane === 'artist') {
    ge('pane-artist').style.display = 'block';
    if (sidebar) sidebar.style.display = 'none';
    setTimeout(() => { const aq = ge('aq'); if (aq) aq.focus(); }, 50);
  } else if (pane === 'analytics') {
    ge('pane-analytics').style.display = 'block';
    if (sidebar) sidebar.style.display = 'none';
    buildAnalytics();
  }
}

// ═══════════════════════════════════════════════════
// START
// ═══════════════════════════════════════════════════
setupScrollListener();
boot();
