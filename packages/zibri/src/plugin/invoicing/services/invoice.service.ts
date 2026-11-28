import { type PaginationResult } from '../../../data-source/models/pagination-result.model';
import { type StringWhereFilter } from '../../../data-source/models/where/string-where-filter.model';
import { type Where, type WhereFilter } from '../../../data-source/models/where/where-filter.model';
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { inject } from '../../../di/inject.function';
import { type EntityOrder } from '../../../entity/models/entity-order.model';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error';
import { $ts } from '../../../localization/translate.function';
import { FilterUtilities } from '../../../routing/filter/filter.utilities';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../invoicing.tokens';
import { type InvoiceFilter } from '../models/invoice-filter.model';
import { type InvoicePaymentState } from '../models/invoice-payment-state.model';
import { InvoiceType } from '../models/invoice-type.enum';
import { Invoice } from '../models/invoice.model';
import { type InvoicePaymentServiceInterface } from './invoice-payment-service.interface';
import { type InvoiceServiceInterface } from './invoice-service.interface';

/**
 * The order the invoices are listed in: the latest day first, and by number among those of one day, which is unique
 * among the invoices of a tenant, so that the pages of a list neither repeat nor skip one.
 */
const INVOICE_ORDER: EntityOrder<Invoice> = { date: 'DESC', number: 'DESC' };

/**
 * How many invoices one read of their payment states holds, so that the states of many invoices are read in pages.
 */
const INVOICES_PER_READ: number = 500;

/**
 * Default implementation of the invoice service.
 */
@Injectable({ register: 'onUse' })
export class InvoiceService implements InvoiceServiceInterface {
    // read when used, like the repositories of the number service: ZibriInvoicingPlugin.validate names a missing
    // entity rather than a failed build of this
    private get invoiceRepository(): Repository<Invoice> {
        return inject(repositoryTokenFor(Invoice));
    }

    private get paymentService(): InvoicePaymentServiceInterface {
        return inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_PAYMENT_SERVICE);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findInvoices(page: number, limit: number, filter: InvoiceFilter): Promise<PaginationResult<Invoice>> {
        if (filter.open == undefined) {
            return await this.invoiceRepository.findAllPaginated(page, limit, { where: this.resolveWhere(filter), order: INVOICE_ORDER });
        }
        // asked of no invoice, which a source tracking payments answers with no state rather than none
        if (await this.paymentService.resolvePaymentStates([]) == undefined) {
            throw new BadRequestError(
                $ts`The filter open needs a payment source of the invoices, such as the bank plugin with matching, which this application does not have.`
            );
        }
        // open narrows to invoices, as a credit note pays nothing
        if (filter.type === InvoiceType.CREDIT_NOTE) {
            return { items: [], totalAmount: 0 };
        }
        return await this.findInvoicesOpen(page, limit, this.resolveWhere({ ...filter, type: InvoiceType.INVOICE }), filter.open);
    }

    /**
     * Resolves the filter of the invoices of a filter, without whether they are open.
     * @param filter - The filter.
     * @returns The where of the invoices: one per field a search looks in, each with the rest of the filter.
     */
    protected resolveWhere(filter: InvoiceFilter): Where<Invoice> {
        const where: WhereFilter<Invoice> = {
            ...filter.issued == undefined ? {} : { issuedAt: filter.issued ? { not: null } : null },
            ...filter.type == undefined ? {} : { type: filter.type }
        };
        const search: string | undefined = filter.search?.trim();
        if (search == undefined || search === '') {
            return where;
        }
        const like: StringWhereFilter = { iLike: `%${FilterUtilities.escapeLike(search)}%` };
        return [
            { ...where, number: like },
            { ...where, customerAddressData: { where: { companyName: like } } },
            { ...where, customerAddressData: { where: { firstName: like } } },
            { ...where, customerAddressData: { where: { lastName: like } } }
        ];
    }

    /**
     * Finds a page of the invoices of a filter that are open, or that are not.
     * @param page - The page, counting from 1.
     * @param limit - How many invoices a page holds.
     * @param where - The filter of the invoices.
     * @param open - Whether those with something left to pay, or those with nothing.
     * @returns The page, and how many there are.
     */
    protected async findInvoicesOpen(page: number, limit: number, where: Where<Invoice>, open: boolean): Promise<PaginationResult<Invoice>> {
        // what of an invoice is open follows from its items, its credit notes and the payment sources, which no filter of
        // the invoices reaches. So the ids of the invoices the filter matches are read in the order of the list, the
        // states of each page of them resolved, and the page taken from those left. What this reads grows with the
        // invoices of the filter, which issued narrows
        const ids: string[] = [];
        for await (const row of this.invoiceRepository.stream({ where, select: { id: true }, order: INVOICE_ORDER })) {
            ids.push(row.id);
        }
        const matching: string[] = [];
        // one page after the other, as each resolves the states of 500 invoices
        for (let start: number = 0; start < ids.length; start += INVOICES_PER_READ) {
            const invoices: Invoice[] = await this.invoiceRepository.findAll({
                where: { id: { oneOf: ids.slice(start, start + INVOICES_PER_READ) } },
                order: INVOICE_ORDER,
                limit: 'all'
            });
            const states: InvoicePaymentState[] = await this.paymentService.resolvePaymentStates(invoices) ?? [];
            matching.push(...invoices.filter((_, index) => (states[index]?.open.isGreaterThan(0) === true) === open).map(i => i.id));
        }
        const pageIds: string[] = matching.slice((page - 1) * limit, page * limit);
        return {
            totalAmount: matching.length,
            items: pageIds.length ? await this.invoiceRepository.findAll({ where: { id: { oneOf: pageIds } }, order: INVOICE_ORDER, limit: 'all' }) : []
        };
    }
}
