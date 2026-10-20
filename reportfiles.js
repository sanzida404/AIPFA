'use strict';
// Builds Excel (.xlsx), Word (.docx), PDF and PowerPoint (.pptx) reports for the AI assistant.
// Libraries are loaded only when a report is requested, so the rest of the site never depends on them.
const r2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const num = (n) => Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function prepare(rep, opts) {
  const k = opts.currency.rate, c = (x) => r2(x * k);
  const income = rep.income;
  const filterLabels = { all: 'All transactions', income: 'Income transactions only', expenses: 'Expense transactions only', savings: 'Savings transactions only' };
  const transactionLabel = filterLabels[rep.transactionFilter] || filterLabels.all;
  const summary = [
    ['Opening balance', c(rep.openingBalance)],
    ['Income during selected range', c(rep.income)],
    ['Income plus opening balance', c(rep.incomeIncludingCarryIn)],
    ['Cumulative income through end date', c(rep.cumulativeIncome)],
    ['Spending', c(rep.spent)],
    ['Savings set aside', c(rep.saved)],
    ['Net (income - spending - savings)', c(rep.net)],
    ['Closing balance', c(rep.closingBalance)],
  ];
  return {
    code: opts.currency.code,
    rateNote: opts.currency.code === 'USD' ? '' : `Converted from USD at 1 USD = ${opts.currency.rate} ${opts.currency.code}`,
    range: `${rep.start} to ${rep.end}${rep.transactionFilter && rep.transactionFilter !== 'all' ? ` · ${transactionLabel}` : ''}`,
    transactionLabel,
    generated: opts.generatedAt,
    user: opts.loginId,
    summary,
    savingsRate: income > 0 ? `${((rep.saved / income) * 100).toFixed(1)}%` : 'n/a',
    cats: rep.byCat.map((x) => ({ category: x.category, amount: c(x.amount), percent: x.percent })),
    periods: rep.periods.map((p) => ({ label: p.label, budget: c(p.budget), spent: c(p.spent), remaining: p.budget ? c(p.budget - p.spent) : null })),
    months: (rep.byMonthList || []).map((m) => ({ month: m.month, income: c(m.income), spent: c(m.spent), saved: c(m.saved), net: c(m.income - m.spent - m.saved) })),
    days: rep.byDayList.map((d) => ({ date: d.date, income: c(d.income), spent: c(d.spent), saved: c(d.saved) })),
    tx: rep.rows.map((t) => ({ date: t.date, type: t.type === 'income' ? 'Income' : t.category === 'Savings' ? 'Savings' : 'Expense', category: t.category, note: t.note || '', amount: c(t.amount) })),
  };
}

