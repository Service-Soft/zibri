
import { InvoiceConformance, InvoiceConformanceServiceInterface } from './conformance';
import { InvoicePdfServiceInterface } from './invoice-pdf-service.interface';
import { Inject, ZIBRI_DI_TOKENS } from '../../../di';
import { PdfColumnDefinition, PdfContentDefinition, PdfContentSize, PdfDocument, PdfDocumentDefinition, PdfTableCellDefinition, PdfUtilities } from '../../../document';
import type { FormatDateFn, FormatPercentFn, FormatPriceFn } from '../../../localization';
import { BigNumber } from '../../../utilities';
import { Invoice, type InvoicingOptions, Vat } from '../models';
import { type InvoiceCalcServiceInterface } from './invoice-calc-service.interface';
import { ZIBRI_INVOICING_DI_TOKENS } from '../invoicing.tokens';

/**
 * Default implementation of the invoice pdf service.
 */
export class InvoicePdfService implements InvoicePdfServiceInterface<Invoice> {
    /**
     * The definition of the header of the pdf.
     */
    protected readonly header: PdfContentDefinition;
    /**
     * The definition of the footer of the pdf.
     */
    protected readonly footer: PdfContentDefinition;
    /**
     * The definition of the column in the letterhead that displays the information about the company that is sending out the invoice.
     */
    protected readonly companyLetterheadColumn: PdfColumnDefinition;

