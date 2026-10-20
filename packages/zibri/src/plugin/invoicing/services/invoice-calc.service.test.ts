import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { InvoiceCalcService } from './invoice-calc.service.ts';
import { defaultTestServerEntities } from '../../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../../__testing__/test-server/start-test-server.function.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../di/inject.function.ts';
import { type CurrencyCode } from '../../../localization/models/currency-code.model.ts';
import { UUIDUtilities } from '../../../utilities/uuid.utilities.ts';
import { InvoiceItem } from '../models/invoice-item.model.ts';
import { Invoice } from '../models/invoice.model.ts';

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
    ],
    currency: 'EUR'
} as Invoice;

let server: StartedTestServer | undefined;
let invoiceCalcService: InvoiceCalcService;

// an application for its localize service, which says how many decimals an amount has
beforeAll(async () => {
    server = await startTestServer({ dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities })] });
    invoiceCalcService = new InvoiceCalcService(inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE));
}, 30000);

afterAll(async () => {
    await server?.shutdown();
}, 15000);

/**
 * An invoice of the given items, with nothing else of it mattering to a calculation.
 * @param items - Its items.
 * @param currency - Its currency.
 * @returns The invoice.
 */
function invoiceOf(items: InvoiceItem[], currency: CurrencyCode = 'EUR'): Invoice {
    return {
        id: UUIDUtilities.generate(),
        tenantId: UUIDUtilities.generate(),
        number: '1',
        items,
        date: new Date(),
        performanceDate: new Date(),
        dueDate: new Date(),
        customerAddressData: {
            formOfAddress: '',
            firstName: '',
            lastName: '',
            street: '',
            number: '',
            postcode: '',
            city: '',
            company: true,
            companyName: 'Great Company LLC',
            countryId: 'DE'
        },
        textBeforeItems: [],
        textAfterItems: [],
        currency
    };
}

/**
 * An item, a new object for its VAT each time, as items read from a data source are.
 * @param price - Its price.
 * @param rate - Its VAT rate.
 * @param amount - How many of it.
 * @returns The item.
 */
function itemOf(price: number, rate: number, amount: number = 1): InvoiceItem {
    return { name: '', amount, amountUnit: { code: 'H87', displayName: 'Pieces' }, vat: { categoryCode: 'S', rate }, price };
}

describe('getItemTotalPriceBeforeTax', () => {
    it('should calculate the expected result', () => {
        expect(invoiceCalcService.getItemTotalPriceBeforeTax(invoiceItem, 'EUR').toNumber()).toEqual(237.61);
    });

    it('rounds to the minor units of the currency, half away from zero', () => {
        expect(invoiceCalcService.getItemTotalPriceBeforeTax(itemOf(33.335, 0, 3), 'JPY').toString()).toBe('100');
        expect(invoiceCalcService.getItemTotalPriceBeforeTax(itemOf(0.125, 0), 'EUR').toString()).toBe('0.13');
        expect(invoiceCalcService.getItemTotalPriceBeforeTax(itemOf(-0.125, 0), 'EUR').toString()).toBe('-0.13');
        expect(invoiceCalcService.getItemTotalPriceBeforeTax(itemOf(1.0005, 0), 'KWD').toString()).toBe('1.001');
    });
});

describe('getItemTotalPriceAfterTax', () => {
    it('should calculate the expected result', () => {
        expect(invoiceCalcService.getItemTotalPriceAfterTax(invoiceItem, 'EUR').toNumber()).toEqual(282.76);
    });
});

describe('getItemTotalTax', () => {
    it('should calculate the expected result', () => {
        expect(invoiceCalcService.getItemTotalTax(invoiceItem, 'EUR').toNumber()).toEqual(45.15);
    });
});

describe('getTotalBeforeTax', () => {
    it('should calculate the expected result', () => {
        expect(invoiceCalcService.getTotalBeforeTax(invoice).toNumber()).toEqual(747.61);
    });

    it('adds up a credit line larger than the rest as it is', () => {
        expect(invoiceCalcService.getTotalBeforeTax(invoiceOf([itemOf(100, 19), itemOf(-150, 19)])).toString()).toBe('-50');
    });
});

describe('getTotalAfterTax', () => {
    it('should calculate the expected result', () => {
        expect(invoiceCalcService.getTotalAfterTax(invoice).toNumber()).toEqual(861.16);
    });

    it('is the total before tax plus the VAT of the groups, however the lines would round', () => {
        const items: InvoiceItem[] = [itemOf(9.99, 19), itemOf(9.99, 19), itemOf(9.99, 19)];
        expect(invoiceCalcService.getTotalAfterTax(invoiceOf(items)).toString()).toBe('35.66');
        expect(invoiceCalcService.getTotalAfterTax(invoiceOf([itemOf(100, 19), itemOf(-150, 19)])).toString()).toBe('-59.5');
    });
});

describe('getTotalTax', () => {
    it('should calculate the expected result', () => {
        expect(invoiceCalcService.getTotalTax(invoice).toNumber()).toEqual(113.55);
    });

    it('is the sum of the VAT of each group, each rounded once', () => {
        // the VAT of each line would be 1.8981, rounded 1.90, and 5.70 all told
        const items: InvoiceItem[] = [itemOf(9.99, 19), itemOf(9.99, 19), itemOf(9.99, 19), itemOf(10.05, 7)];
        // 29.97 * 19 % = 5.6943, and 10.05 * 7 % = 0.7035
        expect(invoiceCalcService.getTotalTax(invoiceOf(items)).toString()).toBe('6.39');
    });
});

describe('getTaxGroups', () => {
    it('groups the items by what their VAT is, not by which object holds it', () => {
        const items: InvoiceItem[] = [itemOf(1, 19), itemOf(2, 19), itemOf(3, 7), { ...itemOf(4, 7), vat: { categoryCode: 'AE', rate: 7 } }];

        expect(invoiceCalcService.getTaxGroups(invoiceOf(items), false).map(g => `${g.categoryCode} ${g.rate}`)).toEqual(['S 19', 'S 7', 'AE 7']);
        expect(invoiceCalcService.getTaxGroups(invoiceOf(items), true).map(g => g.rate)).toEqual([19, 7]);
    });
});

describe('getTotalTaxForTaxGroup', () => {
    it('should calculate the expected result', () => {
        expect(invoiceCalcService.getTotalTaxForTaxGroup(invoice, {
            categoryCode: 'S',
            rate: 19
        }, false).toNumber()).toEqual(113.55);
        expect(invoiceCalcService.getTotalTaxForTaxGroup(invoice, {
            categoryCode: 'X',
            rate: 19
        }, false).toNumber()).toEqual(0);
        expect(invoiceCalcService.getTotalTaxForTaxGroup(invoice, {
            categoryCode: 'X',
            rate: 19
        }, true).toNumber()).toEqual(113.55);

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