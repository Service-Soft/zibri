import { CiiCrossIndustryInvoice } from './cii/cii-cross-industry-invoice.model.ts';
import { CiiDateTime } from './cii/cii-date-time.model.ts';
import { CiiHeaderTradeSettlement } from './cii/cii-header-trade-settlement.model.ts';
import { CiiSchemedId } from './cii/cii-schemed-id.model.ts';
import { CiiTaxRegistration } from './cii/cii-tax-registration.model.ts';
import { CiiTradeLineItem } from './cii/cii-trade-line-item.model.ts';
import { CiiTradeParty } from './cii/cii-trade-party.model.ts';
import { CiiTradeTax } from './cii/cii-trade-tax.model.ts';
import { Inject } from '../../../../../di/decorators/inject.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../../../../di/default/zibri-di-tokens.default.ts';
import { PdfDocumentDefinition, PdfAttachmentDefinition, PdfDocument } from '../../../../../document/pdf.utilities.ts';
import { XmlString } from '../../../../../document/xml-string.type.ts';
import { XmlUtilities } from '../../../../../document/xml.utilities.ts';
import { InternalError } from '../../../../../error-handling/internal-error.model.ts';
import { MimeType } from '../../../../../http/mime-type.enum.ts';
import { getZonedDate, ZonedDate } from '../../../../../localization/format-date.function.ts';
import { type LocalizeServiceInterface } from '../../../../../localization/localize-service.interface.ts';
import { type Timezone } from '../../../../../localization/models/timezone.model.ts';
import { BigNumber, NumberUtilities } from '../../../../../utilities/number.utilities.ts';
import { optionalPeer } from '../../../../../utilities/optional-peer.function.ts';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../../../invoicing.tokens.ts';
import { CompanyInfo } from '../../../models/company-info.model.ts';
import { ElectronicAddress } from '../../../models/electronic-address.model.ts';
import { Invoice } from '../../../models/invoice.model.ts';
import { type InvoicingOptions } from '../../../models/invoicing-options.model.ts';
import { Vat } from '../../../models/vat.model.ts';
import { type CompanyInfoServiceInterface } from '../../company-info-service.interface.ts';
import { type InvoiceCalcServiceInterface } from '../../invoice-calc-service.interface.ts';
import { validateInvoiceTotal } from '../../validate-invoice-total.function.ts';
import { InvoiceConformance, InvoiceConformanceServiceInterface } from '../invoice-conformance-service.interface.ts';

/**
 * The different possible document context ids.
 */
