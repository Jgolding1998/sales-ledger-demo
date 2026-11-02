// UI layer for the fictional sales demo.
// All financial calculations come from calc.js; all data comes from data.js.
// Fixture fields are only ever written with textContent / DOM APIs.

const DEFAULTS = Object.freeze({
  basis: 'invoiceDate',
  from: '2025-01-01',
  to: '2025-12-31',
  asOf: '2025-12-31',
  search: '',
});

const REQUIRED_CALC = [
  'formatMoney', 'validateRecords', 'filterRecords', 'metrics',
  'monthlySeries', 'agingBuckets', 'csvForRecords', 'outstandingAt', 'paidAt',
];

const SVG_NS = 'http://www.w3.org/2000/svg';
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let calc = null;
let allRecords = [];
let currentRows = []; // sorted rows for current filters: { record, paid, outstanding, overdue }
let searchTimer = 0;
let chartSeq = 0;

const state = {
  ...DEFAULTS,
  sortKey: 'invoiceDate',
  sortDir: 'desc',
  page: 1,
  pageSize: 25,
};

const $ = (id) => document.getElementById(id);

// ---------- helpers ----------

function el(tag, opts = {}, children = []) {
  const node = document.createElement(tag);
  if (opts.className) node.className = opts.className;
  if (opts.text !== undefined) node.textContent = String(opts.text);
  if (opts.attrs) for (const [k, v] of Object.entries(opts.attrs)) node.setAttribute(k, v);
  for (const child of children) node.append(child);
  return node;
}

function svg(tag, attrs = {}, text) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function isValidIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  if (value < '1900-01-01' || value > '2100-12-31') return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function money(cents) {
  return calc.formatMoney(cents);
}

// Display-only axis label (chart ticks). Not used for any reported figure.
// Ticks come from niceTicks(), so they are round values that compact notation shows exactly.
const compactFmt = new Intl.NumberFormat('en-US', {
  style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2,
});
function axisLabel(cents) {
  return compactFmt.format(cents / 100);
}

function monthLabel(key, withYear) {
  const m = /^(\d{4})-(\d{2})/.exec(String(key));
  if (!m) return String(key);
  const name = MONTHS[Number(m[2]) - 1] || m[2];
  return withYear ? `${name} ${m[1]}` : name;
}

function basisName(basis) {
  return basis === 'orderDate' ? 'order date' : 'invoice date';
}

function readValidation(result) {
  if (result === true || result === undefined || result === null) return { ok: true, errors: [] };
  if (result === false) return { ok: false, errors: ['Records failed validation.'] };
  if (Array.isArray(result)) return { ok: result.length === 0, errors: result };
  const errors = result.errors || result.issues || [];
  const ok = 'valid' in result ? Boolean(result.valid) : 'ok' in result ? Boolean(result.ok) : errors.length === 0;
  return { ok, errors };
}

function errorText(e) {
  if (typeof e === 'string') return e;
  if (e && typeof e.message === 'string') return e.message;
  try { return JSON.stringify(e); } catch { return String(e); }
}

// ---------- fatal / filter errors ----------

function showFatal(title, details = []) {
  const box = $('load-status');
  box.replaceChildren(el('strong', { text: title }));
  if (details.length) {
    const list = el('ul');
    details.slice(0, 5).forEach((d) => list.append(el('li', { text: errorText(d) })));
    if (details.length > 5) list.append(el('li', { text: `…and ${details.length - 5} more.` }));
    box.append(list);
  }
  box.hidden = false;
  $('scope-summary').textContent = 'Dashboard unavailable.';
}

const DESCRIBED_BY = { from: 'basis-help', to: 'basis-help', asof: 'asof-help' };

