import { FrameworkColumnUtilities } from '../../../data-source/migration/framework-column.utilities';
import { Repository } from '../../../data-source/repository/repository';
import { type RepositoryTransaction } from '../../../data-source/transaction/repository-transaction.type';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { ConflictError } from '../../../error-handling/errors/conflict.error';
import { InternalError } from '../../../error-handling/internal-error.model';
import { type LocalizeServiceInterface } from '../../../localization/localize-service.interface';
import { type CurrencyCode } from '../../../localization/models/currency-code.model';
import { $ts } from '../../../localization/translate.function';
import { OmitStrict } from '../../../types/omit-strict.type';
import { BigNumber, NumberUtilities } from '../../../utilities/number.utilities';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../invoicing.tokens';
import { CreditNoteData } from '../models/credit-note-data.model';
import { InvoiceAddress } from '../models/invoice-address.model';
import { InvoiceItem } from '../models/invoice-item.model';
import { InvoiceType } from '../models/invoice-type.enum';
import { Invoice } from '../models/invoice.model';
import { type InvoicingOptions } from '../models/invoicing-options.model';
import { Vat } from '../models/vat.model';
import { type InvoiceCalcServiceInterface } from './invoice-calc-service.interface';
import { InvoiceCancellationServiceInterface } from './invoice-cancellation-service.interface';
import { type InvoiceNumberServiceInterface } from './invoice-number-service.interface';

/**
 * The amount before tax of the items of one VAT category and rate.
 */
type TaxGroupTotal = {
    /**
     * The VAT of the group.
     */
    vat: Vat,
    /**
     * The amount before tax.
     */
    total: BigNumber
};

/**
 * Default implementation of the invoice cancellation service.
 */
@Injectable({ register: 'onUse' })
export class InvoiceCancellationService implements InvoiceCancellationServiceInterface<Invoice> {
    // read when used, like the repositories of the number service: ZibriInvoicingPlugin.validate names a
    // missing entity rather than a failed build of this
    private get invoiceRepository(): Repository<Invoice, OmitStrict<Invoice, 'id' | 'tenantId'>> {
        return inject(repositoryTokenFor(Invoice));
    }