// ---------------- Excel ----------------
async function buildXlsx(P) {
  const ExcelJS = require('exceljs');
  const wb = new ExcelJS.Workbook();
  wb.creator = 'AIPFA'; wb.created = new Date();
  const money = '#,##0.00';
  const head = (row) => { row.font = { bold: true, color: { argb: 'FFFFFFFF' } }; row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2563EB' } }; };

  const s = wb.addWorksheet('Summary');
  s.columns = [{ width: 40 }, { width: 22 }];
  s.addRow(['AIPFA Finance Report']).font = { bold: true, size: 16 };
  s.addRow(['Period', P.range]); s.addRow(['Currency', P.code]); s.addRow(['Generated', P.generated]);
  if (P.rateNote) s.addRow(['Rate', P.rateNote]);
  s.addRow([]);
  head(s.addRow(['Item', `Amount (${P.code})`]));
  P.summary.forEach(([label, v]) => { const r = s.addRow([label, v]); r.getCell(2).numFmt = money; });
  s.addRow(['Savings rate (savings / income)', P.savingsRate]);

  const c = wb.addWorksheet('Categories');
  c.columns = [{ width: 24 }, { width: 18 }, { width: 16 }];
  head(c.addRow(['Category', `Spending (${P.code})`, '% of spending']));
  P.cats.forEach((x) => { const r = c.addRow([x.category, x.amount, x.percent / 100]); r.getCell(2).numFmt = money; r.getCell(3).numFmt = '0.0%'; });
  if (P.cats.length) {
    const total = r2(P.cats.reduce((a, x) => a + x.amount, 0));
    const r = c.addRow(['Total', { formula: `SUM(B2:B${P.cats.length + 1})`, result: total }, { formula: `SUM(C2:C${P.cats.length + 1})`, result: 1 }]);
    r.font = { bold: true }; r.getCell(2).numFmt = money; r.getCell(3).numFmt = '0.0%';
  } else c.addRow(['No spending in this period']);

  const b = wb.addWorksheet('Budgets');
  b.columns = [{ width: 30 }, { width: 18 }, { width: 18 }, { width: 18 }];
  head(b.addRow(['Accounting period', `Budget (${P.code})`, `Spent (${P.code})`, `Remaining (${P.code})`]));
  P.periods.forEach((p) => { const r = b.addRow([p.label, p.budget || 'not set', p.spent, p.remaining === null ? '' : p.remaining]); [2, 3, 4].forEach((i) => (r.getCell(i).numFmt = money)); });

  const m = wb.addWorksheet('Monthly');
  m.columns = [{ width: 16 }, { width: 18 }, { width: 18 }, { width: 18 }, { width: 18 }];
  head(m.addRow(['Calendar month', `Income (${P.code})`, `Spending (${P.code})`, `Savings (${P.code})`, `Net (${P.code})`]));
  P.months.forEach((x) => { const r = m.addRow([x.month, x.income, x.spent, x.saved, x.net]); [2, 3, 4, 5].forEach((i) => (r.getCell(i).numFmt = money)); });

  const d = wb.addWorksheet('Daily');
  d.columns = [{ width: 14 }, { width: 16 }, { width: 16 }, { width: 16 }];
  head(d.addRow(['Date', `Income (${P.code})`, `Spending (${P.code})`, `Savings (${P.code})`]));
  P.days.forEach((x) => { const r = d.addRow([new Date(`${x.date}T00:00:00Z`), x.income, x.spent, x.saved]); r.getCell(1).numFmt = 'yyyy-mm-dd'; [2, 3, 4].forEach((i) => (r.getCell(i).numFmt = money)); });
  d.views = [{ state: 'frozen', ySplit: 1 }];

  const txSheet = { income: 'Income', expenses: 'Expenses', savings: 'Savings', all: 'Transactions' }[P.transactionFilter] || 'Transactions';
  const t = wb.addWorksheet(txSheet);
  t.columns = [{ width: 14 }, { width: 11 }, { width: 16 }, { width: 46 }, { width: 18 }];
  head(t.addRow(['Date', 'Type', 'Category', 'Note', `Amount (${P.code})`]));
  P.tx.forEach((x) => { const r = t.addRow([new Date(`${x.date}T00:00:00Z`), x.type, x.category, x.note, x.amount]); r.getCell(1).numFmt = 'yyyy-mm-dd'; r.getCell(5).numFmt = money; });
  t.views = [{ state: 'frozen', ySplit: 1 }];
  if (P.tx.length) {
    t.autoFilter = { from: 'A1', to: `E${P.tx.length + 1}` };
    const last = P.tx.length + 1;
    t.addRow([]);
    [['Total income', 'Income'], ['Total spending', 'Expense'], ['Total savings', 'Savings']].forEach(([label, type]) => {
      const total = r2(P.tx.filter((x) => x.type === type).reduce((a, x) => a + x.amount, 0));
      const r = t.addRow([label, '', '', '', { formula: `SUMIF(B2:B${last},"${type}",E2:E${last})`, result: total }]);
      r.font = { bold: true }; r.getCell(5).numFmt = money;
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------- Word ----------------
async function buildDocx(P) {
  const D = require('docx');
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, ShadingType, AlignmentType, HeadingLevel, BorderStyle } = D;
  const line = { style: BorderStyle.SINGLE, size: 4, color: 'D0D7E2' };
  const borders = { top: line, bottom: line, left: line, right: line };
  const cell = (text, width, { head = false, right = false } = {}) => new TableCell({
    width: { size: width, type: WidthType.DXA }, borders,
    shading: head ? { type: ShadingType.CLEAR, fill: '2563EB', color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    children: [new Paragraph({ alignment: right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: String(text), bold: head, color: head ? 'FFFFFF' : undefined, size: 18, font: 'Arial' })] })],
  });
  const table = (headers, rows, widths, rightCols = []) => new Table({
    width: { size: widths.reduce((a, b) => a + b, 0), type: WidthType.DXA }, columnWidths: widths,
    rows: [
      new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, widths[i], { head: true, right: rightCols.includes(i) })) }),
      ...rows.map((r) => new TableRow({ children: r.map((v, i) => cell(v, widths[i], { right: rightCols.includes(i) })) })),
    ],
  });
  const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 280, after: 120 }, children: [new TextRun({ text, font: 'Arial' })] });
  const p = (text, opts = {}) => new Paragraph({ spacing: { after: 60 }, children: [new TextRun({ text, font: 'Arial', size: 20, ...opts })] });
  const none = (text) => p(text, { italics: true, color: '6B7588' });

  const kids = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: 'AIPFA Finance Report', font: 'Arial' })] }),
    p(`Period: ${P.range}`), p(`Currency: ${P.code}${P.rateNote ? ` (${P.rateNote})` : ''}`), p(`Generated: ${P.generated}`),
    h1('Summary'),
    table(['Item', `Amount (${P.code})`], [...P.summary.map(([l, v]) => [l, num(v)]), ['Savings rate (savings / income)', P.savingsRate]], [6000, 3746], [1]),
    h1('Spending by category'),
    P.cats.length ? table(['Category', `Amount (${P.code})`, '% of spending'], P.cats.map((x) => [x.category, num(x.amount), `${x.percent.toFixed(1)}%`]), [4500, 3000, 2246], [1, 2]) : none('No spending in this period.'),
    h1('Budgets'),
    P.periods.length ? table(['Accounting period', 'Budget', 'Spent', 'Remaining'], P.periods.map((x) => [x.label, x.budget ? num(x.budget) : 'not set', num(x.spent), x.remaining === null ? '-' : num(x.remaining)]), [3746, 2000, 2000, 2000], [1, 2, 3]) : none('No budget data.'),
    h1('Monthly cashflow'),
    P.months.length ? table(['Calendar month', 'Income', 'Spending', 'Savings', 'Net'], P.months.map((x) => [x.month, num(x.income), num(x.spent), num(x.saved), num(x.net)]), [2500, 1811, 1811, 1811, 1813], [1, 2, 3, 4]) : none('No monthly data.'),
    h1('Daily totals'),
    P.days.length ? table(['Date', 'Income', 'Spending', 'Savings'], P.days.map((x) => [x.date, num(x.income), num(x.spent), num(x.saved)]), [3000, 2250, 2250, 2246], [1, 2, 3]) : none('No activity.'),
    h1(P.transactionLabel),
    P.tx.length ? table(['Date', 'Type', 'Category', 'Note', `Amount (${P.code})`], P.tx.map((x) => [x.date, x.type, x.category, x.note, num(x.amount)]), [1300, 1100, 1500, 4146, 1700], [4]) : none('No transactions in this period.'),
  ];
  const doc = new Document({
    creator: 'AIPFA', title: 'AIPFA Finance Report',
    styles: { default: { document: { run: { font: 'Arial', size: 20 } } } },
    sections: [{ properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } }, children: kids }],
  });
  return Buffer.from(await Packer.toBuffer(doc));
}

