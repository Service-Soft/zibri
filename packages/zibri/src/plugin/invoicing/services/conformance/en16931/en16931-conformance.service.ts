import { CiiCrossIndustryInvoice } from './cii/cii-cross-industry-invoice.model';
import { CiiDateTime } from './cii/cii-date-time.model';
import { CiiHeaderTradeSettlement } from './cii/cii-header-trade-settlement.model';
import { CiiTaxRegistration } from './cii/cii-tax-registration.model';
import { CiiTradeLineItem } from './cii/cii-trade-line-item.model';
import { CiiTradeParty } from './cii/cii-trade-party.model';
import { CiiTradeTax } from './cii/cii-trade-tax.model';
import { Inject } from '../../../../../di/decorators/inject.decorator';
import { PdfDocumentDefinition, PdfAttachmentDefinition, PdfDocument } from '../../../../../document/pdf.utilities';
import { XmlString } from '../../../../../document/xml-string.type';
import { XmlUtilities } from '../../../../../document/xml.utilities';
import { InternalError } from '../../../../../error-handling/internal-error.model';
import { MimeType } from '../../../../../http/mime-type.enum';
import { getZonedDate, ZonedDate } from '../../../../../localization/format-date.function';
import { type Timezone } from '../../../../../localization/models/timezone.model';
import { optionalPeer } from '../../../../../utilities/optional-peer.function';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../../../invoicing.tokens';
import { CompanyInfo } from '../../../models/company-info.model';
import { Invoice } from '../../../models/invoice.model';
import { type InvoicingOptions } from '../../../models/invoicing-options.model';
import { Vat } from '../../../models/vat.model';
import { type CompanyInfoServiceInterface } from '../../company-info-service.interface';
import { type InvoiceCalcServiceInterface } from '../../invoice-calc-service.interface';
import { InvoiceConformance, InvoiceConformanceServiceInterface } from '../invoice-conformance-service.interface';

/**
 * The different possible document context ids.
 */
export type EN16931DocumentContextId = 'urn:cen.eu:en16931:2017#compliant#urn:xrechnung:3.0'
    | 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0';

/**
 * Base service shared by all the specific standards that conform to EN16931.
 */
export abstract class EN16931ConformanceService implements InvoiceConformanceServiceInterface<Invoice> {

    abstract readonly name: InvoiceConformance;

    abstract readonly documentContextId: EN16931DocumentContextId;

