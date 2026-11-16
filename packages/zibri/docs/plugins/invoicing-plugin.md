---
keywords: [invoices, invoicing, billing, invoice pdf, bills]
---

# Issuing invoices
`ZibriInvoicingPlugin` generates invoices, with invoice numbering, tax calculation and PDF rendering, conforming to EN 16931, XRechnung and Peppol.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ZibriInvoicingPlugin` | class | The plugin for invoice numbering, tax calculation and PDF rendering |
| `ZIBRI_INVOICING_PLUGIN_DI_TOKENS` | DI token | The tokens of the plugin, see [configuring the plugin](#configuring-the-plugin) |
| `CompanyInfoServiceInterface`, `CompanyInfo` | interface, type | What the service under `COMPANY_INFO_SERVICE` answers: the company a [tenant](../glossary.md#tenant) issues its invoices as |
| `InvoicingOptionsInput`, `InvoicingOptions` | type, type | The labels, font, font sizes, page size and numbering format of the invoices, via `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT`. Defaults to English labels, Roboto, A4 and four digit numbers |
| `InvoiceNumberServiceInterface`, `InvoiceNumberService` | interface, class | Gives each invoice a unique, consecutive number. Replaceable through `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_NUMBER_SERVICE` |
| `InvoiceCalcServiceInterface`, `InvoiceCalcService` | interface, class | Calculates the amounts of an invoice. Replaceable through `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CALC_SERVICE` |
| `InvoicePdfServiceInterface`, `InvoicePdfService` | interface, class | Renders the pdf of an invoice. Replaceable through `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_PDF_SERVICE` |
| `InvoiceConformanceServiceInterface`, `InvoiceConformance` | interface, type | Writes an invoice pdf as an electronic invoice of one standard, named such as `'x-rechnung'`, `'peppol'` or a name of your own. Replaceable through `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CONFORMANCE_SERVICES` |
| `XRechnungConformanceService`, `PeppolConformanceService` | class, class | Write XRechnung and Peppol invoices. Registered for you |
| `EN16931ConformanceService`, `EN16931DocumentContextId` | class, type | Base class for a standard built on EN 16931, and the document context ids it states |
| `Invoice`, `NumberInvoices`, `InvoiceRecipientAbbreviation` | entity | An invoice, how many invoices a recipient got in a year, and the name abbreviation a recipient's invoice numbers carry. Stored by `ZibriInvoicingPlugin` |
| `InvoiceAddress`, `ElectronicAddress` | class, class | The address an invoice goes to, of a private customer or a company, and the address a party receives electronic invoices at, such as its Peppol participant id |
| `InvoiceItem`, `AmountUnit` | class, class | An item of an invoice, and the unit of its amount, with a display name such as "Hours" and a code such as `HUR` |
| `Vat`, `VatCategoryCode` | class, type | The tax of an item: its rate in percent and its category code, such as `S` for the standard rate or `AE` for reverse charge |

## Setting it up
Add `new ZibriInvoicingPlugin()` to the `plugins` of your application, see [registering a plugin](../application/plugin.md#registering-a-plugin), and `Invoice`, `NumberInvoices` and `InvoiceRecipientAbbreviation` to the `entities` of your data source.

Each [tenant](../data/tenancy.md) issues its own invoices: an invoice belongs to the tenant it is created in, and each tenant numbers its invoices on its own. Tell the plugin which company a tenant issues them as, with its address, tax number, bank details and logo, through a service under `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.COMPANY_INFO_SERVICE`. The service is required:

```ts
// src/services/company-info.service.ts
import { CompanyInfo, CompanyInfoServiceInterface, inject, Repository, repositoryTokenFor } from 'zibri';

import { TenantSettings } from '../models/tenant-settings.model';

