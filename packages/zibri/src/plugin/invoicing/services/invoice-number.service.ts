import { InvoiceNumberServiceInterface } from './invoice-number-service.interface';
import { Repository } from '../../../data-source/repository/repository';
import { Transaction } from '../../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { inject } from '../../../di/inject.function';
import { ConflictError } from '../../../error-handling/errors/conflict.error';
import { $ts } from '../../../localization/translate.function';
import { OmitStrict } from '../../../types/omit-strict.type';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../invoicing.tokens';
import { InvoiceAddress } from '../models/invoice-address.model';
import { Invoice } from '../models/invoice.model';
import { type InvoicingOptions } from '../models/invoicing-options.model';
import { NumberInvoices } from '../models/number-invoices.model';

/**
 * Default implementation of the invoice number service.
 */
@Injectable({ register: 'onUse' })
export class InvoiceNumberService implements InvoiceNumberServiceInterface<InvoiceAddress> {
    // the two below are read when used rather than injected: this is built at every boot that uses
    // the plugin, and ZibriInvoicingPlugin.validate names the entities that are missing - which it
    // could not, if building this had failed on a repository token first
    private get invoiceRepository(): Repository<Invoice, OmitStrict<Invoice, 'id'>> {
        return inject(repositoryTokenFor(Invoice));
    }

    // without the tenant, which the repository gives every counter it creates
    private get numberInvoicesRepository(): Repository<NumberInvoices, OmitStrict<NumberInvoices, 'id' | 'tenantId'>> {
        return inject(repositoryTokenFor(NumberInvoices));
    }

