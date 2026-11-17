import PDFDocument from 'pdfkit';

const CURRENCY_SYMBOLS = { INR: 'Rs. ', USD: '$', EUR: 'EUR ', GBP: 'GBP ' };

const formatMoney = (value, currency = 'INR') => {
    const symbol = CURRENCY_SYMBOLS[currency] || `${currency} `;
    return `${symbol}${Number(value || 0).toFixed(2)}`;
};

const formatDate = (value) => {
    if (!value) return '-';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

/**
 * Renders a proposal or invoice as a PDF and pipes it directly to the
 * response. Shared layout — the only real difference between the two
 * document types is the title and which party/date labels are shown.
 */
export const streamBillingDocumentPdf = (res, { kind, doc, items, taxRateById, party }) => {
    const pdf = new PDFDocument({ size: 'A4', margin: 50 });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=${kind}-${doc.id}.pdf`);
    pdf.pipe(res);

    const title = kind === 'invoice' ? 'INVOICE' : kind === 'credit_note' ? 'CREDIT NOTE' : 'PROPOSAL';
    const number = kind === 'invoice' ? doc.invoice_number : kind === 'credit_note' ? doc.credit_note_number : `PROP-${String(doc.id).padStart(4, '0')}`;

    pdf.fontSize(20).font('Helvetica-Bold').fillColor('#0d7282').text('SkillsConnect', 50, 50);
    pdf.fontSize(22).font('Helvetica-Bold').fillColor('#1e293b').text(title, 0, 50, { align: 'right' });
    pdf.fontSize(10).font('Helvetica').fillColor('#64748b').text(`# ${number}`, { align: 'right' });

    pdf.moveDown(2);
    const infoTop = pdf.y;

    pdf.fontSize(9).fillColor('#64748b').text('BILLED TO', 50, infoTop);
    pdf.fontSize(11).fillColor('#1e293b').font('Helvetica-Bold').text(party.name || '-', 50, infoTop + 15);
    pdf.fontSize(9).font('Helvetica').fillColor('#475569');
    if (party.email) pdf.text(party.email, 50);
    if (party.phone) pdf.text(party.phone, 50);
    if (party.address) pdf.text(party.address, 50, pdf.y, { width: 250 });

    const rightColX = 350;
    const dateLabel = kind === 'invoice' ? 'INVOICE DATE' : kind === 'credit_note' ? 'CREDIT NOTE DATE' : 'PROPOSAL DATE';
    pdf.fontSize(9).fillColor('#64748b').text(dateLabel, rightColX, infoTop);
    pdf.fontSize(10).fillColor('#1e293b').text(formatDate(doc.date), rightColX, infoTop + 12);

    if (kind === 'invoice' && doc.due_date) {
        pdf.fontSize(9).fillColor('#64748b').text('DUE DATE', rightColX, infoTop + 32);
        pdf.fontSize(10).fillColor('#1e293b').text(formatDate(doc.due_date), rightColX, infoTop + 44);
    }
    if (kind === 'proposal' && doc.open_till) {
        pdf.fontSize(9).fillColor('#64748b').text('VALID UNTIL', rightColX, infoTop + 32);
        pdf.fontSize(10).fillColor('#1e293b').text(formatDate(doc.open_till), rightColX, infoTop + 44);
    }

    pdf.fontSize(9).fillColor('#64748b').text('STATUS', rightColX, infoTop + 64);
    pdf.fontSize(10).fillColor('#1e293b').text(doc.status || '-', rightColX, infoTop + 76);

    pdf.moveDown(4);

    // Items table
    const tableTop = pdf.y + 10;
    const colX = { desc: 50, qty: 300, rate: 360, tax: 430, amount: 490 };
    pdf.rect(50, tableTop, 495, 22).fill('#0d7282');
    pdf.fillColor('#ffffff').fontSize(9).font('Helvetica-Bold');
    pdf.text('DESCRIPTION', colX.desc + 5, tableTop + 7);
    pdf.text('QTY', colX.qty, tableTop + 7);
    pdf.text('RATE', colX.rate, tableTop + 7);
    pdf.text('TAX', colX.tax, tableTop + 7);
    pdf.text('AMOUNT', colX.amount, tableTop + 7);

    let rowY = tableTop + 22;
    pdf.font('Helvetica').fontSize(9).fillColor('#1e293b');
    items.forEach((item, idx) => {
        const qty = Number(item.qty) || 0;
        const rate = Number(item.rate) || 0;
        const amount = qty * rate;
        const taxRate = item.tax_rate_id ? taxRateById.get(Number(item.tax_rate_id)) : null;
        const rowHeight = 22;

        if (idx % 2 === 1) pdf.rect(50, rowY, 495, rowHeight).fill('#f8fafc').fillColor('#1e293b');

        pdf.fillColor('#1e293b').text(item.description || '-', colX.desc + 5, rowY + 6, { width: 240 });
        pdf.text(String(qty), colX.qty, rowY + 6);
        pdf.text(formatMoney(rate, doc.currency), colX.rate, rowY + 6);
        pdf.text(taxRate ? `${taxRate.name}` : '-', colX.tax, rowY + 6, { width: 55 });
        pdf.text(formatMoney(amount, doc.currency), colX.amount, rowY + 6);

        rowY += rowHeight;
    });

    pdf.moveTo(50, rowY).lineTo(545, rowY).strokeColor('#e2e8f0').stroke();
    rowY += 10;

    const totalsX = 380;
    const addTotalRow = (label, value, bold = false) => {
        pdf.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor(bold ? '#0d7282' : '#475569');
        pdf.text(label, totalsX, rowY, { width: 100 });
        pdf.text(formatMoney(value, doc.currency), totalsX + 100, rowY, { width: 65, align: 'right' });
        rowY += bold ? 18 : 15;
    };

    addTotalRow('Subtotal', doc.subtotal);
    if (Number(doc.discount_total) > 0) addTotalRow('Discount', -doc.discount_total);
    if (Number(doc.total_tax) > 0) addTotalRow('Tax', doc.total_tax);
    if (Number(doc.adjustment) !== 0) addTotalRow('Adjustment', doc.adjustment);
    rowY += 3;
    pdf.moveTo(totalsX, rowY).lineTo(545, rowY).strokeColor('#0d7282').stroke();
    rowY += 8;
    addTotalRow('Total', doc.total, true);

    if (kind === 'invoice' && Number(doc.amount_paid) > 0) {
        addTotalRow('Paid', doc.amount_paid);
        addTotalRow('Balance Due', Math.max(0, Number(doc.total) - Number(doc.amount_paid)), true);
    }
    if (kind === 'credit_note' && Number(doc.amount_used) > 0) {
        addTotalRow('Applied', doc.amount_used);
        addTotalRow('Remaining Credit', Math.max(0, Number(doc.total) - Number(doc.amount_used)), true);
    }

    if (doc.terms || doc.client_note) {
        pdf.moveDown(3);
        pdf.font('Helvetica-Bold').fontSize(9).fillColor('#64748b').text('NOTES', 50, pdf.y + 20);
        pdf.font('Helvetica').fontSize(9).fillColor('#475569').text(doc.terms || doc.client_note || '', 50, pdf.y + 5, { width: 495 });
    }

    pdf.end();
};