    constructor(
        @Inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS)
        protected readonly options: InvoicingOptions,
        @Inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CALC_SERVICE)
        private readonly invoiceCalcService: InvoiceCalcServiceInterface<Invoice>,
        @Inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.COMPANY_INFO_SERVICE)
        private readonly companyInfoService: CompanyInfoServiceInterface
    ) {
        // at startup rather than at the first invoice, like pdfmake in the invoice pdf service. The
        // document is checked with saxes, like every document generateFrom writes
        optionalPeer('saxes', 'Invoices conforming to EN16931');
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateDocumentDefinition(invoice: Invoice, definition: PdfDocumentDefinition, timezone: Timezone): Promise<void> {
        const now: Date = new Date();
        const xml: XmlString = await this.generateXml(invoice, timezone);
        const attachment: PdfAttachmentDefinition = {
            src: Buffer.from(xml),
            options: {
                name: 'invoice.xml',
                creationDate: now,
                modifiedDate: now,
                type: MimeType.XML
            }
        };
        definition.attachments.push(attachment);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc, unusedImports/no-unused-vars
    updateDocument(_doc: PdfDocument): void {
        // do nothing.
    }

    /**
     * Writes the invoice as the Cross Industry Invoice document EN16931 exchanges it as.
     * @param invoice - The invoice.
     * @param timezone - The invoice's time zone, deciding which calendar day each of its dates falls on.
     * @returns The document, indented.
     */
    async generateXml(invoice: Invoice, timezone: Timezone): Promise<XmlString> {
        // the company of the invoice's own tenant, whichever tenant asks for it
        const company: CompanyInfo = await this.companyInfoService.resolveCompanyInfo(invoice.tenantId);
        const document: CiiCrossIndustryInvoice = await this.resolveCrossIndustryInvoice(
            invoice,
            timezone,
            company,
            company.ceo,
            this.documentContextId
        );
        return await XmlUtilities.generateFrom(CiiCrossIndustryInvoice, document, { indent: true });
    }

    private async resolveCrossIndustryInvoice(
        invoice: Invoice,
        timezone: Timezone,
        company: CompanyInfo,
        tradeContact: string | undefined,
        documentContextId: EN16931DocumentContextId
        // urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0
    ): Promise<CiiCrossIndustryInvoice> {
        if (!tradeContact) {
            throw new InternalError('No trade contact has been provided. (This defaults to companyInfo.CEO)');
        }
        return {
            exchangedDocumentContext: {
                businessProcess: { id: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0' },
                guideline: { id: documentContextId }
            },
            exchangedDocument: {
                id: invoice.number,
                typeCode: '380', // 380 = Commercial invoice
                issueDateTime: this.resolveDateTime(invoice.date, timezone)
            },
            supplyChainTradeTransaction: {
                lineItems: await this.resolveTradeLineItems(invoice),
                agreement: {
                    buyerReference: '999',
                    seller: this.resolveSellerParty(company, tradeContact),
                    buyer: this.resolveBuyerParty(invoice)
                },
                delivery: { event: { occurrence: this.resolveDateTime(invoice.performanceDate, timezone) } },
                settlement: await this.resolveTradeSettlement(invoice, company, timezone)
            }
        };
    }

    private async resolveTradeSettlement(invoice: Invoice, company: CompanyInfo, timezone: Timezone): Promise<CiiHeaderTradeSettlement> {
        // payment options
        if (!company.iban || !company.bic) {
            throw new InternalError('At least the iban and bic need to be provided for payment information.');
        }
        const paymentMeans: CiiHeaderTradeSettlement['paymentMeans'] = {
            typeCode: '58',
            account: { iban: company.iban },
            institution: { bic: company.bic }
        };

        // taxes
        const taxes: CiiTradeTax[] = [];
        for (const taxGroup of this.getTaxGroups(invoice)) {
            if (taxGroup.categoryCode === 'E' && !taxGroup.exemptionReason) {
                throw new InternalError('No exemption reason has been provided.');
            }
            taxes.push({
                calculatedAmount: (await this.invoiceCalcService.getTotalTaxForTaxGroup(invoice, taxGroup, false)).toString(),
                typeCode: 'VAT',
                exemptionReason: taxGroup.categoryCode === 'E' ? taxGroup.exemptionReason ?? undefined : undefined,
                basisAmount: (await this.invoiceCalcService.getTotalBeforeTaxForTaxGroup(invoice, taxGroup, false)).toString(),
                categoryCode: taxGroup.categoryCode,
                rateApplicablePercent: taxGroup.rate.toString()
            });
        }

        // summary
        const totalBeforeTax: string = (await this.invoiceCalcService.getTotalBeforeTax(invoice)).toString();
        const totalAfterTax: string = (await this.invoiceCalcService.getTotalAfterTax(invoice)).toString();
        const totalTax: string = (await this.invoiceCalcService.getTotalTax(invoice)).toString();
        return {
            currency: invoice.currency,
            paymentMeans,
            taxes,
            // payment terms
            paymentTerms: { dueDate: this.resolveDateTime(invoice.dueDate, timezone) },
            summation: {
                lineTotalAmount: totalBeforeTax,
                // ChargeTotalAmount
                // AllowanceTotalAmount
                taxBasisTotalAmount: totalBeforeTax,
                taxTotalAmount: { currency: invoice.currency, value: totalTax },
                grandTotalAmount: totalAfterTax,
                // TotalPrepaidAmount
                duePayableAmount: totalAfterTax
            }
        };
    }

    private resolveBuyerParty(invoice: Invoice): CiiTradeParty {
        if (!invoice.customerAddressData.email) {
            throw new InternalError('No customer email has been provided (invoice.customerAddressData.email).');
        }
        return {
            name: this.getCustomerName(invoice),
            address: {
                postcode: invoice.customerAddressData.postcode,
                lineOne: `${invoice.customerAddressData.street} ${invoice.customerAddressData.number}`,
                city: invoice.customerAddressData.city,
                countryId: invoice.customerAddressData.countryId
            },
            communication: { uriId: { schemeId: 'EM', value: invoice.customerAddressData.email } }
        };
    }

    private resolveSellerParty(company: CompanyInfo, tradeContact: string): CiiTradeParty {
        if (!company.taxNumber) {
            throw new InternalError('No tax number has been provided.');
        }
        const taxRegistrations: CiiTaxRegistration[] = [];
        if (company.vatNumber) {
            taxRegistrations.push({ id: { schemeId: 'VA', value: company.vatNumber } });
        }
        taxRegistrations.push({ id: { schemeId: 'FC', value: company.taxNumber } });

        return {
            name: company.fullName,
            legalOrganization: { id: company.taxNumber },
            contact: {
                personName: tradeContact,
                telephone: { completeNumber: company.phone },
                email: { uriId: { value: company.email } }
            },
            address: {
                postcode: company.address.postcode,
                lineOne: `${company.address.street} ${company.address.number}`,
                city: company.address.city,
                countryId: company.address.countryId
            },
            communication: { uriId: { schemeId: 'EM', value: company.email } },
            taxRegistrations
        };
    }

    private async resolveTradeLineItems(invoice: Invoice): Promise<CiiTradeLineItem[]> {
        const lineItems: CiiTradeLineItem[] = [];
        for (const [i, invoiceItem] of invoice.items.entries()) {
            lineItems.push({
                associatedDocument: { lineId: (i + 1).toString() },
                product: { name: invoiceItem.name },
                agreement: { netPrice: { chargeAmount: invoiceItem.price.toString() } },
                delivery: { billedQuantity: { unitCode: invoiceItem.amountUnit.code, value: invoiceItem.amount.toString() } },
                settlement: {
                    tax: {
                        typeCode: 'VAT',
                        categoryCode: invoiceItem.vat.categoryCode,
                        rateApplicablePercent: invoiceItem.vat.rate.toString()
                    },
                    summation: { lineTotalAmount: (await this.invoiceCalcService.getItemTotalPriceBeforeTax(invoiceItem)).toString() }
                }
            });
        }
        return lineItems;
    }

    private resolveDateTime(value: Date, timezone: Timezone): CiiDateTime {
        return { dateTimeString: { format: '102', value: this.dateTo102(value, timezone) } };
    }

    private getCustomerName(invoice: Invoice): string {
        if (invoice.customerAddressData.company && invoice.customerAddressData.companyName) {
            return invoice.customerAddressData.companyName;
        }
        return `${invoice.customerAddressData.firstName} ${invoice.customerAddressData.lastName}`;
    }

    /**
     * Renders a date as EN16931 format 102 (CCYYMMDD).
     *
     * Reads the instant in the invoice's own zone rather than the machine's, so that the day in the
     * xml is the day the issuer put on the invoice - and stays that day on a server anywhere else.
     * No locale is involved: format 102 is a machine representation and has none.
     * @param value - The date to render.
     * @param timezone - The invoice's time zone, deciding which calendar day the instant falls on.
     * @returns The date as a CCYYMMDD string.
     */
    private dateTo102(value: Date, timezone: Timezone): string {
        const date: ZonedDate = getZonedDate(value, timezone);
        const month: string = (date.month + 1).toString().padStart(2, '0');
        const day: string = date.day.toString().padStart(2, '0');
        return `${date.year}${month}${day}`;
    }

    /**
     * Gets all relevant tax groups for the xml file.
     * @param invoice - The invoice to get the tax groups for.
     * @returns The tax groups for the xml.
     */
    protected getTaxGroups(invoice: Invoice): Vat[] {
        return [...new Set(invoice.items.map(item => item.vat))];
    }
}