    constructor(
        @Inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS)
        protected readonly options: InvoicingOptions
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async generateInvoiceNumber(
        recipientId: string,
        invoiceAddress: InvoiceAddress,
        transaction: Transaction | undefined,
        nameAbbreviation?: string
    ): Promise<string> {
        const currentYear: string = `${new Date().getFullYear()}`;
        const customerNameAbbreviation: string = nameAbbreviation ?? this.getCustomerNameAbbreviation(invoiceAddress);
        const consecutiveNumber: string = await this.getConsecutiveNumber(recipientId, transaction);
        // eslint-disable-next-line stylistic/max-len
        const result: string = `${currentYear}${this.options.separator}${customerNameAbbreviation}${this.options.separator}${consecutiveNumber}`;
        await this.validateInvoiceNumber(result);
        return result;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async generateTemporaryInvoiceNumber(recipientId: string, invoiceAddress: InvoiceAddress, nameAbbreviation?: string): Promise<string> {
        const currentYear: string = `${new Date().getFullYear()}`;
        const customerNameAbbreviation: string = nameAbbreviation ?? this.getCustomerNameAbbreviation(invoiceAddress);
        const consecutiveNumber: string = await this.getTemporaryConsecutiveNumber(recipientId);

        // eslint-disable-next-line stylistic/max-len
        const result: string = `TEMP${this.options.separator}${currentYear}${this.options.separator}${customerNameAbbreviation}${this.options.separator}${consecutiveNumber}`;
        if (!await this.invoiceRepository.findOne({ where: { number: result }, required: false })) {
            return result;
        }

        let suffix: number = 2;
        while (await this.invoiceRepository.findOne({
            where: { number: `${result}${this.options.separator}${suffix}` },
            required: false
        })) {
            suffix++;
        }
        return `${result}${this.options.separator}${suffix}`;
    }

    /**
     * Gets the temporary consecutive number of the invoices in this year and for the provided recipientId.
     * Prefixes it with zeroes until the result has the same length as this.options.numberOfDigits.
     * @param recipientId - The id of the recipient of the invoice.
     * @returns The number of invoices over a year filled up with zeroes to match this.options.numberOfDigits.
     */
    protected async getTemporaryConsecutiveNumber(recipientId: string): Promise<string> {
        const currentYear: number = new Date(Date.now()).getFullYear();
        let numberOfInvoices: NumberInvoices | undefined = await this.numberInvoicesRepository.findOne(
            { where: { year: currentYear, recipientId }, required: false }
        );
        numberOfInvoices ??= {
            number: 0,
            year: currentYear,
            recipientId: recipientId
        } as NumberInvoices;
        numberOfInvoices.number++;

        return String(numberOfInvoices.number).padStart(this.options.numberOfDigits, '0');
    }

    /**
     * Gets the consecutive number of the invoices in this year.
     * Prefixes it with zeroes until the result has the same length as this.options.numberOfDigits.
     * @param recipientId - The id of the recipient of the invoice.
     * @param transaction - An optional transaction from outside to make sure any changes only apply when the transaction is committed.
     * @returns The number of invoices over a year filled up with zeroes to match this.options.numberOfDigits.
     */
    protected async getConsecutiveNumber(recipientId: string, transaction: Transaction | undefined): Promise<string> {
        const currentYear: number = new Date(Date.now()).getFullYear();

        // One upsert, because nothing weaker holds. Reading the counter and writing it back is a
        // race whether or not it runs under a lock: the lock only covers the window it is held for,
        // and with a transaction the write lands on commit - after that window has closed. Two
        // callers then both read 41, both write 42, and two invoices carry the same legally binding
        // number. Only an increment with no window to interleave in avoids that.
        //
        // Staying inside the caller's transaction is deliberate. The number rolls back with the
        // invoice it was drawn for, so an abandoned invoice leaves no gap in the sequence - which is
        // the whole reason a counter is used here rather than a database sequence.
        const counter: NumberInvoices = await this.numberInvoicesRepository.upsert(
            { year: currentYear, recipientId: recipientId },
            { year: currentYear, recipientId: recipientId, number: 1 },
            { number: { increment: 1 } },
            { transaction }
        );

        return String(counter.number).padStart(this.options.numberOfDigits, '0');
    }

    /**
     * Gets the customer name abbreviation.
     * @param invoiceAddress - The address data to get the name abbreviation from.
     * @returns The first char of first and last name for private customers
     * and the first two chars of the company name for company customers.
     */
    protected getCustomerNameAbbreviation(invoiceAddress: InvoiceAddress): string {
        if (invoiceAddress.company && invoiceAddress.companyName) {
            return this.getCompanyNameAbbreviation(invoiceAddress.companyName);
        }
        return this.getPrivateCustomerAbbreviation(invoiceAddress);
    }

    private getPrivateCustomerAbbreviation(invoiceAddress: InvoiceAddress): string {
        let res: string = '';
        for (let i: number = 0; i < this.options.numberPrivateCustomerAbbreviationCharacters; i++) {
            if (invoiceAddress.firstName[i]) {
                res += invoiceAddress.firstName[i];
            }
        }
        for (let i: number = 0; i < this.options.numberPrivateCustomerAbbreviationCharacters; i++) {
            if (invoiceAddress.lastName[i]) {
                res += invoiceAddress.lastName[i];
            }
        }
        return res.toUpperCase();
    }

    private getCompanyNameAbbreviation(companyName: string): string {
        companyName = companyName.replaceAll(/\s/g, '');
        companyName = companyName.replaceAll(/[^\da-z]/gi, '');
        let res: string = '';
        for (let i: number = 0; i < this.options.numberCompanyAbbreviationCharacters; i++) {
            if (companyName[i]) {
                res += companyName[i];
            }
        }
        return res.toUpperCase();
    }

    /**
     * Validates the given invoice number.
     * @param invoiceNumber - The invoice number to validate.
     */
    protected async validateInvoiceNumber(invoiceNumber: string): Promise<void> {
        if (await this.invoiceRepository.findOne({ where: { number: invoiceNumber }, required: false })) {
            throw new ConflictError($ts`The generated invoice-number ${invoiceNumber} already exists!`);
        }
    }
}