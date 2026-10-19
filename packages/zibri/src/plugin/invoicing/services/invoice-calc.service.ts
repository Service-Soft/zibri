
import { InvoiceCalcServiceInterface } from './invoice-calc-service.interface';
import { Inject } from '../../../di/decorators/inject.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { type LocalizeServiceInterface } from '../../../localization/localize-service.interface';
import { type CurrencyCode } from '../../../localization/models/currency-code.model';
import { BigNumber, NumberUtilities } from '../../../utilities/number.utilities';
import { InvoiceItem } from '../models/invoice-item.model';
import { Invoice as BaseInvoice, Invoice } from '../models/invoice.model';
import { Vat } from '../models/vat.model';

/**
 * Default implementation of the invoice calculation service.
 */
@Injectable({ register: 'onUse' })
export class InvoiceCalcService implements InvoiceCalcServiceInterface<Invoice> {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE)
        private readonly localizeService: LocalizeServiceInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    getItemTotalPriceBeforeTax(item: InvoiceItem, currency: CurrencyCode): BigNumber {
        // rounded per line, which EN 16931 states every line's net amount as (BR-DEC-23), and every
        // total adds up from (BR-CO-10, BR-S-08)
        return this.round(NumberUtilities.multiply(item.amount, item.price), currency);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getItemTotalPriceAfterTax(item: InvoiceItem, currency: CurrencyCode): BigNumber {
        return NumberUtilities.add(this.getItemTotalPriceBeforeTax(item, currency), this.getItemTotalTax(item, currency));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getItemTotalTax(item: InvoiceItem, currency: CurrencyCode): BigNumber {
        return this.getTaxOf(this.getItemTotalPriceBeforeTax(item, currency), item.vat, currency);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getTotalBeforeTax<Invoice extends BaseInvoice>(invoice: Invoice): BigNumber {
        let res: BigNumber = NumberUtilities.new(0);
        for (const item of invoice.items) {
            res = NumberUtilities.add(res, this.getItemTotalPriceBeforeTax(item, invoice.currency));
        }
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getTotalAfterTax<Invoice extends BaseInvoice>(invoice: Invoice): BigNumber {
        return NumberUtilities.add(this.getTotalBeforeTax(invoice), this.getTotalTax(invoice));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getTotalTax<Invoice extends BaseInvoice>(invoice: Invoice): BigNumber {
        // the sum of the groups rather than of the items, each group taxed once (BR-CO-14)
        let res: BigNumber = NumberUtilities.new(0);
        for (const group of this.getTaxGroups(invoice, false)) {
            res = NumberUtilities.add(res, this.getTotalTaxForTaxGroup(invoice, group, false));
        }
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getTaxGroups<Invoice extends BaseInvoice>(invoice: Invoice, groupOnlyByRate: boolean): Vat[] {
        // by what the VAT is: items read from a data source each hold an object of their own
        const res: Map<string, Vat> = new Map();
        for (const item of invoice.items) {
            const key: string = groupOnlyByRate ? String(item.vat.rate) : `${item.vat.categoryCode} ${item.vat.rate}`;
            if (!res.has(key)) {
                res.set(key, item.vat);
            }
        }
        return [...res.values()];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getTotalTaxForTaxGroup<Invoice extends BaseInvoice>(invoice: Invoice, group: Vat, groupOnlyByRate: boolean): BigNumber {
        // the group's taxable amount times its rate, rounded once (BR-S-09 and its siblings), rather
        // than the sum of each item's rounded tax, which can be a cent apart
        return this.getTaxOf(this.getTotalBeforeTaxForTaxGroup(invoice, group, groupOnlyByRate), group, invoice.currency);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getTotalBeforeTaxForTaxGroup<Invoice extends BaseInvoice>(invoice: Invoice, group: Vat, groupOnlyByRate: boolean): BigNumber {
        const itemsInTaxGroup: InvoiceItem[] = this.getItemsForTaxGroup(invoice, group, groupOnlyByRate);
        let res: BigNumber = NumberUtilities.new(0);
        for (const item of itemsInTaxGroup) {
            res = NumberUtilities.add(res, this.getItemTotalPriceBeforeTax(item, invoice.currency));
        }
        return res;
    }

    private getTaxOf(amount: BigNumber, vat: Vat, currency: CurrencyCode): BigNumber {
        return this.round(NumberUtilities.multiply(amount, NumberUtilities.divide(vat.rate, 100)), currency);
    }

    private round(amount: BigNumber, currency: CurrencyCode): BigNumber {
        return NumberUtilities.round(amount, this.localizeService.getCurrencyMinorUnits(currency));
    }

    private getItemsForTaxGroup<Invoice extends BaseInvoice>(invoice: Invoice, group: Vat, groupOnlyByRate: boolean): InvoiceItem[] {
        const itemsInTaxGroup: InvoiceItem[] = invoice.items.filter(item => {
            if (groupOnlyByRate) {
                return item.vat.rate === group.rate;
            }
            return item.vat.categoryCode === group.categoryCode && item.vat.rate === group.rate;
        });
        return itemsInTaxGroup;
    }
}