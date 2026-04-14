
import { InvoiceCalcServiceInterface } from './invoice-calc-service.interface';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { BigNumber, BigNumberUtilities } from '../../../utilities/big-number.utilities';
import { InvoiceItem } from '../models/invoice-item.model';
import { Invoice as BaseInvoice, Invoice } from '../models/invoice.model';
import { Vat } from '../models/vat.model';

/**
 * Default implementation of the invoice calculation service.
 */
@Injectable({ register: 'onUse' })
export class InvoiceCalcService implements InvoiceCalcServiceInterface<Invoice> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    getItemTotalPriceBeforeTax(item: InvoiceItem): BigNumber {
        return BigNumberUtilities.multiply(item.amount, item.price);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getItemTotalPriceAfterTax(item: InvoiceItem): BigNumber {
        const itemTotalBeforeTax: BigNumber = this.getItemTotalPriceBeforeTax(item);
        const taxMultiplier: BigNumber = BigNumberUtilities.add(1, BigNumberUtilities.divide(item.vat.rate, 100));
        return BigNumberUtilities.multiply(itemTotalBeforeTax, taxMultiplier);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getItemTotalTax(item: InvoiceItem): BigNumber {
        const itemTotalBeforeTax: BigNumber = this.getItemTotalPriceBeforeTax(item);
        return BigNumberUtilities.multiply(itemTotalBeforeTax, BigNumberUtilities.divide(item.vat.rate, 100));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getTotalBeforeTax<Invoice extends BaseInvoice>(invoice: Invoice): BigNumber {
        let res: BigNumber = BigNumberUtilities.new(0);
        for (const item of invoice.items) {
            res = BigNumberUtilities.add(res, this.getItemTotalPriceBeforeTax(item));
        }
        return res.lt(0) ? BigNumberUtilities.new(0) : res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getTotalAfterTax<Invoice extends BaseInvoice>(invoice: Invoice): BigNumber {
        const totalBeforeTax: BigNumber = this.getTotalBeforeTax(invoice);
        const totalTax: BigNumber = this.getTotalTax(invoice);
        return BigNumberUtilities.add(totalBeforeTax, totalTax);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getTotalTax<Invoice extends BaseInvoice>(invoice: Invoice): BigNumber {
        let res: BigNumber = BigNumberUtilities.new(0);
        for (const item of invoice.items) {
            res = BigNumberUtilities.add(res, this.getItemTotalTax(item));
        }
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getTotalTaxForTaxGroup<Invoice extends BaseInvoice>(invoice: Invoice, group: Vat, groupOnlyByRate: boolean): BigNumber {
        const itemsInTaxGroup: InvoiceItem[] = this.getItemsForTaxGroup(invoice, group, groupOnlyByRate);
        let res: BigNumber = BigNumberUtilities.new(0);
        for (const item of itemsInTaxGroup) {
            res = BigNumberUtilities.add(res, this.getItemTotalTax(item));
        }
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    getTotalBeforeTaxForTaxGroup<Invoice extends BaseInvoice>(invoice: Invoice, group: Vat, groupOnlyByRate: boolean): BigNumber {
        const itemsInTaxGroup: InvoiceItem[] = this.getItemsForTaxGroup(invoice, group, groupOnlyByRate);
        let res: BigNumber = BigNumberUtilities.new(0);
        for (const item of itemsInTaxGroup) {
            res = BigNumberUtilities.add(res, this.getItemTotalPriceBeforeTax(item));
        }
        return res.lt(0) ? BigNumberUtilities.new(0) : res;
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