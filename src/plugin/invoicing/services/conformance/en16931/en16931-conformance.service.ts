import { Inject } from '../../../../../di';
import { PdfAttachmentDefinition, PdfDocument, PdfDocumentDefinition, XML, XmlUtilities } from '../../../../../document';
import { MimeType } from '../../../../../http';
import { ZIBRI_INVOICING_DI_TOKENS } from '../../../invoicing.tokens';
import { Invoice, InvoiceItem, type InvoicingOptions, Vat } from '../../../models';
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
        @Inject(ZIBRI_INVOICING_DI_TOKENS.OPTIONS)
        protected readonly options: InvoicingOptions,
        @Inject(ZIBRI_INVOICING_DI_TOKENS.INVOICE_CALC_SERVICE)
        private readonly invoiceCalcService: InvoiceCalcServiceInterface<Invoice>
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateDocumentDefinition(invoice: Invoice, definition: PdfDocumentDefinition): Promise<void> {
        const now: Date = new Date();
        const xml: XML = await this.generateXml(invoice);
        const xmlString: string = xml.end({ prettyPrint: true });
        const attachment: PdfAttachmentDefinition = {
            src: Buffer.from(xmlString),
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
    updateDocument(doc: PdfDocument): void {
        // do nothing.
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async generateXml(invoice: Invoice): Promise<XML> {
        const xml: XML = await this.createCrossIndustryInvoiceXml(invoice, undefined, this.documentContextId);
        return xml;
    }

    private async createCrossIndustryInvoiceXml(
        invoice: Invoice,
        tradeContact: string | undefined = this.options.companyInfo.ceo,
        documentContextId: EN16931DocumentContextId
        // urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0
    ): Promise<XML> {
        if (!tradeContact) {
            throw new Error('No trade contact has been provided. (This defaults to companyInfo.CEO)');
        }
        const root: XML = XmlUtilities.create({
            version: '1.0',
            encoding: 'utf8'
        }).ele(
            'rsm:CrossIndustryInvoice', {
                'xmlns:rsm': 'urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100',
                'xmlns:qdt': 'urn:un:unece:uncefact:data:standard:QualifiedDataType:100',
                'xmlns:ram': 'urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100',
                'xmlns:xs': 'http://www.w3.org/2001/XMLSchema',
                'xmlns:udt': 'urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100'
            }
        );

        const documentContext: XML = root.ele('rsm:ExchangedDocumentContext');
        documentContext.ele('ram:BusinessProcessSpecifiedDocumentContextParameter')
            .ele('ram:ID')
            .txt('urn:fdc:peppol.eu:2017:poacc:billing:01:1.0');
        documentContext.ele('ram:GuidelineSpecifiedDocumentContextParameter')
            .ele('ram:ID')
            .txt(documentContextId);

        const exchangedDocument: XML = root.ele('rsm:ExchangedDocument');
        exchangedDocument.ele('ram:ID').txt(invoice.number);
        // eslint-disable-next-line sonar/no-duplicate-string
        exchangedDocument.ele('ram:TypeCode').txt('380'); // 380 = Commercial invoice
        exchangedDocument.ele('ram:IssueDateTime')
        // eslint-disable-next-line sonar/no-duplicate-string
            .ele('udt:DateTimeString', { format: '102' })
            .txt(this.dateTo102(invoice.date));

        const tradeTransaction: XML = root.ele('rsm:SupplyChainTradeTransaction');

        await this.buildTradeLineItems(invoice, tradeTransaction);

        const tradeAgreement: XML = tradeTransaction.ele('ram:ApplicableHeaderTradeAgreement');
        tradeAgreement.ele('ram:BuyerReference').txt('999');
        this.buildSellerParty(tradeAgreement, tradeContact);
        this.buildBuyerParty(tradeAgreement, invoice);

        tradeTransaction.ele('ram:ApplicableHeaderTradeDelivery')
            .ele('ram:ActualDeliverySupplyChainEvent')
            .ele('ram:OccurrenceDateTime')
            .ele('udt:DateTimeString', { format: '102' })
            .txt(this.dateTo102(invoice.performanceDate));

        const tradeSettlement: XML = tradeTransaction.ele('ram:ApplicableHeaderTradeSettlement');
        tradeSettlement.ele('ram:InvoiceCurrencyCode').txt(invoice.currency);

        // payment options
        const paymentMeans: XML = tradeSettlement.ele('ram:SpecifiedTradeSettlementPaymentMeans');
        paymentMeans.ele('ram:TypeCode').txt('58');
        if (!this.options.companyInfo.iban || !this.options.companyInfo.bic) {
            throw new Error('At least the iban and bic need to be provided for payment information.');
        }
        paymentMeans.ele('ram:PayeePartyCreditorFinancialAccount').ele('ram:IBANID')
            .txt(this.options.companyInfo.iban);
        paymentMeans.ele('ram:PayeeSpecifiedCreditorFinancialInstitution').ele('ram:BICID')
            .txt(this.options.companyInfo.bic);

        // taxes
        const taxGroups: Vat[] = this.getTaxGroups(invoice);
        for (const taxGroup of taxGroups) {
            const tax: XML = tradeSettlement.ele('ram:ApplicableTradeTax');
            const totalTaxForTaxGroup: string = (await this.invoiceCalcService.getTotalTaxForTaxGroup(invoice, taxGroup, false)).toString();
            // eslint-disable-next-line stylistic/max-len
            const totalBeforeTaxForTaxGroup: string = (await this.invoiceCalcService.getTotalBeforeTaxForTaxGroup(invoice, taxGroup, false)).toString();
            tax.ele('ram:CalculatedAmount').txt(totalTaxForTaxGroup);
            tax.ele('ram:TypeCode').txt('VAT');
            if (taxGroup.categoryCode === 'E') {
                if (!taxGroup.exemptionReason) {
                    throw new Error('No exemption reason has been provided.');
                }
                tax.ele('ram:ExemptionReason').txt(taxGroup.exemptionReason);
            }
            tax.ele('ram:BasisAmount').txt(totalBeforeTaxForTaxGroup);
            tax.ele('ram:CategoryCode').txt(taxGroup.categoryCode);
            tax.ele('ram:RateApplicablePercent').txt(taxGroup.rate.toString());
        }
        // payment terms
        tradeSettlement.ele('ram:SpecifiedTradePaymentTerms')
            .ele('ram:DueDateDateTime')
            .ele('udt:DateTimeString', { format: '102' })
            .txt(this.dateTo102(invoice.dueDate));
        // summary
        const totalBeforeTax: string = (await this.invoiceCalcService.getTotalBeforeTax(invoice)).toString();
        const summary: XML = tradeSettlement.ele('ram:SpecifiedTradeSettlementHeaderMonetarySummation');
        summary.ele('ram:LineTotalAmount').txt(totalBeforeTax);
        // ChargeTotalAmount
        // AllowanceTotalAmount
        const totalAfterTax: string = (await this.invoiceCalcService.getTotalAfterTax(invoice)).toString();
        const totalTax: string = (await this.invoiceCalcService.getTotalTax(invoice)).toString();
        summary.ele('ram:TaxBasisTotalAmount').txt(totalBeforeTax);
        summary.ele('ram:TaxTotalAmount').txt(totalTax)
            .att('currencyID', invoice.currency);
        summary.ele('ram:GrandTotalAmount').txt(totalAfterTax);
        // TotalPrepaidAmount
        summary.ele('ram:DuePayableAmount').txt(totalAfterTax);
        return root;
    }

    private buildBuyerParty(tradeAgreement: XML, invoice: Invoice): void {
        const buyerParty: XML = tradeAgreement.ele('ram:BuyerTradeParty');
        buyerParty.ele('ram:Name').txt(this.getCustomerName(invoice));
        if (!invoice.customerAddressData.email) {
            throw new Error('No customer email has been provided (invoice.customerAddressData.email).');
        }
        const buyerPostalTradeAddress: XML = buyerParty.ele('ram:PostalTradeAddress');
        buyerPostalTradeAddress.ele('ram:PostcodeCode').txt(invoice.customerAddressData.postcode);
        buyerPostalTradeAddress.ele('ram:LineOne').txt(`${invoice.customerAddressData.street} ${invoice.customerAddressData.number}`);
        buyerPostalTradeAddress.ele('ram:CityName').txt(invoice.customerAddressData.city);
        buyerPostalTradeAddress.ele('ram:CountryID').txt(invoice.customerAddressData.countryId);

        buyerParty.ele('ram:URIUniversalCommunication')
            .ele('ram:URIID', { schemeID: 'EM' })
            .txt(invoice.customerAddressData.email);
    }

    private buildSellerParty(tradeAgreement: XML, tradeContact: string): void {
        const sellerParty: XML = tradeAgreement.ele('ram:SellerTradeParty');
        sellerParty.ele('ram:Name').txt(this.options.companyInfo.fullName);
        if (!this.options.companyInfo.taxNumber) {
            throw new Error('No tax number has been provided.');
        }
        sellerParty.ele('ram:SpecifiedLegalOrganization')
            .ele('ram:ID')
            .txt(this.options.companyInfo.taxNumber);

        const sellerContact: XML = sellerParty.ele('ram:DefinedTradeContact');
        sellerContact.ele('ram:PersonName').txt(tradeContact);
        sellerContact.ele('ram:TelephoneUniversalCommunication')
            .ele('ram:CompleteNumber')
            .txt(this.options.companyInfo.phone);
        sellerContact.ele('ram:EmailURIUniversalCommunication')
            .ele('ram:URIID')
            .txt(this.options.companyInfo.email);

        const sellerPostalTradeAddress: XML = sellerParty.ele('ram:PostalTradeAddress');
        sellerPostalTradeAddress.ele('ram:PostcodeCode').txt(this.options.companyInfo.address.postcode);
        sellerPostalTradeAddress.ele('ram:LineOne').txt(
            `${this.options.companyInfo.address.street} ${this.options.companyInfo.address.number}`
        );
        sellerPostalTradeAddress.ele('ram:CityName').txt(this.options.companyInfo.address.city);
        sellerPostalTradeAddress.ele('ram:CountryID').txt(this.options.companyInfo.address.countryId);
        sellerParty.ele('ram:URIUniversalCommunication')
            .ele('ram:URIID', { schemeID: 'EM' })
            .txt(this.options.companyInfo.email);

        if (this.options.companyInfo.vatNumber) {
            sellerParty.ele('ram:SpecifiedTaxRegistration')
                .ele('ram:ID', { schemeID: 'VA' })
                .txt(this.options.companyInfo.vatNumber);
        }
        sellerParty
            .ele('ram:SpecifiedTaxRegistration')
            .ele('ram:ID', { schemeID: 'FC' })
            .txt(this.options.companyInfo.taxNumber);
    }

    private async buildTradeLineItems(invoice: Invoice, tradeTransaction: XML): Promise<void> {
        for (let i: number = 0; i < invoice.items.length; i++) {
            const invoiceItem: InvoiceItem = invoice.items[i];
            const lineItem: XML = tradeTransaction.ele('ram:IncludedSupplyChainTradeLineItem');
            lineItem.ele('ram:AssociatedDocumentLineDocument')
                .ele('ram:LineID')
                .txt((i + 1).toString());
            lineItem.ele('ram:SpecifiedTradeProduct')
                .ele('ram:Name')
                .txt(invoiceItem.name);
            lineItem.ele('ram:SpecifiedLineTradeAgreement')
                .ele('ram:NetPriceProductTradePrice')
                .ele('ram:ChargeAmount')
                .txt(invoiceItem.price.toString());
            lineItem.ele('ram:SpecifiedLineTradeDelivery')
                .ele('ram:BilledQuantity', { unitCode: invoiceItem.amountUnit.code })
                .txt(invoiceItem.amount.toString());

            const tradeSettlement: XML = lineItem.ele('ram:SpecifiedLineTradeSettlement');
            const tradeTax: XML = tradeSettlement.ele('ram:ApplicableTradeTax');
            tradeTax.ele('ram:TypeCode').txt('VAT');
            tradeTax.ele('ram:CategoryCode').txt(invoiceItem.vat.categoryCode);
            tradeTax.ele('ram:RateApplicablePercent').txt(invoiceItem.vat.rate.toString());
            const itemTotalPriceBeforeTax: string = (await this.invoiceCalcService.getItemTotalPriceBeforeTax(invoiceItem)).toString();
            tradeSettlement.ele('ram:SpecifiedTradeSettlementLineMonetarySummation')
                .ele('ram:LineTotalAmount')
                .txt(itemTotalPriceBeforeTax);
        }
    }

    private getCustomerName(invoice: Invoice): string {
        if (invoice.customerAddressData.company && invoice.customerAddressData.companyName) {
            return invoice.customerAddressData.companyName;
        }
        return `${invoice.customerAddressData.firstName} ${invoice.customerAddressData.lastName}`;
    }

    private dateTo102(value: Date): string {
        const date: Date = new Date(value);
        const year: number = date.getFullYear();
        const month: number = date.getMonth() + 1;
        const day: number = date.getDate();
        return `${year}${month.toString().padStart(2, '0')}${day.toString().padStart(2, '0')}`;
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