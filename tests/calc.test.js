import test from 'node:test';
import assert from 'node:assert/strict';
import { generateFixture } from '../data.js';
import { dateDay, validateRecords, formatMoney, filterRecords, paidAt, outstandingAt, metrics, monthlySeries, agingBuckets, csvForRecords } from '../calc.js';

const base = { id: 'SampleOrder001', accountId: 'SampleAccount001', product: 'ComponentA', orderDate: '2025-01-01', invoiceDate: '2025-01-10', dueDate: '2025-02-10', orderAmount: 12000, invoiceAmount: 10000, paidAmount: 4000, paymentDate: '2025-02-15' };
const row = overrides => ({ ...base, ...overrides });

test('fixture is deterministic, entirely synthetic, valid and independent per call', () => {
  const a = generateFixture(), b = generateFixture();
  assert.deepEqual(a, b);
  assert.equal(a.length, 144);
  assert.equal(validateRecords(a), true);
  assert.ok(a.every(r => /^SampleOrder\d{3}$/.test(r.id) && /^SampleAccount\d{3}$/.test(r.accountId) && /^Component[A-D]$/.test(r.product)));
  a[0].product = 'Changed';
  assert.equal(b[0].product, 'ComponentA');
});

test('strict UTC calendar dates reject rollovers, timezones and missing dates', () => {
  assert.equal(dateDay('2024-03-01') - dateDay('2024-02-28'), 2);
  for (const bad of ['', '2025-02-29', '2025-04-31', '2025-1-01', '2025-01-01T00:00:00Z', '1899-12-31', '2101-01-01', null]) assert.throws(() => dateDay(bad));
});

test('record validation rejects inconsistent cents, dates, duplicate IDs and unbounded text', () => {
  for (const changed of [{ invoiceAmount: 1.2 }, { paidAmount: 11000 }, { invoiceAmount: -1 }, { orderAmount: Number.MAX_SAFE_INTEGER }, { invoiceDate: '2024-12-31' }, { dueDate: '2025-01-09' }, { paymentDate: null }, { paymentDate: '2025-01-09' }, { id: '' }, { product: 'x'.repeat(101) }]) assert.throws(() => validateRecords([row(changed)]));
  assert.throws(() => validateRecords([row({}), row({})]));
  assert.throws(() => validateRecords(Array(10001).fill(base)));
  assert.throws(() => validateRecords([row({ paidAmount: 0, paymentDate: '2025-03-01' })]));
  assert.equal(validateRecords([]), true);
});

test('as-of distinguishes invoice existence, paid date and overdue due date', () => {
  assert.equal(outstandingAt(base, '2025-01-09'), 0);
  assert.equal(outstandingAt(base, '2025-01-10'), 10000);
  assert.equal(paidAt(base, '2025-02-14'), 0);
  assert.equal(outstandingAt(base, '2025-02-15'), 6000);
  assert.deepEqual(metrics([base], '2025-02-10'), { orders: 12000, invoiced: 10000, paid: 0, outstanding: 10000, overdue: 0, count: 1 });
  assert.equal(metrics([base], '2025-02-11').overdue, 10000);
  assert.equal(metrics([base], '2025-02-15').overdue, 6000);
});

test('date basis selects inclusive row cohort; as-of excludes future invoices only for invoice basis', () => {
  const records = [base, row({ id: 'SampleOrder002', orderDate: '2025-01-10', invoiceDate: '2025-02-01', dueDate: '2025-03-01', paidAmount: 0, paymentDate: null })];
  assert.deepEqual(filterRecords(records, { from: '2025-01-10', to: '2025-01-10', basis: 'invoiceDate', asOf: '2025-01-31' }), [base]);
  assert.equal(filterRecords(records, { from: '2025-01-10', to: '2025-01-10', basis: 'orderDate', asOf: '2025-01-31' })[0].id, 'SampleOrder002');
  assert.equal(filterRecords(records, { search: 'componenta', asOf: '2025-12-31' }).length, 2);
  assert.equal(filterRecords(records, { search: 'nobody', asOf: '2025-12-31' }).length, 0);
  assert.throws(() => filterRecords(records, { from: '2025-02-01', to: '2025-01-01' }));
  assert.throws(() => filterRecords(records, { basis: 'dueDate' }));
});