    constructor(
        @Inject(ZIBRI_INVOICING_DI_TOKENS.OPTIONS)
        protected readonly options: InvoicingOptions,
        @Inject(ZIBRI_INVOICING_DI_TOKENS.INVOICE_CALC_SERVICE)
        private readonly invoiceCalcService: InvoiceCalcServiceInterface<Invoice>,
        @Inject(ZIBRI_INVOICING_DI_TOKENS.INVOICE_CONFORMANCE_SERVICES)
        private readonly invoiceConformanceServices: InvoiceConformanceServiceInterface<Invoice>[],
        @Inject(ZIBRI_DI_TOKENS.FORMAT_DATE)
        private readonly formatDate: FormatDateFn,
        @Inject(ZIBRI_DI_TOKENS.FORMAT_PRICE)
        private readonly formatPrice: FormatPriceFn,
        @Inject(ZIBRI_DI_TOKENS.FORMAT_PERCENT)
        private readonly formatPercent: FormatPercentFn
    ) {
        this.header = this.getHeader();
        this.footer = this.getFooter();
        this.companyLetterheadColumn = this.getCompanyLetterheadColumn();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async generateInvoicePdf(invoice: Invoice, conformance?: InvoiceConformance): Promise<PdfDocument> {
        const documentDefinition: PdfDocumentDefinition = await this.generateInvoiceDocumentDefinition(invoice, conformance);
        const doc: PdfDocument = PdfUtilities.create(documentDefinition, undefined);
        return doc;
    }

    /**
     * Generates a pdf document definition for the given invoice.
     * @param invoice - The invoice to generate the document definition for.
     * @param conformance - The legal conformance that the invoice should conform to.
     * @returns The invoice document definition.
     */
    protected async generateInvoiceDocumentDefinition(
        invoice: Invoice,
        conformance: InvoiceConformance | undefined
    ): Promise<PdfDocumentDefinition> {
        const taxGroups: Vat[] = this.getTaxGroups(invoice);
        const res: PdfDocumentDefinition = {
            info: {
                producer: this.options.companyInfo.fullName
            },
            pageSize: 'A4',
            pageMargins: [40, 40, 40, 70],
            attachments: [],
            version: '1.7',
            subset: 'PDF/A-3',
            images: this.options.images,
            header: this.header,
            content: [
                this.getLetterhead(invoice),
                {
                    text: this.options.headline,
                    fontSize: this.options.headlineFontSize,
                    margin: [0, 10, 0, 10],
                    bold: true
                },
                this.getNumberAndDates(invoice),
                ...this.getContentFromParagraphs(invoice.textBeforeItems),
                await this.getInvoiceItemsTable(invoice, taxGroups),
                await this.getTotalTable(invoice, taxGroups),
                ...this.getContentFromParagraphs(invoice.textAfterItems)
            ],
            footer: this.footer
        };
        if (conformance != undefined) {
            await this.getConformanceService(conformance).updateDocumentDefinition(invoice, res);
        }
        return res;
    }

    /**
     * Gets the conformance service for the given name.
     * @param conformance - The name of the conformance to get the service for.
     * @returns The found conformance service.
     * @throws When no conformance service has been found.
     */
    protected getConformanceService(conformance: InvoiceConformance): InvoiceConformanceServiceInterface<Invoice> {
        const res: InvoiceConformanceServiceInterface<Invoice> | undefined = this.invoiceConformanceServices
            .find(s => s.name === conformance);
        if (!res) {
            throw new Error(
                [
                    `Could not find InvoiceConformanceService for "${conformance}".`,
                    'Did you forget to add the conformance service to your ZIBRI_INVOICING_DI_TOKENS.INVOICE_CONFORMANCE_SERVICES provider?'
                ].join('\n')
            );
        }
        return res;
    }

    /**
     * Gets the table that displays the total price of all items.
     * @param invoice - The invoice to get the table from.
     * @param taxGroups - The different tax groups that need to be taken into consideration.
     * @returns The total price of all items and the tax groups.
     */
    protected async getTotalTable(invoice: Invoice, taxGroups: Vat[]): Promise<PdfContentDefinition> {
        return {
            table: {
                headerRows: 0,
                widths: ['*', 159],
                body: await this.getTotalBody(invoice, taxGroups)
            },
            fontSize: this.options.tableFontSize,
            bold: true,
            margin: [0, 15, 0, 20]
        };
    }

    /**
     * Gets the body of the total table.
     * @param invoice - The invoice to build the body from.
     * @param taxGroups - The different tax groups that need to be taken into consideration.
     * @returns The body of the total table.
     */
    protected async getTotalBody(invoice: Invoice, taxGroups: Vat[]): Promise<PdfTableCellDefinition[][]> {
        if (!taxGroups.length) {
            const totalBeforeTax: BigNumber = await this.invoiceCalcService.getTotalBeforeTax(invoice);
            return [[this.options.totalLabel, this.formatPrice(totalBeforeTax, invoice.currency, invoice.customerAddressData.countryId)]];
        }
        const totalBeforeTax: BigNumber = await this.invoiceCalcService.getTotalBeforeTax(invoice);
        const res: PdfTableCellDefinition[][] = [
            [
                this.options.totalBeforeTaxLabel,
                this.formatPrice(totalBeforeTax, invoice.currency, invoice.customerAddressData.countryId)
            ]
        ];
        for (const group of taxGroups) {
            const totalTaxOfGroup: BigNumber = await this.invoiceCalcService.getTotalTaxForTaxGroup(invoice, group, true);
            res.push([
                `${this.formatPercent(group.rate)} ${this.options.taxLabel}`,
                this.formatPrice(totalTaxOfGroup, invoice.currency, invoice.customerAddressData.countryId)
            ]);
        }

        const totalAfterTax: BigNumber = await this.invoiceCalcService.getTotalAfterTax(invoice);
        res.push([
            this.options.totalAfterTaxLabel,
            this.formatPrice(totalAfterTax, invoice.currency, invoice.customerAddressData.countryId)
        ]);
        return res;
    }

    /**
     * Gets the table that displays all invoice items.
     * @param invoice - The invoice to build the table from.
     * @param taxGroups - The different tax groups that need to be taken into consideration.
     * @returns The table with all invoice items.
     */
    protected async getInvoiceItemsTable(invoice: Invoice, taxGroups: Vat[]): Promise<PdfContentDefinition> {
        const widths: PdfContentSize[] = taxGroups.length ? ['*', 75, 75, 75, 75] : ['*', 100, 100, 100];
        return {
            table: {
                headerRows: 1,
                widths: widths,
                body: await this.getInvoiceItemsBody(invoice, taxGroups)
            },
            fontSize: this.options.tableFontSize,
            margin: [0, 25, 0, 0]
        };
    }

    /**
     * Gets the body of the invoice items table.
     * @param invoice - The invoice to build the body from.
     * @param taxGroups - The different tax groups that need to be taken into consideration.
     * @returns The body of the invoice items table.
     */
    protected async getInvoiceItemsBody(invoice: Invoice, taxGroups: Vat[]): Promise<PdfTableCellDefinition[][]> {
        const res: PdfTableCellDefinition[][] = [this.getInvoiceItemsHeaders(taxGroups)];
        for (const item of invoice.items) {
            const totalPricePreTax: BigNumber = await this.invoiceCalcService.getItemTotalPriceBeforeTax(item);
            const amount: string = `${item.amount} ${item.amountUnit.displayName}`;
            if (taxGroups.length) {
                res.push([
                    item.name,
                    amount,
                    this.formatPrice(item.price, invoice.currency, invoice.customerAddressData.countryId),
                    item.vat.rate ? this.formatPercent(item.vat.rate) : '-',
                    this.formatPrice(totalPricePreTax.toNumber(), invoice.currency, invoice.customerAddressData.countryId)
                ]);
            }
            else {
                res.push([
                    item.name,
                    amount,
                    this.formatPrice(item.price, invoice.currency, invoice.customerAddressData.countryId),
                    this.formatPrice(totalPricePreTax.toNumber(), invoice.currency, invoice.customerAddressData.countryId)
                ]);
            }
        }
        return res;
    }

    /**
     * Gets the headers for the invoice items table. If the only tax group is 0, the tax column is removed.
     * @param taxGroups - The different tax groups that need to be taken into consideration.
     * @returns The headers of the invoice items table.
     */
    protected getInvoiceItemsHeaders(taxGroups: Vat[]): PdfTableCellDefinition[] {
        const headers: PdfTableCellDefinition[] = [
            {
                text: this.options.itemNameLabel,
                bold: true
            },
            {
                text: this.options.itemAmountLabel,
                bold: true
            },
            {
                text: this.options.itemSinglePriceLabel,
                bold: true
            }
        ];
        if (taxGroups.length) {
            headers.push({
                text: this.options.taxLabel,
                bold: true
            });
        }
        headers.push({
            text: this.options.itemTotalPriceLabel,
            bold: true
        });
        return headers;
    }

    /**
     * Gets the text that should be displayed before the actual invoice items start.
     * @param paragraphs - The paragraphs to get the text from.
     * @returns The text that should be displayed before the actual invoice items.
     */
    protected getContentFromParagraphs(paragraphs: string[]): PdfContentDefinition[] {
        return paragraphs.map(t => {
            return {
                text: t,
                margin: [0, 10, 0, 0]
            };
        });
    }

    /**
     * Gets the invoice number and the dates.
     * @param invoice - The invoice to build the content from.
     * @returns The content containing the invoice number and the date, performance date and due date.
     */
    protected getNumberAndDates(invoice: Invoice): PdfContentDefinition {
        const invoiceNumberColumn: PdfColumnDefinition = [
            {
                text: `${this.options.invoiceNumberLabel}: ${invoice.number}`,
                alignment: 'left'
            },
            {
                text: this.options.invoiceNumberNotice,
                fontSize: 8,
                italics: true
            }
        ];
        const dateColumn: PdfColumnDefinition = [
            {
                text: `${this.options.dateLabel}: ${this.formatDate(invoice.date, false, invoice.customerAddressData.countryId)}`,
                alignment: 'right'
            }
        ];
        if (this.options.showPerformanceDate) {
            const perfDate: string = this.formatDate(invoice.performanceDate, false, invoice.customerAddressData.countryId);
            dateColumn.push({
                text: `${this.options.performanceDateLabel}: ${perfDate}`,
                alignment: 'right'
            });
        }
        if (this.options.showDueDate) {
            dateColumn.push({
                text: `${this.options.dueDateLabel}: ${this.formatDate(invoice.dueDate, false, invoice.customerAddressData.countryId)}`,
                alignment: 'right'
            });
        }
        return {
            columns: [
                invoiceNumberColumn,
                dateColumn
            ]
        };
    }

    /**
     * Gets the letterhead.
     * @param invoice - The invoice to get the letterhead from.
     * @returns The letterhead of the customer and the company.
     */
    protected getLetterhead(invoice: Invoice): PdfContentDefinition {
        return {
            columns: [
                this.getCustomerLetterheadColumn(invoice),
                {
                    columns: [this.companyLetterheadColumn],
                    width: 'auto'
                }
            ]
        };
    }

    /**
     * Gets the letterhead of the customer.
     * @param invoice - The invoice to get the customer letterhead from.
     * @returns The letterhead of the customer, containing the name and address.
     */
    protected getCustomerLetterheadColumn(invoice: Invoice): PdfColumnDefinition {
        // eslint-disable-next-line stylistic/max-len
        const companyAddressLine: string = `${this.options.companyInfo.fullName} - ${this.options.companyInfo.address.street} ${this.options.companyInfo.address.number} - ${this.options.companyInfo.address.postcode} ${this.options.companyInfo.address.city}`;
        const fontSize: number = this.getFontSizeForLetterhead(companyAddressLine);
        return [
            {
                text: companyAddressLine,
                fontSize: fontSize,
                alignment: 'left',
                margin: [0, 0, 0, 5],
                decoration: 'underline'
            },
            this.getCustomerName(invoice),
            `${invoice.customerAddressData.street} ${invoice.customerAddressData.number}`,
            `${invoice.customerAddressData.postcode} ${invoice.customerAddressData.city}`
        ];
    }

    private getCustomerName(invoice: Invoice): string {
        if (invoice.customerAddressData.company && invoice.customerAddressData.companyName) {
            return invoice.customerAddressData.companyName;
        }
        return `${invoice.customerAddressData.firstName} ${invoice.customerAddressData.lastName}`;
    }

    /**
     * Gets the font size for the provided company address line.
     * Checks if the address line is too big and makes the font smaller accordingly.
     * @param companyAddressLine - The company address line of the invoice.
     * @returns The font size to use for the letter head.
     */
    protected getFontSizeForLetterhead(companyAddressLine: string): number {
        if (companyAddressLine.length > 85) {
            return 4;
        }
        if (companyAddressLine.length > 65) {
            return 6;
        }
        return 8;
    }

    /**
     * Gets the letterhead of the company.
     * @returns The letterhead of the company, containing full name, address and contact information.
     */
    protected getCompanyLetterheadColumn(): PdfColumnDefinition {
        return [
            {
                text: this.options.companyInfo.fullName,
                bold: true
            },
            `${this.options.companyInfo.address.street} ${this.options.companyInfo.address.number}`,
            {
                text: `${this.options.companyInfo.address.postcode} ${this.options.companyInfo.address.city}`,
                margin: [0, 0, 0, 10]
            },
            `${this.options.phoneLabel}: ${this.options.companyInfo.phone}`,
            `${this.options.emailLabel}: ${this.options.companyInfo.email}`
        ];
    }

    /**
     * Gets all relevant tax groups for the pdf file.
     * @param invoice - The invoice to get the tax groups for.
     * @returns The tax groups for the pdf.
     */
    protected getTaxGroups(invoice: Invoice): Vat[] {
        const vats: Vat[] = [...new Set(invoice.items.map(item => item.vat))];
        return vats.filter(v => v.rate !== 0);
    }

    /**
     * Gets the Content of the header.
     * @returns A row with the logo or an empty array if no logo has been specified.
     */
    protected getHeader(): PdfContentDefinition {
        if (!this.options.logo) {
            return [];
        }
        return [
            {
                columns: [
                    {
                        width: '*',
                        text: ''
                    },
                    {
                        fit: [500, 25],
                        image: this.options.logo
                    }
                ]
            }
        ];
    }

    /**
     * Gets the Content of the footer.
     * @returns Multiple rows containing information about the company and payment data.
     */
    protected getFooter(): PdfContentDefinition {
        return {
            columns: [
                this.getFirstFooterColumn(),
                this.getSecondFooterColumn()
            ],
            margin: [40, 0, 0, 0],
            fontSize: this.options.footerFontSize
        };
    }

    /**
     * Gets the first column of the footer.
     * @returns The column definition.
     */
    protected getFirstFooterColumn(): PdfColumnDefinition {
        const res: PdfColumnDefinition = [
            {
                text: this.options.bankDetailsLabel,
                bold: true
            }
        ];
        if (this.options.bankName) {
            res.push(this.options.bankName);
        }
        if (this.options.companyInfo.iban) {
            res.push(`${this.options.ibanLabel} ${this.options.companyInfo.iban}`);
        }
        if (this.options.companyInfo.bic) {
            res.push(`${this.options.bicLabel} ${this.options.companyInfo.bic}`);
        }
        return res;
    }

    /**
     * Gets the second column of the footer.
     * @returns The column definition.
     */
    protected getSecondFooterColumn(): PdfColumnDefinition {
        const res: PdfColumnDefinition = [
            {
                text: this.options.companyInfo.fullName,
                bold: true
            }
        ];
        if (this.options.companyInfo.taxNumber) {
            res.push(`${this.options.taxNumberLabel} ${this.options.companyInfo.taxNumber}`);
        }
        if (this.options.taxOffice) {
            res.push(this.options.taxOffice);
        }
        if (this.options.companyInfo.ceo) {
            res.push(`${this.options.ceoLabel} ${this.options.companyInfo.ceo}`);
        }
        return res;
    }
}