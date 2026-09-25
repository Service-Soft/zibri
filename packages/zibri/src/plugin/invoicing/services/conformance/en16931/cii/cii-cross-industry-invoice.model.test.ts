import { beforeAll, describe, expect, it } from '@jest/globals';

import { CiiCrossIndustryInvoice } from './cii-cross-industry-invoice.model';
import { initDiContainer } from '../../../../../../di/init-di-container.function';
import { XmlUtilities } from '../../../../../../document/xml.utilities';
import { GlobalRegistry } from '../../../../../../global/global-registry';

const invoice: CiiCrossIndustryInvoice = {
    exchangedDocumentContext: {
        businessProcess: { id: 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0' },
        guideline: { id: 'urn:cen.eu:en16931:2017#compliant#urn:xrechnung:3.0' }
    },
    exchangedDocument: {
        id: 'R-1',
        typeCode: '380',
        issueDateTime: { dateTimeString: { format: '102', value: '20240101' } }
    },
    supplyChainTradeTransaction: {
        lineItems: [
            {
                associatedDocument: { lineId: '1' },
                product: { name: 'Nuts & Bolts' },
                agreement: { netPrice: { chargeAmount: '10' } },
                delivery: { billedQuantity: { unitCode: 'H87', value: '2' } },
                settlement: {
                    tax: { typeCode: 'VAT', categoryCode: 'S', rateApplicablePercent: '19' },
                    summation: { lineTotalAmount: '20' }
                }
            }
        ],
        agreement: {
            buyerReference: '999',
            seller: {
                name: 'Great Company LLC',
                legalOrganization: { id: '123/456' },
                contact: {
                    personName: 'Jane Doe',
                    telephone: { completeNumber: '+49 123' },
                    email: { uriId: { value: 'info@great.example' } }
                },
                address: { postcode: '12345', lineOne: 'Main Street 1', city: 'Berlin', countryId: 'DE' },
                communication: { uriId: { schemeId: 'EM', value: 'info@great.example' } },
                taxRegistrations: [
                    { id: { schemeId: 'VA', value: 'DE123' } },
                    { id: { schemeId: 'FC', value: '123/456' } }
                ]
            },
            buyer: {
                name: 'Example Company LLC',
                address: { postcode: '54321', lineOne: 'Side Street 2', city: 'Hamburg', countryId: 'DE' },
                communication: { uriId: { schemeId: 'EM', value: 'buyer@example.com' } }
            }
        },
        delivery: { event: { occurrence: { dateTimeString: { format: '102', value: '20240102' } } } },
        settlement: {
            currency: 'EUR',
            paymentMeans: { typeCode: '58', account: { iban: 'DE75512108001245126199' }, institution: { bic: 'ABCD5F' } },
            taxes: [{ calculatedAmount: '3.8', typeCode: 'VAT', basisAmount: '20', categoryCode: 'S', rateApplicablePercent: '19' }],
            paymentTerms: { dueDate: { dateTimeString: { format: '102', value: '20240115' } } },
            summation: {
                lineTotalAmount: '20',
                taxBasisTotalAmount: '20',
                taxTotalAmount: { currency: 'EUR', value: '3.8' },
                grandTotalAmount: '23.8',
                duePayableAmount: '23.8'
            }
        }
    }
};

beforeAll(() => {
    initDiContainer();
    // validation problems are translated, which needs an application that exists
    GlobalRegistry.markAppAsCreated();
});

describe('CiiCrossIndustryInvoice', () => {
    it('is written with each element in the namespace of the model declaring it, under the prefixes of the root', async () => {
        // the structure the invoice was built as before it had models, element by element, so a document a
        // validator accepted then is the document it gets now
        expect(await XmlUtilities.generateFrom(CiiCrossIndustryInvoice, invoice, { indent: true })).toBe([
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<rsm:CrossIndustryInvoice'
            + ' xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"'
            + ' xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"'
            + ' xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"'
            + ' xmlns:xs="http://www.w3.org/2001/XMLSchema"'
            + ' xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">',
            '  <rsm:ExchangedDocumentContext>',
            '    <ram:BusinessProcessSpecifiedDocumentContextParameter>',
            '      <ram:ID>urn:fdc:peppol.eu:2017:poacc:billing:01:1.0</ram:ID>',
            '    </ram:BusinessProcessSpecifiedDocumentContextParameter>',
            '    <ram:GuidelineSpecifiedDocumentContextParameter>',
            '      <ram:ID>urn:cen.eu:en16931:2017#compliant#urn:xrechnung:3.0</ram:ID>',
            '    </ram:GuidelineSpecifiedDocumentContextParameter>',
            '  </rsm:ExchangedDocumentContext>',
            '  <rsm:ExchangedDocument>',
            '    <ram:ID>R-1</ram:ID>',
            '    <ram:TypeCode>380</ram:TypeCode>',
            '    <ram:IssueDateTime>',
            '      <udt:DateTimeString format="102">20240101</udt:DateTimeString>',
            '    </ram:IssueDateTime>',
            '  </rsm:ExchangedDocument>',
            '  <rsm:SupplyChainTradeTransaction>',
            '    <ram:IncludedSupplyChainTradeLineItem>',
            '      <ram:AssociatedDocumentLineDocument>',
            '        <ram:LineID>1</ram:LineID>',
            '      </ram:AssociatedDocumentLineDocument>',
            '      <ram:SpecifiedTradeProduct>',
            '        <ram:Name>Nuts &#x26; Bolts</ram:Name>',
            '      </ram:SpecifiedTradeProduct>',
            '      <ram:SpecifiedLineTradeAgreement>',
            '        <ram:NetPriceProductTradePrice>',
            '          <ram:ChargeAmount>10</ram:ChargeAmount>',
            '        </ram:NetPriceProductTradePrice>',
            '      </ram:SpecifiedLineTradeAgreement>',
            '      <ram:SpecifiedLineTradeDelivery>',
            '        <ram:BilledQuantity unitCode="H87">2</ram:BilledQuantity>',
            '      </ram:SpecifiedLineTradeDelivery>',
            '      <ram:SpecifiedLineTradeSettlement>',
            '        <ram:ApplicableTradeTax>',
            '          <ram:TypeCode>VAT</ram:TypeCode>',
            '          <ram:CategoryCode>S</ram:CategoryCode>',
            '          <ram:RateApplicablePercent>19</ram:RateApplicablePercent>',
            '        </ram:ApplicableTradeTax>',
            '        <ram:SpecifiedTradeSettlementLineMonetarySummation>',
            '          <ram:LineTotalAmount>20</ram:LineTotalAmount>',
            '        </ram:SpecifiedTradeSettlementLineMonetarySummation>',
            '      </ram:SpecifiedLineTradeSettlement>',
            '    </ram:IncludedSupplyChainTradeLineItem>',
            '    <ram:ApplicableHeaderTradeAgreement>',
            '      <ram:BuyerReference>999</ram:BuyerReference>',
            '      <ram:SellerTradeParty>',
            '        <ram:Name>Great Company LLC</ram:Name>',
            '        <ram:SpecifiedLegalOrganization>',
            '          <ram:ID>123/456</ram:ID>',
            '        </ram:SpecifiedLegalOrganization>',
            '        <ram:DefinedTradeContact>',
            '          <ram:PersonName>Jane Doe</ram:PersonName>',
            '          <ram:TelephoneUniversalCommunication>',
            '            <ram:CompleteNumber>+49 123</ram:CompleteNumber>',
            '          </ram:TelephoneUniversalCommunication>',
            '          <ram:EmailURIUniversalCommunication>',
            '            <ram:URIID>info@great.example</ram:URIID>',
            '          </ram:EmailURIUniversalCommunication>',
            '        </ram:DefinedTradeContact>',
            '        <ram:PostalTradeAddress>',
            '          <ram:PostcodeCode>12345</ram:PostcodeCode>',
            '          <ram:LineOne>Main Street 1</ram:LineOne>',
            '          <ram:CityName>Berlin</ram:CityName>',
            '          <ram:CountryID>DE</ram:CountryID>',
            '        </ram:PostalTradeAddress>',
            '        <ram:URIUniversalCommunication>',
            '          <ram:URIID schemeID="EM">info@great.example</ram:URIID>',
            '        </ram:URIUniversalCommunication>',
            '        <ram:SpecifiedTaxRegistration>',
            '          <ram:ID schemeID="VA">DE123</ram:ID>',
            '        </ram:SpecifiedTaxRegistration>',
            '        <ram:SpecifiedTaxRegistration>',
            '          <ram:ID schemeID="FC">123/456</ram:ID>',
            '        </ram:SpecifiedTaxRegistration>',
            '      </ram:SellerTradeParty>',
            '      <ram:BuyerTradeParty>',
            '        <ram:Name>Example Company LLC</ram:Name>',
            '        <ram:PostalTradeAddress>',
            '          <ram:PostcodeCode>54321</ram:PostcodeCode>',
            '          <ram:LineOne>Side Street 2</ram:LineOne>',
            '          <ram:CityName>Hamburg</ram:CityName>',
            '          <ram:CountryID>DE</ram:CountryID>',
            '        </ram:PostalTradeAddress>',
            '        <ram:URIUniversalCommunication>',
            '          <ram:URIID schemeID="EM">buyer@example.com</ram:URIID>',
            '        </ram:URIUniversalCommunication>',
            '      </ram:BuyerTradeParty>',
            '    </ram:ApplicableHeaderTradeAgreement>',
            '    <ram:ApplicableHeaderTradeDelivery>',
            '      <ram:ActualDeliverySupplyChainEvent>',
            '        <ram:OccurrenceDateTime>',
            '          <udt:DateTimeString format="102">20240102</udt:DateTimeString>',
            '        </ram:OccurrenceDateTime>',
            '      </ram:ActualDeliverySupplyChainEvent>',
            '    </ram:ApplicableHeaderTradeDelivery>',
            '    <ram:ApplicableHeaderTradeSettlement>',
            '      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>',
            '      <ram:SpecifiedTradeSettlementPaymentMeans>',
            '        <ram:TypeCode>58</ram:TypeCode>',
            '        <ram:PayeePartyCreditorFinancialAccount>',
            '          <ram:IBANID>DE75512108001245126199</ram:IBANID>',
            '        </ram:PayeePartyCreditorFinancialAccount>',
            '        <ram:PayeeSpecifiedCreditorFinancialInstitution>',
            '          <ram:BICID>ABCD5F</ram:BICID>',
            '        </ram:PayeeSpecifiedCreditorFinancialInstitution>',
            '      </ram:SpecifiedTradeSettlementPaymentMeans>',
            '      <ram:ApplicableTradeTax>',
            '        <ram:CalculatedAmount>3.8</ram:CalculatedAmount>',
            '        <ram:TypeCode>VAT</ram:TypeCode>',
            '        <ram:BasisAmount>20</ram:BasisAmount>',
            '        <ram:CategoryCode>S</ram:CategoryCode>',
            '        <ram:RateApplicablePercent>19</ram:RateApplicablePercent>',
            '      </ram:ApplicableTradeTax>',
            '      <ram:SpecifiedTradePaymentTerms>',
            '        <ram:DueDateDateTime>',
            '          <udt:DateTimeString format="102">20240115</udt:DateTimeString>',
            '        </ram:DueDateDateTime>',
            '      </ram:SpecifiedTradePaymentTerms>',
            '      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>',
            '        <ram:LineTotalAmount>20</ram:LineTotalAmount>',
            '        <ram:TaxBasisTotalAmount>20</ram:TaxBasisTotalAmount>',
            '        <ram:TaxTotalAmount currencyID="EUR">3.8</ram:TaxTotalAmount>',
            '        <ram:GrandTotalAmount>23.8</ram:GrandTotalAmount>',
            '        <ram:DuePayableAmount>23.8</ram:DuePayableAmount>',
            '      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>',
            '    </ram:ApplicableHeaderTradeSettlement>',
            '  </rsm:SupplyChainTradeTransaction>',
            '</rsm:CrossIndustryInvoice>'
        ].join('\n'));
    });
});