function setFilterError(messages, invalidIds = []) {
  const box = $('filter-error');
  ['from', 'to', 'asof'].forEach((id) => {
    // Invalid fields point at the error text so it is read again when the field is focused.
    if (invalidIds.includes(id)) {
      $(id).setAttribute('aria-invalid', 'true');
      $(id).setAttribute('aria-describedby', `${DESCRIBED_BY[id]} filter-error`);
    } else {
      $(id).removeAttribute('aria-invalid');
      $(id).setAttribute('aria-describedby', DESCRIBED_BY[id]);
    }
  });
  if (!messages.length) {
    box.hidden = true;
    box.replaceChildren();
    return;
  }
  box.replaceChildren(el('strong', { text: 'Check the filters: ' }), document.createTextNode(messages.join(' ')));
  box.hidden = false;
}

function validateFilters() {
  const messages = [];
  const invalid = [];
  if (!isValidIsoDate(state.from)) { messages.push('From needs a complete date between 1900 and 2100.'); invalid.push('from'); }
  if (!isValidIsoDate(state.to)) { messages.push('To needs a complete date between 1900 and 2100.'); invalid.push('to'); }
  if (!isValidIsoDate(state.asOf)) { messages.push('As-of needs a complete date between 1900 and 2100.'); invalid.push('asof'); }
  if (!invalid.includes('from') && !invalid.includes('to') && state.from > state.to) {
    messages.push('From must be on or before To.');
    invalid.push('from', 'to');
  }
  setFilterError(messages, invalid);
  return messages.length === 0;
}

// ---------- render ----------

function render() {
  syncBasisLabels();
  if (!validateFilters()) {
    renderUnavailable('Fix the highlighted filter to see results.');
    return;
  }

  let filtered;
  try {
    filtered = calc.filterRecords(allRecords, {
      from: state.from,
      to: state.to,
      basis: state.basis,
      search: state.search,
      asOf: state.asOf,
    });
  } catch (err) {
    setFilterError([`The filter could not be applied (${errorText(err)}).`]);
    renderUnavailable('Results unavailable.');
    return;
  }

  currentRows = sortRows(filtered.map((record) => {
    const outstanding = calc.outstandingAt(record, state.asOf);
    return {
      record,
      outstanding,
      paid: calc.paidAt(record, state.asOf),
      // Same rule calc.metrics uses for "overdue": balance remaining and due date before as-of.
      overdue: outstanding > 0 && record.dueDate < state.asOf,
    };
  }));

  renderSummary(filtered.length);
  renderKpis(filtered);
  renderTrend(filtered);
  renderAging(filtered);
  renderTable();
}

function renderUnavailable(message) {
  currentRows = [];
  document.querySelectorAll('[data-kpi]').forEach((n) => { n.textContent = '—'; });
  $('kpi-meta').textContent = '';
  chartEmpty($('trend-chart'), message);
  chartEmpty($('aging-chart'), message);
  $('trend-table').tBodies[0].replaceChildren();
  $('aging-table').tBodies[0].replaceChildren();
  $('scope-summary').textContent = message;
  renderTable(message);
}

function syncBasisLabels() {
  const label = `(${basisName(state.basis)})`;
  document.querySelectorAll('[data-basis-label]').forEach((n) => { n.textContent = label; });
  const asOfText = state.asOf || '—';
  document.querySelector('[data-kpi-note="asof"]').textContent = `Unpaid as of ${asOfText}`;
  document.querySelector('[data-kpi-note="orders"]').textContent = `Ordered on or before ${asOfText}`;
  document.querySelector('[data-kpi-note="invoiced"]').textContent = `Invoiced on or before ${asOfText}`;
  $('aging-sub').textContent = `Days past due as of ${state.asOf || '—'}`;
}

function renderSummary(count) {
  const searchPart = state.search ? `, matching “${state.search}”` : '';
  $('scope-summary').textContent =
    `${count.toLocaleString('en-US')} record${count === 1 ? '' : 's'} with ${basisName(state.basis)} ` +
    `${state.from} to ${state.to}${searchPart}; balances as of ${state.asOf}.`;
}

function renderKpis(records) {
  const m = calc.metrics(records, state.asOf);
  for (const key of ['orders', 'invoiced', 'outstanding', 'overdue']) {
    document.querySelector(`[data-kpi="${key}"]`).textContent = money(m[key]);
  }
  $('kpi-meta').textContent =
    `${Number(m.count).toLocaleString('en-US')} record${m.count === 1 ? '' : 's'} · Paid as of ${state.asOf}: ${money(m.paid)}`;
}

