// Entirely fictional. No private data, source tables or real entities were used.
// Integer arithmetic and fixed dates make every load reproducible.
const DAY = 86400000;
const iso = day => new Date(day).toISOString().slice(0, 10);
const addDays = (date, count) => iso(Date.parse(date + 'T00:00:00Z') + count * DAY);

export function generateFixture() {
  const rows = [];
  for (let month = 0; month < 12; month++) {
    for (let item = 0; item < 12; item++) {
      const index = month * 12 + item;
      const orderDate = iso(Date.UTC(2025, month, 2 + item * 2));
      const invoiceDate = addDays(orderDate, 2 + index % 17);
      const dueDate = addDays(invoiceDate, [15, 30, 45, 60][index % 4]);
      const orderAmount = (160 + month * 13 + (item * 71) % 540) * 100;
      const invoiceAmount = orderAmount - (index % 5 === 0 ? 2000 : 0);
      const paymentType = index % 5;
      const paidAmount = paymentType < 2 ? invoiceAmount : paymentType === 2 ? Math.floor(invoiceAmount / 2) : 0;
      rows.push({
        id: 'SampleOrder' + String(index + 1).padStart(3, '0'),
        accountId: 'SampleAccount' + String(index % 18 + 1).padStart(3, '0'),
        product: ['ComponentA', 'ComponentB', 'ComponentC', 'ComponentD'][index % 4],
        orderDate, invoiceDate, dueDate, orderAmount, invoiceAmount, paidAmount,
        paymentDate: paidAmount > 0 ? addDays(invoiceDate, [12, 35, 50][paymentType]) : null
      });
    }
  }
  return rows;
}
