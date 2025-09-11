import { InvoiceNumberServiceInterface } from './invoice-number-service.interface';
import { Repository, Transaction } from '../../../data-source';
import { Inject, InjectRepository } from '../../../di';
import { ConflictError } from '../../../error-handling';
import { OmitStrict } from '../../../types';
import { ZIBRI_INVOICING_DI_TOKENS } from '../invoicing.tokens';
import { Invoice, InvoiceAddress, type InvoicingOptions, NumberInvoices } from '../models';

/**
 * Default implementation of the invoice number service.
 */
export class InvoiceNumberService implements InvoiceNumberServiceInterface<InvoiceAddress> {
    constructor(
        @InjectRepository(Invoice)
        private readonly invoiceRepository: Repository<Invoice>,
        @InjectRepository(NumberInvoices)
        private readonly numberInvoicesRepository: Repository<
            NumberInvoices,
            OmitStrict<NumberInvoices, 'id'>,
            OmitStrict<NumberInvoices, 'id'>
        >,
        @Inject(ZIBRI_INVOICING_DI_TOKENS.OPTIONS)
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
        if (!await this.invoiceRepository.findOne({ where: { number: result } }, false)) {
            return result;
        }

        let suffix: number = 2;
        while (await this.invoiceRepository.findOne({ where: { number: `${result}${this.options.separator}${suffix}` } }, false)) {
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
            { where: { year: currentYear, recipientId } },
            false
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
        let numberOfInvoices: NumberInvoices | undefined = await this.numberInvoicesRepository.findOne(
            { where: { year: currentYear, recipientId: recipientId } },
            false
        );
        if (numberOfInvoices) {
            numberOfInvoices.number++;
            await this.numberInvoicesRepository.updateById(
                numberOfInvoices.id,
                { number: numberOfInvoices.number, recipientId: numberOfInvoices.recipientId, year: numberOfInvoices.year },
                { transaction }
            );
        }
        else {
            numberOfInvoices = await this.numberInvoicesRepository.create(
                {
                    number: 1,
                    year: currentYear,
                    recipientId: recipientId
                },
                { transaction }
            );
        }

        return String(numberOfInvoices.number).padStart(this.options.numberOfDigits, '0');
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
        if (await this.invoiceRepository.findOne({ where: { number: invoiceNumber } }, false)) {
            throw new ConflictError(`The generated invoice-number ${invoiceNumber} already exists!`);
        }
    }
}