function chartEmpty(container, message) {
  container.replaceChildren(el('div', { className: 'chart-empty', text: message, attrs: { role: 'status' } }));
}

// Round tick step (1/2/2.5/5 × 10^k cents) for about four intervals. The axis top is a whole
// number of steps, so every gridline label is an exact round amount rather than max/4.
function niceTicks(value) {
  if (!(value > 0)) return { step: 100, count: 1 };
  const raw = value / 4;
  const exp = 10 ** Math.floor(Math.log10(raw));
  const f = raw / exp;
  const step = Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * exp);
  return { step, count: Math.max(1, Math.ceil(value / step)) };
}

function renderTrend(records) {
  const container = $('trend-chart');
  const tbody = $('trend-table').tBodies[0];
  const series = calc.monthlySeries(records, state.asOf);
  tbody.replaceChildren();

  if (!series.length) {
    chartEmpty(container, `No orders or invoices on or before ${state.asOf} for these filters.`);
    return;
  }

  for (const p of series) {
    tbody.append(el('tr', {}, [
      el('th', { text: monthLabel(p.month, true), attrs: { scope: 'row' } }),
      el('td', { className: 'num', text: money(p.orders) }),
      el('td', { className: 'num', text: money(p.invoiced) }),
    ]));
  }

  const W = 640, H = 260;
  const pad = { t: 12, r: 12, b: 32, l: 52 };
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
  const ticks = niceTicks(Math.max(0, ...series.map((p) => Math.max(p.orders, p.invoiced))));
  const maxVal = ticks.step * ticks.count;
  const n = series.length;
  const x = (i) => pad.l + (n === 1 ? iw / 2 : (iw * i) / (n - 1));
  const y = (v) => pad.t + ih - (ih * v) / maxVal;

  const id = `trend-${++chartSeq}`;
  const m = calc.metrics(records, state.asOf);
  const first = monthLabel(series[0].month, true);
  const last = monthLabel(series[n - 1].month, true);
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-labelledby': `${id}-t ${id}-d` });
  root.append(
    svg('title', { id: `${id}-t` }, 'Monthly invoiced versus ordered totals'),
    svg('desc', { id: `${id}-d` },
      `${n} month${n === 1 ? '' : 's'} from ${first} to ${last}. Invoiced amounts are grouped by invoice month ` +
      `and orders by order month, counting only dates on or before ${state.asOf}. ` +
      `Total invoiced ${money(m.invoiced)}; total ordered ${money(m.orders)}. ` +
      'Full values are available in the trend data table.'),
  );

  for (let i = 0; i <= ticks.count; i++) {
    const v = ticks.step * i;
    const yy = y(v);
    root.append(
      svg('line', { class: i === 0 ? 'axis-line' : 'grid-line', x1: pad.l, x2: W - pad.r, y1: yy, y2: yy }),
      svg('text', { x: pad.l - 6, y: yy + 4, 'text-anchor': 'end' }, axisLabel(v)),
    );
  }

  const step = Math.ceil(n / 12);
  const spansYears = series[0].month.slice(0, 4) !== series[n - 1].month.slice(0, 4);
  series.forEach((p, i) => {
    if (i % step !== 0 && i !== n - 1) return;
    const withYear = spansYears && (i === 0 || p.month.slice(5, 7) === '01');
    root.append(svg('text', { x: x(i), y: H - pad.b + 16, 'text-anchor': 'middle' }, monthLabel(p.month, withYear)));
  });

  const path = (key) => series.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  root.append(
    svg('path', { class: 'line-order', d: path('orders') }),
    svg('path', { class: 'line-invoice', d: path('invoiced') }),
  );

  const dots = svg('g', { 'aria-hidden': 'true' });
  series.forEach((p, i) => {
    const label = monthLabel(p.month, true);
    const o = svg('circle', { class: 'dot-order', cx: x(i), cy: y(p.orders), r: 3.5 });
    o.append(svg('title', {}, `${label} orders: ${money(p.orders)}`));
    const inv = svg('circle', { class: 'dot-invoice', cx: x(i), cy: y(p.invoiced), r: 3.5 });
    inv.append(svg('title', {}, `${label} invoiced: ${money(p.invoiced)}`));
    dots.append(o, inv);
  });
  root.append(dots);

  container.replaceChildren(root);
}