export type EN16931DocumentContextId = 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0'
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
        protected readonly invoiceCalcService: InvoiceCalcServiceInterface<Invoice>,
        @Inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.COMPANY_INFO_SERVICE)
        private readonly companyInfoService: CompanyInfoServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE)
        private readonly localizeService: LocalizeServiceInterface
    ) {
        // at startup rather than at the first invoice, like pdfmake in the invoice pdf service. The
        // document is checked with saxes, like every document generateFrom writes
        optionalPeer('saxes', 'Invoices conforming to EN16931');
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
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

    // eslint-disable-next-line jsdoc-js/require-jsdoc, no-unused-vars
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
        await this.validateInvoice(invoice);
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

    /**
     * Validates that the invoice can be stated in the standard.
     * @param invoice - The invoice.
     * @throws When it cannot.
     */
    protected async validateInvoice(invoice: Invoice): Promise<void> {
        // BR-DEC-* allow two decimals for every amount, and rounding to fewer than the currency has
        // would state other amounts than the invoice's pdf
        const minorUnits: number = this.localizeService.getCurrencyMinorUnits(invoice.currency);
        if (minorUnits > 2) {
            throw new InternalError(`EN 16931 allows amounts of at most two decimals, and ${invoice.currency} has ${minorUnits}.`);
        }
        await validateInvoiceTotal(invoice, this.invoiceCalcService, this.localizeService);
    }

    /**
     * Resolves the electronic address a party is named by (BT-34 and BT-49).
     * @param party - Which party it is, for the message.
     * @param electronicAddress - The party's electronic address, if it has one.
     * @param email - The party's email, which names it without one.
     * @returns The address, as the document states it.
     * @throws When the party has neither.
     */
    protected resolveElectronicAddress(
        party: 'seller' | 'buyer',
        electronicAddress: ElectronicAddress | null | undefined,
        email: string | null | undefined
    ): CiiSchemedId {
        if (electronicAddress != undefined) {
            return { schemeId: electronicAddress.scheme, value: electronicAddress.value };
        }
        if (!email) {
            throw new InternalError(
                party === 'buyer'
                    ? 'No customer email has been provided (invoice.customerAddressData.email).'
                    : 'No company email has been provided (CompanyInfo.email).'
            );
        }
        return { schemeId: 'EM', value: email };
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
        for (const taxGroup of await this.getTaxGroups(invoice)) {
            if (taxGroup.categoryCode === 'E' && !taxGroup.exemptionReason) {
                throw new InternalError('No exemption reason has been provided.');
            }
            taxes.push({
                calculatedAmount: this.getAmount(await this.invoiceCalcService.getTotalTaxForTaxGroup(invoice, taxGroup, false), invoice),
                typeCode: 'VAT',
                exemptionReason: taxGroup.categoryCode === 'E' ? taxGroup.exemptionReason ?? undefined : undefined,
                basisAmount: this.getAmount(await this.invoiceCalcService.getTotalBeforeTaxForTaxGroup(invoice, taxGroup, false), invoice),
                categoryCode: taxGroup.categoryCode,
                rateApplicablePercent: NumberUtilities.new(taxGroup.rate).toFixed()
            });
        }

        // summary
        const totalBeforeTax: string = this.getAmount(await this.invoiceCalcService.getTotalBeforeTax(invoice), invoice);
        const totalAfterTax: string = this.getAmount(await this.invoiceCalcService.getTotalAfterTax(invoice), invoice);
        const totalTax: string = this.getAmount(await this.invoiceCalcService.getTotalTax(invoice), invoice);
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
        const uriId: CiiSchemedId = this.resolveElectronicAddress(
            'buyer',
            invoice.customerAddressData.electronicAddress,
            invoice.customerAddressData.email
        );
        return {
            name: this.getCustomerName(invoice),
            address: {
                postcode: invoice.customerAddressData.postcode,
                lineOne: `${invoice.customerAddressData.street} ${invoice.customerAddressData.number}`,
                city: invoice.customerAddressData.city,
                countryId: invoice.customerAddressData.countryId
            },
            communication: { uriId }
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
            communication: { uriId: this.resolveElectronicAddress('seller', company.electronicAddress, company.email) },
            taxRegistrations
        };
    }

    private async resolveTradeLineItems(invoice: Invoice): Promise<CiiTradeLineItem[]> {
        const lineItems: CiiTradeLineItem[] = [];
        for (const [i, invoiceItem] of invoice.items.entries()) {
            // a credit is a negative quantity at a positive price (BR-27), where an item states it as
            // a negative price. The same amount either way
            const credit: boolean = invoiceItem.price < 0;
            lineItems.push({
                associatedDocument: { lineId: (i + 1).toString() },
                product: { name: invoiceItem.name },
                // as given, in fixed notation: a price and a quantity may have more decimals than an
                // amount, but no exponent
                agreement: { netPrice: { chargeAmount: NumberUtilities.new(Math.abs(invoiceItem.price)).toFixed() } },
                delivery: {
                    billedQuantity: {
                        unitCode: invoiceItem.amountUnit.code,
                        value: NumberUtilities.new(credit ? -invoiceItem.amount : invoiceItem.amount).toFixed()
                    }
                },
                settlement: {
                    tax: {
                        typeCode: 'VAT',
                        categoryCode: invoiceItem.vat.categoryCode,
                        rateApplicablePercent: NumberUtilities.new(invoiceItem.vat.rate).toFixed()
                    },
                    summation: {
                        lineTotalAmount: this.getAmount(
                            await this.invoiceCalcService.getItemTotalPriceBeforeTax(invoiceItem, invoice.currency),
                            invoice
                        )
                    }
                }
            });
        }
        return lineItems;
    }

    /**
     * Gets an amount as the document states it: in fixed notation, with the minor units of the
     * invoice's currency.
     * @param amount - The amount, as calculated.
     * @param invoice - The invoice it is an amount of.
     * @returns The amount.
     */
    protected getAmount(amount: BigNumber, invoice: Invoice): string {
        return amount.toFixed(this.localizeService.getCurrencyMinorUnits(invoice.currency));
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
    protected async getTaxGroups(invoice: Invoice): Promise<Vat[]> {
        return await this.invoiceCalcService.getTaxGroups(invoice, false);
    }
}