// Pure calculations. Money is integer USD cents; calendar days are UTC.
const DAY = 86400000;
const MAX_ROWS = 10000;
const MONEY_LIMIT = 100000000000;
const moneyFields = ['orderAmount', 'invoiceAmount', 'paidAmount'];

export function dateDay(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '2100-12-31') throw new TypeError('Use a valid date from 1900 through 2100 (YYYY-MM-DD).');
  const stamp = Date.parse(value + 'T00:00:00Z');
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value) throw new TypeError('Use a real calendar date.');
  return stamp / DAY;
}

export function validateRecords(records) {
  if (!Array.isArray(records) || records.length > MAX_ROWS) throw new TypeError('Expected an array of at most 10,000 records.');
  const ids = new Set();
  records.forEach((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('Invalid record at ' + index);
    for (const field of ['id', 'accountId', 'product']) {
      if (typeof row[field] !== 'string' || !row[field].trim() || row[field].length > 100 || /[\x00-\x1f\x7f]/.test(row[field])) throw new TypeError('Invalid ' + field + ' at ' + index);
    }
    if (ids.has(row.id)) throw new TypeError('Duplicate record ID.');
    ids.add(row.id);
    for (const field of moneyFields) if (!Number.isSafeInteger(row[field]) || row[field] < 0 || row[field] > MONEY_LIMIT) throw new TypeError('Invalid integer cents in ' + field);
    const order = dateDay(row.orderDate), invoice = dateDay(row.invoiceDate), due = dateDay(row.dueDate);
    if (invoice < order || due < invoice || row.paidAmount > row.invoiceAmount) throw new TypeError('Inconsistent invoice dates or amounts.');
    if (row.paidAmount > 0 && (row.paymentDate === null || dateDay(row.paymentDate) < invoice)) throw new TypeError('A payment needs a valid payment date on or after invoicing.');
    if (row.paidAmount === 0 && row.paymentDate !== null) throw new TypeError('An unpaid invoice must have a null payment date.');
  });
  return true;
}

export function formatMoney(cents) {
  if (!Number.isSafeInteger(cents)) throw new TypeError('Money must be integer cents.');
  // Dividing a large safe integer by 100 can round away a cent. Format the
  // whole-dollar and remainder integers separately, including negative cents.
  const absolute = Math.abs(cents);
  const dollars = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.floor(absolute / 100));
  return (cents < 0 ? '-' : '') + '$' + dollars + '.' + String(absolute % 100).padStart(2, '0');
}

export function filterRecords(records, { from = '', to = '', basis = 'invoiceDate', search = '', asOf = '2025-12-31' } = {}) {
  if (!['invoiceDate', 'orderDate'].includes(basis)) throw new TypeError('Choose invoice date or order date.');
  if (from) dateDay(from);
  if (to) dateDay(to);
  dateDay(asOf);
  if (from && to && from > to) throw new RangeError('From must be on or before To.');
  if (typeof search !== 'string' || search.length > 100) throw new TypeError('Search is limited to 100 characters.');
  const query = search.trim().toLowerCase();
  return records.filter(row => (!from || row[basis] >= from) && (!to || row[basis] <= to) && (basis !== 'invoiceDate' || row.invoiceDate <= asOf) && (!query || [row.id, row.accountId, row.product].some(value => value.toLowerCase().includes(query))));
}

export function paidAt(row, asOf) {
  dateDay(asOf);
  return row.invoiceDate <= asOf && row.paymentDate && row.paymentDate <= asOf ? row.paidAmount : 0;
}

export function outstandingAt(row, asOf) {
  dateDay(asOf);
  return row.invoiceDate <= asOf ? row.invoiceAmount - paidAt(row, asOf) : 0;
}

export function metrics(records, asOf) {
  dateDay(asOf);
  return records.reduce((sum, row) => {
    if (row.orderDate <= asOf) sum.orders += row.orderAmount;
    if (row.invoiceDate <= asOf) sum.invoiced += row.invoiceAmount;
    sum.paid += paidAt(row, asOf);
    const outstanding = outstandingAt(row, asOf);
    sum.outstanding += outstanding;
    if (row.dueDate < asOf) sum.overdue += outstanding;
    sum.count++;
    return sum;
  }, { orders: 0, invoiced: 0, paid: 0, outstanding: 0, overdue: 0, count: 0 });
}

export function monthlySeries(records, asOf = '2100-12-31') {
  dateDay(asOf);
  const months = new Map();
  const ensure = date => {
    const month = date.slice(0, 7);
    if (!months.has(month)) months.set(month, { month, orders: 0, invoiced: 0 });
    return months.get(month);
  };
  for (const row of records) {
    if (row.orderDate <= asOf) ensure(row.orderDate).orders += row.orderAmount;
    if (row.invoiceDate <= asOf) ensure(row.invoiceDate).invoiced += row.invoiceAmount;
  }
  const ordered = [...months.values()].sort((a, b) => a.month.localeCompare(b.month));
  if (!ordered.length) return [];
  // Preserve calendar spacing when a selected cohort skips an entire month.
  const first = ordered[0].month, last = ordered.at(-1).month;
  const result = [];
  let cursor = first;
  while (cursor <= last) {
    result.push(months.get(cursor) || { month: cursor, orders: 0, invoiced: 0 });
    const [year, month] = cursor.split('-').map(Number);
    cursor = month === 12 ? String(year + 1) + '-01' : String(year) + '-' + String(month + 1).padStart(2, '0');
  }
  return result;
}

export function agingBuckets(records, asOf) {
  const today = dateDay(asOf);
  const result = ['Current', '1–30', '31–60', '61–90', '91+'].map(label => ({ label, total: 0, count: 0 }));
  for (const row of records) {
    const amount = outstandingAt(row, asOf);
    if (amount <= 0) continue;
    const late = today - dateDay(row.dueDate);
    const index = late <= 0 ? 0 : late <= 30 ? 1 : late <= 60 ? 2 : late <= 90 ? 3 : 4;
    result[index].total += amount;
    result[index].count++;
  }
  return result;
}

function csvCell(value) {
  let text = String(value ?? '');
  // Spreadsheet applications may execute formulas even after leading whitespace.
  if (/^[\s]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}

export function csvForRecords(records, asOf) {
  dateDay(asOf);
  const headers = ['id', 'accountId', 'product', 'orderDate', 'invoiceDate', 'dueDate', 'orderAmountUSD', 'invoiceAmountUSD', 'paidAsOfUSD', 'outstandingAsOfUSD', 'asOf'];
  const rows = records.map(row => [row.id, row.accountId, row.product, row.orderDate, row.invoiceDate, row.dueDate, (row.orderAmount / 100).toFixed(2), (row.invoiceAmount / 100).toFixed(2), (paidAt(row, asOf) / 100).toFixed(2), (outstandingAt(row, asOf) / 100).toFixed(2), asOf]);
  return [headers, ...rows].map(row => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