function renderAging(records) {
  const container = $('aging-chart');
  const tbody = $('aging-table').tBodies[0];
  const buckets = calc.agingBuckets(records, state.asOf);
  tbody.replaceChildren();

  for (const b of buckets) {
    tbody.append(el('tr', {}, [
      el('th', { text: b.label, attrs: { scope: 'row' } }),
      el('td', { className: 'num', text: Number(b.count).toLocaleString('en-US') }),
      el('td', { className: 'num', text: money(b.total) }),
    ]));
  }

  if (!buckets.length || buckets.every((b) => !b.total)) {
    chartEmpty(container, `Nothing outstanding as of ${state.asOf} for these filters.`);
    return;
  }

  const W = 420, rowH = 34, padL = 64, padR = 96, padT = 6;
  const H = padT * 2 + rowH * buckets.length;
  const iw = W - padL - padR;
  const maxVal = Math.max(...buckets.map((b) => b.total)) || 1;
  const id = `aging-${++chartSeq}`;
  const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-labelledby': `${id}-t ${id}-d` });
  const descText = buckets.map((b) => `${b.label}: ${money(b.total)} across ${b.count} invoice${b.count === 1 ? '' : 's'}`).join('; ');
  root.append(
    svg('title', { id: `${id}-t` }, `Receivables aging as of ${state.asOf}`),
    svg('desc', { id: `${id}-d` }, `${descText}.`),
  );

  buckets.forEach((b, i) => {
    const yTop = padT + i * rowH;
    const w = b.total > 0 ? Math.max(2, (iw * b.total) / maxVal) : 0;
    const cls = i === 0 ? 'bar bar--current' : i >= buckets.length - 2 ? 'bar bar--severe' : 'bar bar--late';
    const g = svg('g', { 'aria-hidden': 'true' });
    g.append(
      svg('text', { class: 'bar-label', x: padL - 8, y: yTop + rowH / 2 + 4, 'text-anchor': 'end' }, b.label),
      svg('rect', { class: cls, x: padL, y: yTop + 6, width: w, height: rowH - 12, rx: 3 }),
      svg('text', { class: 'bar-value', x: padL + w + 6, y: yTop + rowH / 2 + 4 }, money(b.total)),
    );
    g.firstChild.nextSibling.append(svg('title', {}, `${b.label}: ${money(b.total)} (${b.count})`));
    root.append(g);
  });
  root.append(svg('line', { class: 'axis-line', x1: padL, x2: padL, y1: padT, y2: H - padT }));

  container.replaceChildren(root);
}

// ---------- table ----------

function sortValue(row, key) {
  if (key === 'paid') return row.paid;
  if (key === 'outstanding') return row.outstanding;
  const v = row.record[key];
  return v === null || v === undefined ? '' : v;
}

function sortRows(rows) {
  const { sortKey, sortDir } = state;
  const dir = sortDir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const va = sortValue(a, sortKey);
    const vb = sortValue(b, sortKey);
    let c = 0;
    if (typeof va === 'number' && typeof vb === 'number') c = va - vb;
    else c = String(va).localeCompare(String(vb), 'en', { numeric: true });
    if (c === 0) c = String(a.record.id).localeCompare(String(b.record.id), 'en', { numeric: true });
    return c * dir;
  });
}

function updateSortHeaders() {
  document.querySelectorAll('#tx-table thead th[data-key]').forEach((th) => {
    if (th.dataset.key === state.sortKey) th.setAttribute('aria-sort', state.sortDir === 'asc' ? 'ascending' : 'descending');
    else th.removeAttribute('aria-sort');
  });
}