export class CompanyInfoService implements CompanyInfoServiceInterface {
    async resolveCompanyInfo(tenantId: string): Promise<CompanyInfo> {
        const settings: Repository<TenantSettings> = inject(repositoryTokenFor(TenantSettings));
        return (await settings.findOne({ where: { tenantId }, acrossTenants: true })).companyInfo;
    }
}
```

```ts
// src/providers.ts
import { defineProvider, ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from 'zibri';

import { CompanyInfoService } from './services/company-info.service';

defineProvider({ token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.COMPANY_INFO_SERVICE, useClass: CompanyInfoService });
```

The pdf and the electronic invoice of an invoice name the company of the invoice's own tenant. Labels, font sizes and the numbering format are the same for every tenant, and go into `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT`.

## Calculating the amounts
The amounts of an invoice are calculated the way EN 16931 calculates them, in its pdf and its electronic invoice alike. Each item's total is rounded to the minor units of the invoice's currency, which `getCurrencyMinorUnits` of the [localize service](../templates/localization.md#formatting) gives, half away from zero. The tax of each tax group is the group's total times its rate, rounded once, and the tax of the invoice is the sum of its groups. An invoice totalling less than 0 before tax is refused, since it is a credit note, and so is an electronic invoice in a currency with more than two minor units, which EN 16931 cannot state. A credit within an invoice is an item with a negative price.

## Choosing the page size
An invoice pdf is A4 by default. `pageSize` of the options sets it for every invoice, and the last argument of `generateInvoicePdf` for one, such as `'LETTER'` for a customer in the United States. It takes every size pdfmake knows, or a width and a height in points:

```ts
// src/services/invoice-delivery.service.ts
import { inject, Invoice, InvoicePdfServiceInterface, PdfDocument, ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from 'zibri';

export async function renderLetterInvoice(invoice: Invoice): Promise<PdfDocument> {
    const pdfService: InvoicePdfServiceInterface<Invoice> = inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_PDF_SERVICE);
    return await pdfService.generateInvoicePdf(invoice, 'en-US', 'America/New_York', undefined, 'LETTER');
}
```

## Choosing the font
An invoice pdf is set in Roboto. `font` of the options sets it in a family registered with `ZIBRI_DI_TOKENS.PDF_FONT_OPTIONS`, and a customer's name in a script the font cannot draw is set in its fallbacks, see [setting the fonts](../templates/document.md#setting-the-fonts).

## Sending electronic invoices
An electronic invoice names the company and the customer by the address each receives electronic invoices at, `electronicAddress` of `CompanyInfo` and of `InvoiceAddress`: a `scheme` from the Electronic Address Scheme code list, such as `0204` for a Leitweg-ID or `9930` for a German VAT id, and its `value`. An XRechnung names a party without one by its email. A Peppol invoice requires both, and refuses an item whose total, rounded to its currency, is more than 0.02 from its amount times its price, as with a fractional price in a currency without minor units.

## Numbering invoices
An invoice number is the year, the recipient's name abbreviation and the count of the recipient's invoices that year, such as `2026-SIEMEN-0001`. The year is the calendar year in the `timezone` of the company issuing the invoice, so an invoice issued at 00:30 on New Year's Day in Berlin starts the new year for a company in `Europe/Berlin`. Each abbreviation belongs to one recipient, and is kept in `InvoiceRecipientAbbreviation`. A recipient's first invoice claims the abbreviation `getSuggestedNameAbbreviation` suggests, the first letters of a company name or of first and last name. When another recipient holds it, `generateInvoiceNumber` answers `409`: pass the recipient another one as `nameAbbreviation`, once, and their invoices are numbered with it from then on.

## Configuring the plugin
The tokens of `ZIBRI_INVOICING_PLUGIN_DI_TOKENS`. The plugin checks at startup that the required ones are provided.

| Token | Type | What it is |
|---|---|---|
| [`COMPANY_INFO_SERVICE`](#setting-it-up) | `CompanyInfoServiceInterface` | The company each tenant issues its invoices as. Required |
| [`OPTIONS_INPUT`](#setting-it-up) | `InvoicingOptionsInput` | The labels, [font](#choosing-the-font), font sizes, [page size](#choosing-the-page-size) and numbering format. English labels, Roboto, A4 and four digit numbers by default |
| `OPTIONS` | `InvoicingOptions` | `OPTIONS_INPUT` merged over the defaults. Read, not provided |
| `INVOICE_NUMBER_SERVICE` | `InvoiceNumberServiceInterface` | Numbers the invoices. `InvoiceNumberService` by default |
| `INVOICE_CALC_SERVICE` | `InvoiceCalcServiceInterface` | Calculates the amounts of an invoice. `InvoiceCalcService` by default |
| `INVOICE_PDF_SERVICE` | `InvoicePdfServiceInterface` | Renders the pdf of an invoice. `InvoicePdfService` by default |
| `INVOICE_CONFORMANCE_SERVICES` | `InvoiceConformanceServiceInterface[]` | Write the electronic invoices. XRechnung and Peppol by default |

## Requirements
Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `Invoice`, `NumberInvoices`, `InvoiceRecipientAbbreviation` | The plugin is registered |

How large each table grows, and what deletes its rows, is in [framework tables](../data/framework-tables.md).

## See also
- [Plugins](../application/plugin.md) — registering a plugin, and writing your own
- [Document generation](../templates/document.md) — building PDF documents of your own
- [Tenancy](../data/tenancy.md) — the tenant an invoice belongs to
