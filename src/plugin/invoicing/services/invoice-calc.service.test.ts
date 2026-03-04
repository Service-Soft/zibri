import { describe, expect, it } from '@jest/globals';

import { InvoiceCalcService } from './invoice-calc.service';
import { InvoiceItem } from '../models/invoice-item.model';
import { Invoice } from '../models/invoice.model';

const invoiceItem: InvoiceItem = {
    name: '',
    amount: 4.752136,
    amountUnit: {
        code: '',
        displayName: ''
    },
    vat: {
        categoryCode: 'S',
        rate: 19
    },
    price: 50
};

const invoiceItemWithoutTax: InvoiceItem = {
    name: '',
    amount: 3,
    amountUnit: {
        code: '',
        displayName: ''
    },
    vat: {
        categoryCode: 'E',
        rate: 0,
        exemptionReason: 'Reason'
    },
    price: 50
};

const invoice: Invoice = {
    items: [
        invoiceItem,
        invoiceItemWithoutTax,
        {
            name: 'Testing',
            amount: 4,
            amountUnit: {
                code: 'HUR',
                displayName: 'Hours'
            },
            vat: {
                categoryCode: 'S',
                rate: 19
            },
            price: 90
        }
    ]
} as Invoice;

const invoiceCalcService: InvoiceCalcService = new InvoiceCalcService();

describe('getItemTotalPriceBeforeTax', () => {
    it('should calculate the expected result', () => {
        expect(invoiceCalcService.getItemTotalPriceBeforeTax(invoiceItem).toNumber()).toEqual(237.6068);
    });
});

describe('getItemTotalPriceAfterTax', () => {
    it('should calculate the expected result', () => {
        expect(invoiceCalcService.getItemTotalPriceAfterTax(invoiceItem).toNumber()).toEqual(282.752092);
    });
});

describe('getItemTotalTax', () => {
    it('should calculate the expected result', () => {
        expect(invoiceCalcService.getItemTotalTax(invoiceItem).toNumber()).toEqual(45.145292);
    });
});

describe('getTotalBeforeTax', () => {
    it('should calculate the expected result', () => {
        expect(invoiceCalcService.getTotalBeforeTax(invoice).toNumber()).toEqual(747.6068);
    });
});

describe('getTotalAfterTax', () => {
    it('should calculate the expected result', () => {
        expect(invoiceCalcService.getTotalAfterTax(invoice).toNumber()).toEqual(861.152092);
    });
});

describe('getTotalTax', () => {
    it('should calculate the expected result', () => {
        expect(invoiceCalcService.getTotalTax(invoice).toNumber()).toEqual(113.545292);
    });
});

describe('getTotalTaxForTaxGroup', () => {
    it('should calculate the expected result', () => {
        expect(invoiceCalcService.getTotalTaxForTaxGroup(invoice, {
            categoryCode: 'S',
            rate: 19
        }, false).toNumber()).toEqual(113.545292);
        expect(invoiceCalcService.getTotalTaxForTaxGroup(invoice, {
            categoryCode: 'X',
            rate: 19
        }, false).toNumber()).toEqual(0);
        expect(invoiceCalcService.getTotalTaxForTaxGroup(invoice, {
            categoryCode: 'X',
            rate: 19
        }, true).toNumber()).toEqual(113.545292);

        expect(invoiceCalcService.getTotalTaxForTaxGroup(invoice, {
            categoryCode: 'E',
            rate: 0
        }, false).toNumber()).toEqual(0);
        expect(invoiceCalcService.getTotalTaxForTaxGroup(invoice, {
            categoryCode: 'X',
            rate: 0
        }, false).toNumber()).toEqual(0);
        expect(invoiceCalcService.getTotalTaxForTaxGroup(invoice, {
            categoryCode: 'X',
            rate: 0
        }, true).toNumber()).toEqual(0);
    });
});