// ---------------- PowerPoint ----------------
async function buildPptx(P) {
  const PptxGenJS = require('pptxgenjs');
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.author = 'AIPFA';
  pptx.subject = `Personal finance report ${P.range}`;
  pptx.title = 'AIPFA Finance Report';
  pptx.company = 'AIPFA';
  pptx.lang = 'en-US';
  pptx.theme = { headFontFace: 'Aptos Display', bodyFontFace: 'Aptos', lang: 'en-US' };

  const SW = 13.333, SH = 7.5, ink = '172033', muted = '667085', blue = '2563EB', pale = 'F3F6FC', line = 'DCE3EF';
  const money = (n) => `${P.code} ${num(n)}`;
  const addContentSlide = (title, subtitle = P.range) => {
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addText(title, { x: 0.65, y: 0.35, w: 12, h: 0.45, fontFace: 'Aptos Display', fontSize: 25, bold: true, color: ink, margin: 0 });
    slide.addText(subtitle, { x: 0.67, y: 0.86, w: 12, h: 0.25, fontFace: 'Aptos', fontSize: 10, color: muted, margin: 0 });
    slide.addShape(pptx.ShapeType.line, { x: 0.65, y: 1.22, w: 12, h: 0, line: { color: line, width: 1 } });
    slide.addText(`AIPFA • ${P.generated}`, { x: 0.65, y: 7.16, w: 12, h: 0.16, fontFace: 'Aptos', fontSize: 8, color: muted, align: 'right', margin: 0 });
    return slide;
  };
  const drawTable = (slide, headers, rows, y, widths) => {
    const x = 0.65, rowH = 0.38, totalW = widths.reduce((a, b) => a + b, 0);
    const drawRow = (values, rowIndex, isHeader) => {
      const top = y + rowIndex * rowH;
      slide.addShape(pptx.ShapeType.rect, { x, y: top, w: totalW, h: rowH, line: { color: line, width: 0.35 }, fill: { color: isHeader ? blue : rowIndex % 2 ? pale : 'FFFFFF' } });
      let left = x;
      values.forEach((value, i) => {
        slide.addText(String(value ?? ''), { x: left + 0.07, y: top + 0.04, w: widths[i] - 0.14, h: rowH - 0.08, fontFace: 'Aptos', fontSize: isHeader ? 11 : 10, bold: isHeader, color: isHeader ? 'FFFFFF' : ink, valign: 'mid', margin: 0, breakLine: false, fit: 'shrink' });
        left += widths[i];
      });
    };
    drawRow(headers, 0, true);
    rows.forEach((row, i) => drawRow(row, i + 1, false));
  };

  const cover = pptx.addSlide();
  cover.background = { color: '111827' };
  cover.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.22, h: SH, line: { color: blue }, fill: { color: blue } });
  cover.addText('AIPFA', { x: 0.85, y: 1.05, w: 3.5, h: 0.45, fontFace: 'Aptos Display', fontSize: 24, bold: true, color: '93B4FF', margin: 0 });
  cover.addText('Personal Finance\nReport', { x: 0.82, y: 2.0, w: 9.8, h: 1.7, fontFace: 'Aptos Display', fontSize: 38, bold: true, color: 'FFFFFF', breakLine: false, margin: 0 });
  cover.addText(P.range, { x: 0.86, y: 4.05, w: 9, h: 0.4, fontFace: 'Aptos', fontSize: 20, color: 'C8D5ED', margin: 0 });
  cover.addText(`Currency: ${P.code}${P.rateNote ? ` • ${P.rateNote}` : ''}\nGenerated: ${P.generated}`, { x: 0.86, y: 5.55, w: 10.8, h: 0.55, fontFace: 'Aptos', fontSize: 11, color: 'AAB6CA', breakLine: false, margin: 0 });

  const summarySlide = addContentSlide('Budget & cashflow summary');
  const summaryValues = new Map(P.summary);
  const cards = [
    ['Opening balance', summaryValues.get('Opening balance')], ['Income during range', summaryValues.get('Income during selected range')], ['Spending', summaryValues.get('Spending')],
    ['Savings set aside', summaryValues.get('Savings set aside')], ['Net', summaryValues.get('Net (income - spending - savings)')], ['Closing balance', summaryValues.get('Closing balance')],
  ];
  cards.forEach(([label, amount], i) => {
    const col = i % 3, row = Math.floor(i / 3), x = 0.75 + col * 4.05, y = 1.65 + row * 2.0;
    summarySlide.addShape(pptx.ShapeType.rect, { x, y, w: 3.75, h: 1.45, line: { color: line, width: 1 }, fill: { color: pale } });
    summarySlide.addText(label, { x: x + 0.2, y: y + 0.2, w: 3.3, h: 0.25, fontFace: 'Aptos', fontSize: 12, color: muted, margin: 0 });
    summarySlide.addText(money(amount), { x: x + 0.2, y: y + 0.63, w: 3.3, h: 0.45, fontFace: 'Aptos Display', fontSize: 21, bold: true, color: ink, margin: 0, fit: 'shrink' });
  });
  summarySlide.addText(`Savings rate: ${P.savingsRate}`, { x: 0.78, y: 6.05, w: 5, h: 0.3, fontFace: 'Aptos', fontSize: 13, bold: true, color: blue, margin: 0 });

  const budgetPages = Math.max(1, Math.ceil(P.periods.length / 12));
  for (let page = 0; page < budgetPages; page++) {
    const chunk = P.periods.slice(page * 12, (page + 1) * 12);
    const slide = addContentSlide('Budget by accounting period', budgetPages > 1 ? `${P.range} • Page ${page + 1} of ${budgetPages}` : P.range);
    if (!chunk.length) slide.addText('No budget periods were recorded in this date range.', { x: 0.75, y: 1.55, w: 10, h: 0.4, fontFace: 'Aptos', fontSize: 14, color: muted, margin: 0 });
    else drawTable(slide, ['Period', 'Start', 'End', `Budget (${P.code})`, `Spent (${P.code})`, `Remaining (${P.code})`], chunk.map((p) => [p.label, p.start, p.end, money(p.budget), money(p.spent), p.remaining === null ? 'Not set' : money(p.remaining)]), 1.55, [2.4, 1.55, 1.55, 2.1, 2.1, 2.3]);
  }

  const categorySlide = addContentSlide('Spending by category');
  if (!P.cats.length) categorySlide.addText('No spending in this date range.', { x: 0.75, y: 1.55, w: 10, h: 0.4, fontFace: 'Aptos', fontSize: 14, color: muted, margin: 0 });
  else {
    const max = Math.max(...P.cats.map((c) => c.amount), 1);
    P.cats.slice(0, 9).forEach((item, i) => {
      const y = 1.55 + i * 0.55, barMax = 7.0, barW = Math.max(0.08, barMax * item.amount / max);
      categorySlide.addText(item.category, { x: 0.75, y, w: 1.7, h: 0.25, fontFace: 'Aptos', fontSize: 11, color: ink, margin: 0 });
      categorySlide.addShape(pptx.ShapeType.rect, { x: 2.5, y: y + 0.02, w: barMax, h: 0.2, line: { color: pale }, fill: { color: pale } });
      categorySlide.addShape(pptx.ShapeType.rect, { x: 2.5, y: y + 0.02, w: barW, h: 0.2, line: { color: blue }, fill: { color: blue } });
      categorySlide.addText(`${money(item.amount)}  •  ${item.percent.toFixed(1)}%`, { x: 9.75, y, w: 2.7, h: 0.25, fontFace: 'Aptos', fontSize: 10, color: ink, align: 'right', margin: 0, fit: 'shrink' });
    });
  }

  const monthlyRows = P.months.map((row) => [row.month, money(row.income), money(row.spent), money(row.saved), money(row.net)]);
  const monthlyPages = Math.max(1, Math.ceil(monthlyRows.length / 12));
  for (let page = 0; page < monthlyPages; page++) {
    const slide = addContentSlide('Monthly cashflow', monthlyPages > 1 ? `${P.range} • Page ${page + 1} of ${monthlyPages}` : P.range);
    const rows = monthlyRows.slice(page * 12, (page + 1) * 12);
    if (!rows.length) slide.addText('No activity in this date range.', { x: 0.75, y: 1.55, w: 10, h: 0.4, fontFace: 'Aptos', fontSize: 14, color: muted, margin: 0 });
    else drawTable(slide, ['Month', `Income (${P.code})`, `Spending (${P.code})`, `Savings (${P.code})`, `Net (${P.code})`], rows, 1.55, [2.2, 2.45, 2.45, 2.3, 2.3]);
  }
  return pptx.write({ outputType: 'nodebuffer' });
}