// Explains an empty valid result. Invoice basis also drops invoices dated after as-of
// (calc.filterRecords), so an early as-of can empty the table even inside a wide range.
function emptyReason() {
  const basis = basisName(state.basis);
  const asOfLimits = state.basis === 'invoiceDate' && state.asOf < state.to;
  if (state.search) {
    return `Nothing matches “${state.search}” in this ${basis} range. Check the spelling or clear the search.`;
  }
  if (asOfLimits) {
    return `No records have an invoice date between ${state.from} and ${state.to} that is also on or before ` +
      `the as-of date ${state.asOf}. Move the as-of date later, widen the range, or switch to order date.`;
  }
  return `No records have an ${basis} between ${state.from} and ${state.to}. ` +
    'Try widening the range or switching the date basis.';
}

function renderTable(unavailableMessage) {
  const tbody = $('tx-body');
  const empty = $('tx-empty');
  const total = currentRows.length;
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  state.page = Math.min(Math.max(1, state.page), pages);
  updateSortHeaders();

  $('export').disabled = total === 0;
  $('prev-page').disabled = state.page <= 1;
  $('next-page').disabled = state.page >= pages;
  $('page-label').textContent = `Page ${state.page} of ${pages}`;

  if (total === 0) {
    tbody.replaceChildren();
    $('tx-empty-title').textContent = unavailableMessage
      ? 'Transactions are unavailable until the filters are valid.'
      : 'No transactions match these filters.';
    $('tx-empty-body').textContent = unavailableMessage || emptyReason();
    empty.hidden = false;
    $('table-status').textContent = unavailableMessage ? '' : 'No matching transactions.';
    return;
  }
  empty.hidden = true;

  const start = (state.page - 1) * state.pageSize;
  const slice = currentRows.slice(start, start + state.pageSize);
  const frag = document.createDocumentFragment();
  for (const row of slice) {
    const r = row.record;
    const futureInvoice = r.invoiceDate > state.asOf;
    const futureNote = futureInvoice ? { title: `Invoiced after the as-of date ${state.asOf}; not counted in as-of totals` } : {};
    const tr = el('tr', {}, [
      el('td', { text: r.id }),
      el('td', { text: r.accountId }),
      el('td', { text: r.product }),
      el('td', { text: r.orderDate }),
      el('td', { text: r.invoiceDate, className: futureInvoice ? 'is-muted' : '', attrs: futureNote }),
      el('td', { text: r.dueDate, className: row.overdue ? 'is-overdue' : '', attrs: row.overdue ? { title: 'Overdue as of the as-of date' } : {} }),
      // Order basis can keep an order whose invoice is after as-of; show its amount muted so the
      // column does not look like it disagrees with the as-of Invoice amount card.
      el('td', { className: `num${futureInvoice ? ' is-muted' : ''}`, text: money(r.invoiceAmount), attrs: futureNote }),
      el('td', { className: 'num', text: money(row.paid) }),
      el('td', { className: `num${row.overdue ? ' is-overdue' : ''}`, text: money(row.outstanding) }),
    ]);
    frag.append(tr);
  }
  tbody.replaceChildren(frag);
  $('table-status').textContent =
    `Showing ${start + 1}–${start + slice.length} of ${total.toLocaleString('en-US')} transactions.`;
}

