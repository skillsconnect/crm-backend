// Shared subtotal/discount/tax/total math for proposals and invoices — both
// document types have identical line-item + discount + per-item-tax shape,
// so the calculation only needs to live once.

export const calculateItemAmount = (item) => {
    const qty = Number(item.qty) || 0;
    const rate = Number(item.rate) || 0;
    return qty * rate;
};

export const calculateTotals = (items, { discount_type, discount_percent, adjustment } = {}, taxRateById) => {
    const subtotal = items.reduce((sum, item) => sum + calculateItemAmount(item), 0);

    let discountTotal = 0;
    if (discount_type === 'percent') {
        discountTotal = subtotal * (Number(discount_percent) || 0) / 100;
    } else if (discount_type === 'fixed') {
        discountTotal = Number(discount_percent) || 0;
    }

    const taxableBase = subtotal - discountTotal;
    let totalTax = 0;
    if (taxRateById && taxableBase > 0 && subtotal > 0) {
        for (const item of items) {
            if (!item.tax_rate_id) continue;
            const rate = Number(taxRateById.get(Number(item.tax_rate_id))?.rate) || 0;
            if (!rate) continue;
            const itemAmount = calculateItemAmount(item);
            // Apply the overall discount proportionally to each item before taxing it.
            const itemShareOfDiscount = subtotal > 0 ? (itemAmount / subtotal) * discountTotal : 0;
            const itemTaxableAmount = itemAmount - itemShareOfDiscount;
            totalTax += itemTaxableAmount * (rate / 100);
        }
    }

    const adjustmentValue = Number(adjustment) || 0;
    const total = taxableBase + totalTax + adjustmentValue;

    return {
        subtotal: round2(subtotal),
        discount_total: round2(discountTotal),
        total_tax: round2(totalTax),
        total: round2(total),
    };
};

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;