// ---------------- PDF ----------------
function buildPdf(P) {
  const PDFDocument = require('pdfkit');
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: 'AIPFA Finance Report', Author: 'AIPFA' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject);
    const L = 40, W = doc.page.width - 80, rowH = 18, bottom = doc.page.height - 50;
    const clean = (s) => String(s == null ? '' : s).replace(/[–—−]/g, '-').replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?'); // built-in PDF fonts are Latin-only
    const MAX_ROWS = 1500;

    const table = (title, headers, rows, widths, rightCols = []) => {
      if (doc.y + rowH * 3 + 30 > bottom) doc.addPage();
      doc.moveDown(0.8);
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#1c2433').text(clean(title), L, doc.y);
      doc.moveDown(0.3);
      const drawRow = (cells, head, zebra) => {
        const y = doc.y;
        if (head) doc.rect(L, y, W, rowH).fill('#2563EB');
        else if (zebra) doc.rect(L, y, W, rowH).fill('#F5F7FB');
        let x = L;
        doc.font(head ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(head ? '#FFFFFF' : '#1c2433');
        cells.forEach((cellText, i) => {
          doc.text(clean(cellText), x + 4, y + 5, { width: widths[i] - 8, height: rowH - 6, ellipsis: true, lineBreak: false, align: rightCols.includes(i) ? 'right' : 'left' });
          x += widths[i];
        });
        doc.y = y + rowH; doc.x = L;
      };
      drawRow(headers, true, false);
      rows.slice(0, MAX_ROWS).forEach((r, idx) => {
        if (doc.y + rowH > bottom) { doc.addPage(); drawRow(headers, true, false); }
        drawRow(r, false, idx % 2 === 1);
      });
      if (rows.length > MAX_ROWS) {
        doc.font('Helvetica-Oblique').fontSize(9).fillColor('#6B7588').text(`... and ${rows.length - MAX_ROWS} more rows. Ask for the Excel version to get every row.`, L, doc.y + 4);
      }
      doc.y += 6; doc.x = L;
    };
    const none = (title, msg) => {
      if (doc.y + 60 > bottom) doc.addPage();
      doc.moveDown(0.8);
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#1c2433').text(clean(title), L, doc.y);
      doc.font('Helvetica-Oblique').fontSize(10).fillColor('#6B7588').text(msg, L, doc.y + 4);
    };

    doc.font('Helvetica-Bold').fontSize(22).fillColor('#2563EB').text('AIPFA Finance Report', L, 40);
    doc.font('Helvetica').fontSize(10).fillColor('#6B7588');
    doc.text(`Period: ${P.range}`, L, doc.y + 4);
    doc.text(`Currency: ${P.code}${P.rateNote ? ` (${clean(P.rateNote)})` : ''}`);
    doc.text(`Generated: ${P.generated}`);
    doc.y += 4;

    table('Summary', ['Item', `Amount (${P.code})`], [...P.summary.map(([l, v]) => [l, num(v)]), ['Savings rate (savings / income)', P.savingsRate]], [330, W - 330], [1]);
    if (P.cats.length) table('Spending by category', ['Category', `Amount (${P.code})`, '% of spending'], P.cats.map((x) => [x.category, num(x.amount), `${x.percent.toFixed(1)}%`]), [200, 160, W - 360], [1, 2]);
    else none('Spending by category', 'No spending in this period.');
    if (P.periods.length) table('Budgets', ['Accounting period', 'Budget', 'Spent', 'Remaining'], P.periods.map((x) => [String(x.label).replace(/[–—−?]/g, '-'), x.budget ? num(x.budget) : 'not set', num(x.spent), x.remaining === null ? '-' : num(x.remaining)]), [195, 110, 110, W - 415], [1, 2, 3]);
    if (P.months.length) table('Monthly cashflow', ['Calendar month', 'Income', 'Spending', 'Savings', 'Net'], P.months.map((x) => [x.month, num(x.income), num(x.spent), num(x.saved), num(x.net)]), [125, 100, 100, 100, W - 425], [1, 2, 3, 4]);
    if (P.days.length) table('Daily totals', ['Date', 'Income', 'Spending', 'Savings'], P.days.map((x) => [x.date, num(x.income), num(x.spent), num(x.saved)]), [120, 130, 130, W - 380], [1, 2, 3]);
    if (P.tx.length) table(P.transactionLabel, ['Date', 'Type', 'Category', 'Note', `Amount (${P.code})`], P.tx.map((x) => [x.date, x.type, x.category, x.note, num(x.amount)]), [70, 60, 85, W - 305, 90], [4]);
    else none(P.transactionLabel, 'No matching transactions in this period.');
    doc.end();
  });
}

const FORMATS = {
  xlsx: { build: buildXlsx, mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', label: 'Excel' },
  docx: { build: buildDocx, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Word' },
  pdf: { build: buildPdf, mime: 'application/pdf', label: 'PDF' },
  pptx: { build: buildPptx, mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'PowerPoint' },
};

async function build(format, rep, opts) {
  const f = FORMATS[format];
  if (!f) throw new Error('Unknown format');
  return { buffer: await f.build(prepare(rep, opts)), mime: f.mime };
}
function available(format) {
  const lib = { xlsx: 'exceljs', docx: 'docx', pdf: 'pdfkit', pptx: 'pptxgenjs' }[format];
  try { require.resolve(lib); return true; } catch { return false; }
}
module.exports = { build, available, FORMATS };