function exportCsv() {
  // Apply a search that is still inside its debounce window, so the file matches the search box.
  if (flushSearch() && !currentRows.length) {
    $('table-status').textContent = 'Nothing to export: no transactions match the current search.';
    $('search').focus(); // the Export button is now disabled; keep keyboard focus somewhere useful
    return;
  }
  if (!currentRows.length) return;
  let text;
  try {
    text = calc.csvForRecords(currentRows.map((r) => r.record), state.asOf);
  } catch (err) {
    $('table-status').textContent = `Export failed: ${errorText(err)}`;
    return;
  }
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fictional-sales_${state.basis}-basis_${state.from}_to_${state.to}_asof_${state.asOf}.csv`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('table-status').textContent = `Exported ${currentRows.length.toLocaleString('en-US')} filtered rows to CSV.`;
}

// ---------- controls ----------

function writeControls() {
  $('basis').value = state.basis;
  $('from').value = state.from;
  $('to').value = state.to;
  $('asof').value = state.asOf;
  $('search').value = state.search;
  $('page-size').value = String(state.pageSize);
}

// Applies the search box value now (cancelling any pending debounce). Returns true if it re-rendered.
function flushSearch() {
  clearTimeout(searchTimer);
  searchTimer = 0;
  const value = $('search').value.trim();
  if (value === state.search) return false;
  state.search = value;
  state.page = 1;
  render();
  return true;
}

function resetFilters() {
  clearTimeout(searchTimer); // a pending keystroke must not re-apply a search after reset
  searchTimer = 0;
  Object.assign(state, DEFAULTS, { page: 1 });
  writeControls();
  render();
}

// Paging buttons disable themselves at either end; move focus instead of dropping it to <body>.
function changePage(delta, fromBtn) {
  state.page += delta;
  renderTable();
  if (fromBtn.disabled) {
    const other = fromBtn.id === 'next-page' ? $('prev-page') : $('next-page');
    (other.disabled ? $('search') : other).focus();
  }
}

function bindControls() {
  const onFilter = () => {
    state.basis = $('basis').value === 'orderDate' ? 'orderDate' : 'invoiceDate';
    state.from = $('from').value;
    state.to = $('to').value;
    state.asOf = $('asof').value;
    state.page = 1;
    render();
  };
  ['basis', 'from', 'to', 'asof'].forEach((id) => $(id).addEventListener('change', onFilter));
  $('filter-form').addEventListener('submit', (e) => { e.preventDefault(); onFilter(); });

  $('search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(flushSearch, 200);
  });
  // Enter applies the search immediately (the field is outside the filter form).
  $('search').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); flushSearch(); } });

  $('reset').addEventListener('click', resetFilters);
  $('empty-reset').addEventListener('click', () => { resetFilters(); $('search').focus(); });
  $('export').addEventListener('click', exportCsv);

  $('page-size').addEventListener('change', () => {
    state.pageSize = Number($('page-size').value) || 25;
    state.page = 1;
    renderTable();
  });
  $('prev-page').addEventListener('click', (e) => changePage(-1, e.currentTarget));
  $('next-page').addEventListener('click', (e) => changePage(1, e.currentTarget));

  document.querySelectorAll('#tx-table thead th[data-key] .sort').forEach((btn) => {
    btn.addEventListener('click', () => {
      flushSearch(); // sort the rows the search box currently describes
      const key = btn.closest('th').dataset.key;
      if (state.sortKey === key) state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
      else { state.sortKey = key; state.sortDir = /Date$/.test(key) || ['id', 'product', 'accountId'].includes(key) ? 'asc' : 'desc'; }
      currentRows = sortRows(currentRows);
      state.page = 1;
      renderTable();
    });
  });
}

// ---------- boot ----------

async function boot() {
  // Module scripts ran, so the "file://" warning is not the problem; hide it.
  $('load-status').hidden = true;

  let dataMod;
  try {
    [dataMod, calc] = await Promise.all([import('./data.js'), import('./calc.js')]);
  } catch (err) {
    showFatal('The demo data or calculation module could not be loaded.', [errorText(err)]);
    return;
  }

  const missing = REQUIRED_CALC.filter((name) => typeof calc[name] !== 'function');
  if (typeof dataMod.generateFixture !== 'function') missing.push('generateFixture (data.js)');
  if (missing.length) {
    showFatal('The calculation module is incomplete. Missing:', missing);
    return;
  }

  try {
    const records = dataMod.generateFixture();
    if (!Array.isArray(records)) throw new Error('Fixture is not a list of records.');
    // calc.validateRecords returns true or throws; readValidation also tolerates a returned result.
    const check = readValidation(calc.validateRecords(records));
    if (!check.ok) {
      showFatal('The demo data did not pass validation, so figures are not shown.', check.errors);
      return;
    }
    allRecords = records;
  } catch (err) {
    showFatal('The demo data did not pass validation, so figures are not shown.', [errorText(err)]);
    return;
  }

  writeControls();
  bindControls();
  render();
}

boot();