    constructor(
        @Inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS)
        protected readonly options: InvoicingOptions,
        @Inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_NUMBER_SERVICE)
        private readonly invoiceNumberService: InvoiceNumberServiceInterface<InvoiceAddress>,
        @Inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CALC_SERVICE)
        private readonly invoiceCalcService: InvoiceCalcServiceInterface<Invoice>,
        @Inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE)
        private readonly localizeService: LocalizeServiceInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async cancelInvoice(invoiceId: string, data: CreditNoteData = {}, transaction?: RepositoryTransaction): Promise<Invoice> {
        const invoice: Invoice = await this.invoiceRepository.findById(invoiceId, { transaction });
        return await this.createCreditNoteOf(invoice, invoice.items, data, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createCreditNote(
        invoiceId: string,
        items: InvoiceItem[],
        data: CreditNoteData = {},
        transaction?: RepositoryTransaction
    ): Promise<Invoice> {
        const invoice: Invoice = await this.invoiceRepository.findById(invoiceId, { transaction });
        return await this.createCreditNoteOf(invoice, items, data, transaction);
    }

    /**
     * Creates a credit note of the given items of an invoice, numbered and issued.
     * @param invoice - The invoice.
     * @param items - What is credited.
     * @param data - What the credit note states besides its items.
     * @param transaction - The transaction the number is drawn in.
     * @returns The credit note.
     * @throws A ConflictError when it credits more than the invoice has not yet credited, or the invoice is a
     * credit note or a draft.
     */
    protected async createCreditNoteOf(
        invoice: Invoice,
        items: InvoiceItem[],
        data: CreditNoteData,
        transaction: RepositoryTransaction | undefined
    ): Promise<Invoice> {
        // before anything is drawn or read of the invoices credited, which a table of a schema the data source does not
        // manage may hold no column for
        FrameworkColumnUtilities.validatePresent('Creating a credit note', Invoice, 'type', 'precedingInvoices', 'issuedAt');
        if (invoice.type === InvoiceType.CREDIT_NOTE) {
            throw new ConflictError($ts`The invoice ${invoice.number} is a credit note, and a credit note cannot be credited.`);
        }
        // a draft by its issuedAt, whatever its number, as everywhere else
        if (invoice.issuedAt == undefined) {
            throw new ConflictError($ts`The invoice ${invoice.number} is not issued, and a draft is deleted rather than credited.`);
        }
        if (this.invoiceNumberService.generateCreditNoteNumber == undefined) {
            throw new InternalError([
                'A credit note is numbered by the invoice number service.',
                'The service of ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_NUMBER_SERVICE needs to implement'
                + ' generateCreditNoteNumber for that.'
            ]);
        }
        // checked before the number is drawn, so that a refused credit note draws none without a transaction,
        // where a drawn number would stay drawn
        await this.validateNotYetCredited(invoice, items, transaction);
        const number: string = await this.invoiceNumberService.generateCreditNoteNumber(invoice.number, transaction);
        // and again once it is: two credit notes of an invoice draw their numbers from the counter of the
        // invoice one after the other inside transactions, and the second reads the first here once it is
        // committed. Without a transaction, two at the same moment can still both pass
        await this.validateNotYetCredited(invoice, items, transaction);
        const date: Date = data.date ?? new Date();
        return await this.invoiceRepository.create(
            {
                number,
                type: InvoiceType.CREDIT_NOTE,
                precedingInvoices: [{ number: invoice.number, date: invoice.date }],
                items,
                date,
                performanceDate: data.performanceDate ?? invoice.performanceDate,
                dueDate: data.dueDate ?? date,
                customerAddressData: invoice.customerAddressData,
                textBeforeItems: data.textBeforeItems ?? [],
                textAfterItems: data.textAfterItems ?? [],
                currency: invoice.currency,
                issuedAt: new Date()
            },
            { transaction }
        );
    }

    /**
     * Validates that the given items credit no more of each VAT category and rate of an invoice than its credit
     * notes have not credited yet, before tax.
     * @param invoice - The invoice.
     * @param items - What is credited.
     * @param transaction - The transaction the credit note is created in.
     * @throws A ConflictError naming the first VAT category and rate credited beyond what is left.
     */
    protected async validateNotYetCredited(
        invoice: Invoice,
        items: InvoiceItem[],
        transaction: RepositoryTransaction | undefined
    ): Promise<void> {
        const creditNotes: Invoice[] = await this.invoiceRepository.findAll({
            where: { type: InvoiceType.CREDIT_NOTE, precedingInvoices: { where: { number: invoice.number } } },
            transaction
        });
        // per VAT category and rate, since a credit note corrects the tax of each: crediting an item at 19 %
        // against one invoiced at 7 % would refund tax that was never charged
        const left: Map<string, TaxGroupTotal> = await this.resolveTotalsByTaxGroup(invoice.items, invoice.currency);
        for (const creditNote of creditNotes) {
            for (const [key, credited] of await this.resolveTotalsByTaxGroup(creditNote.items, invoice.currency)) {
                const group: TaxGroupTotal | undefined = left.get(key);
                if (group != undefined) {
                    group.total = NumberUtilities.subtract(group.total, credited.total);
                }
            }
        }
        const minorUnits: number = this.localizeService.getCurrencyMinorUnits(invoice.currency);
        for (const [key, crediting] of await this.resolveTotalsByTaxGroup(items, invoice.currency)) {
            const remaining: BigNumber = left.get(key)?.total ?? NumberUtilities.new(0);
            if (crediting.total.isGreaterThan(remaining)) {
                const amount: string = remaining.toFixed(minorUnits);
                const vat: string = `${crediting.vat.categoryCode} ${crediting.vat.rate}`;
                // eslint-disable-next-line stylistic/max-len
                throw new ConflictError($ts`A credit note of the invoice ${invoice.number} needs to credit at most ${amount} ${invoice.currency} before tax at the VAT ${vat} %, the part not yet credited.`);
            }
        }
    }

    private async resolveTotalsByTaxGroup(items: InvoiceItem[], currency: CurrencyCode): Promise<Map<string, TaxGroupTotal>> {
        const res: Map<string, TaxGroupTotal> = new Map();
        for (const item of items) {
            const key: string = `${item.vat.categoryCode} ${item.vat.rate}`;
            const total: BigNumber = await this.invoiceCalcService.getItemTotalPriceBeforeTax(item, currency);
            const group: TaxGroupTotal | undefined = res.get(key);
            if (group == undefined) {
                res.set(key, { vat: item.vat, total });
            }
            else {
                group.total = NumberUtilities.add(group.total, total);
            }
        }
        return res;
    }
}