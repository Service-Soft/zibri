import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { getDiTokenName } from '../../../di/get-di-token-name.function';
import { getRegisteredProvidersOfVariant } from '../../../di/get-registered-providers-of-variant.function';
import { inject } from '../../../di/inject.function';
import { InternalError } from '../../../error-handling/internal-error.model';
import { BigNumber, NumberUtilities } from '../../../utilities/number.utilities';
import { INVOICE_PAYMENT_SOURCE_DI_VARIANT, ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../invoicing.tokens';
import { type InvoicePaymentState } from '../models/invoice-payment-state.model';
import { InvoicePaymentStatus } from '../models/invoice-payment-status.enum';
import { InvoiceType } from '../models/invoice-type.enum';
import { Invoice } from '../models/invoice.model';
import { type InvoiceCalcServiceInterface } from './invoice-calc-service.interface';
import { type InvoicePaymentServiceInterface } from './invoice-payment-service.interface';
import { type InvoicePaymentSourceInterface } from './invoice-payment-source.interface';

/**
 * How many invoice numbers one read of credit notes looks for, so that the states of many invoices are read in pages.
 */
const NUMBERS_PER_READ: number = 500;

/**
 * Default implementation of the invoice payment service.
 */
@Injectable({ register: 'onUse' })
export class InvoicePaymentService implements InvoicePaymentServiceInterface {
    // read when used, like the repositories of the number service: ZibriInvoicingPlugin.validate names a
    // missing entity rather than a failed build of this
    private get invoiceRepository(): Repository<Invoice> {
        return inject(repositoryTokenFor(Invoice));
    }

    constructor(
        @Inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CALC_SERVICE)
        private readonly invoiceCalcService: InvoiceCalcServiceInterface<Invoice>
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolvePaymentState(invoice: Invoice): Promise<InvoicePaymentState | undefined> {
        const states: InvoicePaymentState[] | undefined = await this.resolvePaymentStates([invoice]);
        return states?.[0];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolvePaymentStates(invoices: Invoice[]): Promise<InvoicePaymentState[] | undefined> {
        const answers: (Map<string, BigNumber> | undefined)[] = await Promise.all(
            this.resolvePaymentSources().map(async source => await source.resolvePaidAmounts(invoices))
        );
        const known: Map<string, BigNumber>[] = answers.filter(answer => answer != undefined);
        // without a source nothing is known of payments, and an invoice paid some other way would read as open
        if (!known.length) {
            return undefined;
        }
        const credited: Map<string, BigNumber> = await this.resolveCreditedAmounts(invoices);
        return await Promise.all(invoices.map(async invoice => {
            const paid: BigNumber = known.reduce(
                (sum, amounts) => NumberUtilities.add(sum, amounts.get(invoice.id) ?? 0),
                NumberUtilities.new(0)
            );
            return await this.resolveState(invoice, credited.get(invoice.number) ?? NumberUtilities.new(0), paid);
        }));
    }

    /**
     * Resolves the state of an invoice from what is credited and paid of it.
     * @param invoice - The invoice.
     * @param credited - What its credit notes credit, after tax.
     * @param paid - What the sources know as paid.
     * @returns The state.
     */
    protected async resolveState(invoice: Invoice, credited: BigNumber, paid: BigNumber): Promise<InvoicePaymentState> {
        const total: BigNumber = await this.invoiceCalcService.getTotalAfterTax(invoice);
        const open: BigNumber = NumberUtilities.subtract(NumberUtilities.subtract(total, credited), paid);
        return { total, credited, paid, open, status: this.resolveStatus(credited, paid, open) };
    }

    /**
     * How far an invoice is paid.
     * @param credited - What its credit notes credit.
     * @param paid - What is paid of it.
     * @param open - What is left to pay.
     * @returns The status.
     */
    protected resolveStatus(credited: BigNumber, paid: BigNumber, open: BigNumber): InvoicePaymentStatus {
        const anythingPaid: boolean = paid.isGreaterThan(0);
        if (open.isGreaterThan(0)) {
            return anythingPaid ? InvoicePaymentStatus.PARTLY_PAID : InvoicePaymentStatus.OPEN;
        }
        return !anythingPaid && credited.isGreaterThan(0) ? InvoicePaymentStatus.CREDITED : InvoicePaymentStatus.PAID;
    }

    /**
     * Resolves what the credit notes of the active tenant credit of the given invoices, after tax.
     * @param invoices - The invoices.
     * @returns What is credited, by the number of the invoice, with no entry for an invoice no credit note references.
     */
    protected async resolveCreditedAmounts(invoices: Invoice[]): Promise<Map<string, BigNumber>> {
        const numbers: string[] = [...new Set(invoices.filter(i => i.type !== InvoiceType.CREDIT_NOTE).map(i => i.number))];
        const res: Map<string, BigNumber> = new Map();
        for (let start: number = 0; start < numbers.length; start += NUMBERS_PER_READ) {
            const page: string[] = numbers.slice(start, start + NUMBERS_PER_READ);
            const creditNotes: Invoice[] = await this.invoiceRepository.findAll({
                where: { type: InvoiceType.CREDIT_NOTE, precedingInvoices: { where: { number: { oneOf: page } } } },
                limit: 'all'
            });
            for (const creditNote of creditNotes) {
                const total: BigNumber = await this.invoiceCalcService.getTotalAfterTax(creditNote);
                // a credit note references the one invoice it corrects
                for (const reference of creditNote.precedingInvoices ?? []) {
                    res.set(reference.number, NumberUtilities.add(res.get(reference.number) ?? 0, total));
                }
            }
        }
        return res;
    }

    /**
     * Resolves the payment sources registered with `INVOICE_PAYMENT_SOURCE_DI_VARIANT`.
     * @returns The sources.
     * @throws When a provider of the variant holds no payment source.
     */
    protected resolvePaymentSources(): InvoicePaymentSourceInterface[] {
        return getRegisteredProvidersOfVariant(INVOICE_PAYMENT_SOURCE_DI_VARIANT).map(provider => {
            const source: unknown = inject(provider.token);
            if (!this.isPaymentSource(source)) {
                throw new InternalError(`${getDiTokenName(provider.token)} is provided as an invoice payment source, and needs to be one.`);
            }
            return source;
        });
    }

    private isPaymentSource(value: unknown): value is InvoicePaymentSourceInterface {
        return typeof value === 'object'
            && value != undefined
            && 'resolvePaidAmounts' in value
            && typeof value.resolvePaidAmounts === 'function';
    }
}