test('aging boundaries count outstanding cents exactly once; paid and future invoices are excluded', () => {
  const dueDates = ['2025-05-01', '2025-04-30', '2025-04-01', '2025-03-31', '2025-03-02', '2025-03-01', '2025-01-31', '2025-01-30'];
  const records = dueDates.map((dueDate, i) => row({ id: 'Age' + i, dueDate, paidAmount: 0, paymentDate: null }));
  records.push(row({ id: 'Paid', paidAmount: 10000 }), row({ id: 'Future', invoiceDate: '2025-05-02', dueDate: '2025-05-30', paidAmount: 0, paymentDate: null }));
  const buckets = agingBuckets(records, '2025-05-01');
  assert.deepEqual(buckets.map(b => b.label), ['Current', '1–30', '31–60', '61–90', '91+']);
  assert.deepEqual(buckets.map(b => b.total), [10000, 20000, 20000, 20000, 10000]);
  assert.deepEqual(buckets.map(b => b.count), [1, 2, 2, 2, 1]);
  assert.equal(buckets.reduce((s, b) => s + b.total, 0), metrics(records, '2025-05-01').outstanding);
});

test('month comparisons use each natural date and reconcile as-of metrics', () => {
  const records = [base, row({ id: 'SampleOrder002', orderDate: '2025-01-31', invoiceDate: '2025-02-02', dueDate: '2025-03-02', paidAmount: 0, paymentDate: null })];
  assert.deepEqual(monthlySeries(records, '2025-01-31'), [{ month: '2025-01', orders: 24000, invoiced: 10000 }]);
  assert.deepEqual(monthlySeries(records, '2025-02-02'), [{ month: '2025-01', orders: 24000, invoiced: 10000 }, { month: '2025-02', orders: 0, invoiced: 10000 }]);
  const fixture = generateFixture();
  for (const asOf of ['2024-12-31', '2025-06-15', '2025-12-31', '2026-04-01']) {
    const sum = metrics(fixture, asOf), series = monthlySeries(fixture, asOf), aging = agingBuckets(fixture, asOf);
    assert.equal(series.reduce((s, r) => s + r.orders, 0), sum.orders);
    assert.equal(series.reduce((s, r) => s + r.invoiced, 0), sum.invoiced);
    assert.equal(sum.invoiced - sum.paid, sum.outstanding);
    assert.equal(aging.reduce((s, r) => s + r.total, 0), sum.outstanding);
  }
});

test('empty states stay zero, maintain CSV headers and return no invented trends', () => {
  assert.deepEqual(metrics([], '2025-12-31'), { orders: 0, invoiced: 0, paid: 0, outstanding: 0, overdue: 0, count: 0 });
  assert.deepEqual(monthlySeries([]), []);
  assert.equal(agingBuckets([], '2025-12-31').every(b => b.total === 0 && b.count === 0), true);
  assert.equal(csvForRecords([], '2025-12-31').split('\r\n').length, 2);
  assert.equal(formatMoney(12345), '$123.45');
});

test('monthly comparisons retain missing calendar months as zero rather than compressing the timeline', () => {
  const records = [base, row({ id: 'March', orderDate: '2025-03-01', invoiceDate: '2025-03-02', dueDate: '2025-03-30', paidAmount: 0, paymentDate: null })];
  assert.deepEqual(monthlySeries(records, '2025-12-31').map(r => r.month), ['2025-01', '2025-02', '2025-03']);
  assert.deepEqual(monthlySeries(records, '2025-12-31')[1], { month: '2025-02', orders: 0, invoiced: 0 });
});

test('CSV includes as-of paid balance, escaped quotes and neutralized spreadsheet formulas', () => {
  const text = csvForRecords([row({ accountId: '=HYPERLINK("x")', product: '  +1' })], '2025-02-14');
  assert.ok(text.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(text.includes('"\'  +1"'));
  assert.ok(text.includes('"0.00","100.00","2025-02-14"'));
  assert.ok(text.endsWith('\r\n'));
});
