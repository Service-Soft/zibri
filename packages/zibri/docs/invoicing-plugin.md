# Issuing invoices
`ZibriInvoicingPlugin` generates invoices, with invoice numbering, tax calculation and PDF rendering, conforming to EN 16931, XRechnung and Peppol.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ZibriInvoicingPlugin` | class | The plugin for invoice numbering, tax calculation and PDF rendering |
| `ZIBRI_INVOICING_PLUGIN_DI_TOKENS` | DI token | The tokens of the plugin, see [configuring the plugin](#configuring-the-plugin) |
| `CompanyInfoServiceInterface`, `CompanyInfo` | interface, type | What the service under `COMPANY_INFO_SERVICE` answers: the company a tenant issues its invoices as |
| `Invoice`, `NumberInvoices`, `InvoiceRecipientAbbreviation` | entity | An invoice, how many invoices a recipient got in a year, and the name abbreviation a recipient's invoice numbers carry. Stored by `ZibriInvoicingPlugin` |

## Setting it up
Add `new ZibriInvoicingPlugin()` to the `plugins` of your application, see [registering a plugin](./plugin.md#registering-a-plugin), and `Invoice`, `NumberInvoices` and `InvoiceRecipientAbbreviation` to the `entities` of your data source.

Each [tenant](./tenancy.md) issues its own invoices: an invoice belongs to the tenant it is created in, and each tenant numbers its invoices on its own. Tell the plugin which company a tenant issues them as, with its address, tax number, bank details and logo, through a service under `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.COMPANY_INFO_SERVICE`. The service is required:

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
The amounts of an invoice are calculated the way EN 16931 calculates them, in its pdf and its electronic invoice alike. Each item's total is rounded to the minor units of the invoice's currency, which `getCurrencyMinorUnits` of the [localize service](./localization.md#formatting) gives, half away from zero. The tax of each tax group is the group's total times its rate, rounded once, and the tax of the invoice is the sum of its groups. An invoice totalling less than 0 before tax is refused, since it is a credit note, and so is an electronic invoice in a currency with more than two minor units, which EN 16931 cannot state. A credit within an invoice is an item with a negative price.

## Sending electronic invoices
An electronic invoice names the company and the customer by the address each receives electronic invoices at, `electronicAddress` of `CompanyInfo` and of `InvoiceAddress`: a `scheme` from the Electronic Address Scheme code list, such as `0204` for a Leitweg-ID or `9930` for a German VAT id, and its `value`. An XRechnung names a party without one by its email. A Peppol invoice requires both, and refuses an item whose total, rounded to its currency, is more than 0.02 from its amount times its price, as with a fractional price in a currency without minor units.

## Numbering invoices
An invoice number is the year, the recipient's name abbreviation and the count of the recipient's invoices that year, such as `2026-SIEMEN-0001`. Each abbreviation belongs to one recipient, and is kept in `InvoiceRecipientAbbreviation`. A recipient's first invoice claims the abbreviation `getSuggestedNameAbbreviation` suggests, the first letters of a company name or of first and last name. When another recipient holds it, `generateInvoiceNumber` answers `409`: pass the recipient another one as `nameAbbreviation`, once, and their invoices are numbered with it from then on.

## Configuring the plugin
The tokens of `ZIBRI_INVOICING_PLUGIN_DI_TOKENS`. The plugin checks at startup that the required ones are provided.

| Token | Type | What it is |
|---|---|---|
| [`COMPANY_INFO_SERVICE`](#setting-it-up) | `CompanyInfoServiceInterface` | The company each tenant issues its invoices as. Required |
| [`OPTIONS_INPUT`](#setting-it-up) | `InvoicingOptionsInput` | The labels, font sizes and numbering format. English labels and four digit numbers by default |
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

## See also
- [Plugins](./plugin.md) — registering a plugin, and writing your own
- [Document generation](./document.md) — building PDF documents of your own
- [Tenancy](./tenancy.md) — the tenant an invoice belongs to
