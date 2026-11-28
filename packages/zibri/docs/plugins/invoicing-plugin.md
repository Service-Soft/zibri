---
keywords: [invoices, invoicing, billing, invoice pdf, bills, credit note, cancellation, stornorechnung, invoice number format, gobd, archive, retention, § 147 ao, zugferd, e-invoice]
---

# Issuing invoices
`ZibriInvoicingPlugin` generates invoices, with invoice numbering, tax calculation and PDF rendering, conforming to EN 16931, XRechnung and Peppol. An issued invoice is corrected by a credit note: a document that references the invoice and credits all of it or a part. What of an invoice is paid comes from a payment source, such as the bank plugin.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ZibriInvoicingPlugin` | class | The plugin for invoice numbering, tax calculation and PDF rendering |
| `InvoicingController` | class | The routes of the invoices and their documents, below the path of your controller extending it, see [reading invoices through the routes](#reading-invoices-through-the-routes) |
| `ZIBRI_INVOICING_PLUGIN_DI_TOKENS` | DI token | The tokens of the plugin, see [configuring the plugin](#configuring-the-plugin) |
| `CompanyInfoServiceInterface`, `CompanyInfo` | interface, type | What the service under `COMPANY_INFO_SERVICE` answers: the company a [tenant](../glossary.md#tenant) issues its invoices as |
| `InvoicingOptionsInput`, `InvoicingOptions` | type, type | The labels, font, font sizes, page size and numbering format of the invoices, via `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT`. Defaults to English labels, Roboto, A4 and four digit numbers |
| `InvoiceNumberServiceInterface`, `InvoiceNumberService` | interface, class | Gives each invoice and credit note a unique, consecutive number. Replaceable through `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_NUMBER_SERVICE` |
| `NumberingContext` | type | The company issuing an invoice and the moment it is numbered at, which `resolveNumberingContext` of a class extending `InvoiceNumberService` answers |
| `InvoiceCancellationServiceInterface`, `InvoiceCancellationService` | interface, class | Cancels an invoice, or credits a part of it, with a credit note. Replaceable through `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CANCELLATION_SERVICE` |
| `InvoiceCalcServiceInterface`, `InvoiceCalcService` | interface, class | Calculates the amounts of an invoice. Replaceable through `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CALC_SERVICE` |
| `InvoiceServiceInterface`, `InvoiceService`, `InvoiceFilter` | interface, class, type | Finds a page of the invoices with `findInvoices`, by a `search`, whether they are `issued`, their `type` and whether they are `open`. Replaceable through `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_SERVICE` |
| `InvoicePaymentServiceInterface`, `InvoicePaymentService` | interface, class | Resolves what of an invoice is paid and what is open, see [reading what of an invoice is paid](#reading-what-of-an-invoice-is-paid). Replaceable through `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_PAYMENT_SERVICE` |
| `InvoicePaymentState`, `InvoicePaymentStatus` | type, enum | What `resolvePaymentState` answers: the `total`, what is `credited`, `paid` and `open`, and the `status`, `OPEN`, `PARTLY_PAID`, `PAID` or `CREDITED` |
| `InvoicePaymentSourceInterface`, `INVOICE_PAYMENT_SOURCE_DI_VARIANT` | interface, constant | Something that knows what was paid of invoices, such as the bank plugin, and the variant its provider is registered with |
| `InvoicePostingInterface`, `INVOICE_POSTING_DI_VARIANT` | interface, constant | Something that books the invoices a write issues, such as the bookkeeping plugin, and the variant its provider is registered with, see [booking issued invoices](#booking-issued-invoices) |
| `InvoicePdfServiceInterface`, `InvoicePdfService` | interface, class | Renders the pdf of an invoice. Replaceable through `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_PDF_SERVICE` |
| `InvoiceDocumentServiceInterface`, `InvoiceDocumentService` | interface, class | Archives the documents of each invoice as it is issued, and answers the archived documents of an issued invoice and rendered ones of a draft, see [archiving issued invoices](#archiving-issued-invoices). Replaceable through `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_DOCUMENT_SERVICE` |
| `InvoiceDocument`, `InvoiceDocumentCreateData` | entity, type | The pdf and the electronic invoice of an issued invoice or credit note, archived at its issue. And what creates one. Archived by `ZibriInvoicingPlugin` with `archive` |
| `InvoiceArchiveOptions`, `InvoiceArchiveOptionsInput` | type, type | The `store`, `locale`, `resolveConformance` and `retention` of `archive` of the options, and what `archive` takes |
| `InvoiceConformanceServiceInterface`, `InvoiceConformance` | interface, type | Writes an invoice pdf as an electronic invoice of one standard, named such as `'x-rechnung'`, `'peppol'` or a name of your own. Replaceable through `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CONFORMANCE_SERVICES` |
| `XRechnungConformanceService`, `PeppolConformanceService` | class, class | Write XRechnung and Peppol invoices. Registered for you |
| `EN16931ConformanceService`, `EN16931DocumentContextId` | class, type | Base class for a standard built on EN 16931, and the document context ids it states |
| `Invoice`, `NumberInvoices`, `InvoiceRecipientAbbreviation` | entity | An invoice or credit note, how many numbers a tenant drew in a number scope, and the name abbreviation a recipient's invoice numbers carry. Stored by `ZibriInvoicingPlugin` |
| `InvoiceType`, `InvoiceReference` | enum, class | Whether an invoice is an invoice or a credit note, and the number and date of an invoice another one references |
| `CreditNoteData` | type | What a credit note states besides its items: its date, due date, performance date and texts |
| `InvoiceNumberFormatUtilities`, `InvoiceNumberToken` | class, type | Checks and renders a number format, and the tokens one can name, such as `{year}` and `{counter}` |
| `InvoiceAddress`, `ElectronicAddress` | class, class | The address an invoice goes to, of a private customer or a company, and the address a party receives electronic invoices at, such as its Peppol participant id |
| `InvoiceItem`, `AmountUnit` | class, class | An item of an invoice, and the unit of its amount, with a display name such as "Hours" and a code such as `HUR` |
| `Vat`, `VatCategoryCode` | class, type | The tax of an item: its rate in percent and its category code, such as `S` for the standard rate or `AE` for reverse charge |
| `ZIBRI_INVOICING_PERMISSIONS`, `ZibriInvoicingPermissions` | constant, constant | The tenant permission of the routes, to spread into yours, and the same by name |
| `ZIBRI_INVOICING_PLATFORM_PERMISSIONS`, `ZibriInvoicingPlatformPermissions` | constant, constant | The platform permission of the routes, for the invoices of every tenant, and the same by name |

`zibri-contract` has the models of the routes for your frontend: `InvoiceModel` with `InvoiceItemModel`, `InvoiceAddressModel`, `ElectronicAddressModel`, `AmountUnitModel`, `VatModel` and `InvoiceReferenceModel`, `InvoiceQueryModel` for the query of `GET /invoices`, `InvoiceType` and the permissions.

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

The pdf and the electronic invoice of an invoice name the company of the invoice's own tenant. Labels, font sizes and the numbering format are the same for every tenant, and go into `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT`. A tenant can number in a format of its own, see [numbering per tenant](#numbering-per-tenant).

## Calculating the amounts
The amounts of an invoice are calculated the way EN 16931 calculates them, in its pdf and its electronic invoice alike. Each item's total is rounded to the minor units of the invoice's currency, which `getCurrencyMinorUnits` of the [localize service](../templates/localization.md#formatting) gives, half away from zero. The tax of each tax group is the group's total times its rate, rounded once, and the tax of the invoice is the sum of its groups. An invoice totalling less than 0 before tax is refused: a credit is stated by a [credit note](#cancelling-an-invoice). So is an electronic invoice in a currency with more than two minor units, which EN 16931 cannot state. A credit within an invoice is an item with a negative price.

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

## Showing the logo
The `logo` of `CompanyInfo` is shown in the header of an invoice pdf: a data URL, or the name of an image in `images` of the options. `generateInvoicePdf` works with pdfmake 0.2 and 0.3. With 0.3, an image given by its path or its URL is read only when `ZIBRI_DI_TOKENS.PDF_ACCESS_OPTIONS` allows it, see [reading files and URLs](../templates/document.md#reading-files-and-urls).

## Sending electronic invoices
An electronic invoice names the company and the customer by the address each receives electronic invoices at, `electronicAddress` of `CompanyInfo` and of `InvoiceAddress`: a `scheme` from the Electronic Address Scheme code list, such as `0204` for a Leitweg-ID or `9930` for a German VAT id, and its `value`. An XRechnung names a party without one by its email. A Peppol invoice requires both, and refuses an item whose total, rounded to its currency, is more than 0.02 from its amount times its price, as with a fractional price in a currency without minor units.

An invoice states type code 380, a credit note type code 381. The invoice a credit note corrects, in `precedingInvoices`, is stated as its preceding invoice reference. An electronic invoice states one, and refuses an invoice referencing more.

## Numbering invoices
An invoice number is the year, the recipient's name abbreviation and the count of the recipient's invoices that year by default, such as `2026-SIEMEN-0001`. `numberFormat` of the options sets another format, of these tokens and any text between them:

| Token | What it is |
|---|---|
| `{year}` | The year, such as `2026` |
| `{yy}` | The year in two digits, such as `26` |
| `{month}` | The month in two digits, such as `03` |
| `{recipient}` | The name abbreviation of the recipient, such as `SIEMEN` |
| `{counter}` | The count, padded to `numberOfDigits`. Required |

The counter counts on its own for every distinct value of the rest of the format. `{year}-{counter}` counts the invoices of all recipients in a year, `2026-0001` and `2026-0002`, and starts again at `2027-0001`. `INV-{counter}` counts on for good. The year and the month are those of the `timezone` of the company issuing the invoice, so an invoice issued at 00:30 on New Year's Day in Berlin starts the new year for a company in `Europe/Berlin`.

```ts
// src/providers.ts
import { defineProvider, InvoicingOptionsInput, ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from 'zibri';

const invoicingOptions: InvoicingOptionsInput = {
    numberFormat: 'INV-{year}-{counter}',
    creditNoteNumberFormat: 'CN-{year}-{counter}',
    creditNoteNumberOfDigits: 4
};

defineProvider({ token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, useValue: invoicingOptions });
```

| Option | What it is |
|---|---|
| `numberFormat` | The format of invoice numbers. `{year}-{recipient}-{counter}` by default, with `separator` between the parts |
| `creditNoteNumberFormat` | The format of credit note numbers: `{invoice}`, the number of the invoice corrected, `{year}`, `{yy}`, `{month}` and `{counter}`. `{invoice}-C{counter}` by default |
| `numberOfDigits` | The digits the counter of an invoice number is padded to. 4 by default |
| `creditNoteNumberOfDigits` | The digits the counter of a credit note number is padded to. 1 by default |
| `separator` | What separates `TEMP` from a temporary number, and the parts of the default `numberFormat`. `-` by default |

The application refuses to start with a format without `{counter}`, or with a token it does not know, and names the format. A format can change at any time, also within a year: a number drawn in it is unique, and a format rendering the same scope as before goes on with its count.

Each name abbreviation belongs to one recipient, and is kept in `InvoiceRecipientAbbreviation`. A recipient's first invoice numbered in a format with `{recipient}` claims the abbreviation `getSuggestedNameAbbreviation` suggests, the first letters of a company name or of first and last name. When another recipient holds it, `generateInvoiceNumber` answers `409`: pass the recipient another one as `nameAbbreviation`, once, and their invoices are numbered with it from then on.

`generateTemporaryInvoiceNumber` answers the number an invoice would get, with `TEMP-` before it, and draws none: for a draft that may never be sent.

## Numbering per tenant
`numberFormat` and `creditNoteNumberFormat` of the `CompanyInfo` of a tenant set the formats of that tenant, in place of the options. A format of a tenant is checked when a number is drawn in it. `InvoiceNumberFormatUtilities.validateInvoiceFormat` and `validateCreditNoteFormat` check one before you store it:

```ts
// src/services/numbering-settings.service.ts
import { CompanyInfo, InvoiceNumberFormatUtilities } from 'zibri';

export function withNumberFormat(company: CompanyInfo, numberFormat: string): CompanyInfo {
    InvoiceNumberFormatUtilities.validateInvoiceFormat(numberFormat, 'number format of the team');
    return { ...company, numberFormat };
}
```

## Cancelling an invoice
An issued invoice is not changed, it is corrected: a credit note credits all of it or a part, and a new invoice states what is right. `cancelInvoice` of the service under `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CANCELLATION_SERVICE` creates a credit note of every item of an invoice, and `createCreditNote` one of the items you pass:

```ts
// src/services/invoice-correction.service.ts
import { inject, Invoice, InvoiceCancellationServiceInterface, InvoiceItem, ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from 'zibri';

export async function cancelInvoice(invoiceId: string): Promise<Invoice> {
    const cancellations: InvoiceCancellationServiceInterface<Invoice> = inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CANCELLATION_SERVICE);
    return await cancellations.cancelInvoice(invoiceId);
}

export async function creditHours(invoiceId: string, hours: number): Promise<Invoice> {
    const cancellations: InvoiceCancellationServiceInterface<Invoice> = inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_CANCELLATION_SERVICE);
    const items: InvoiceItem[] = [{
        name: 'Consulting',
        amount: hours,
        amountUnit: { displayName: 'Hours', code: 'HUR' },
        vat: { categoryCode: 'S', rate: 19 },
        price: 90
    }];
    return await cancellations.createCreditNote(invoiceId, items, { textBeforeItems: ['We credit the hours not worked.'] });
}
```

A credit note is an `Invoice` of `type` `CREDIT_NOTE`, issued when it is created. It states positive amounts, and references the number and date of the invoice in `precedingInvoices`. Its number is the one of the invoice with a counter of its own by default, `2026-SIEMEN-0001-C1` and `2026-SIEMEN-0001-C2`. The customer, the currency and the performance date are those of the invoice. The last argument takes a transaction, which the number of the credit note rolls back with.

A credit note credits at most what of each VAT category and rate of the invoice is not yet credited, before tax. One crediting more, a second cancellation among them, is refused with a `409`, and so is crediting a credit note, or a draft: an invoice without an `issuedAt`, whatever its number.

An invoice a credit note references cannot be changed or deleted, through any write of a repository: the write is refused with a `409` by a [write observer](../data/write-observers.md) of `Invoice`. Deleting its [tenant](../data/tenancy.md#deleting-a-tenant) deletes it.

The pdf of a credit note has the `creditNoteHeadline` of the options as its headline, `Credit note` by default, its number labeled with the `creditNoteNumberLabel`, `Credit note no.` by default, and the reference below it, with the `precedingInvoiceLabel`.

> [!NOTE]
> "Gutschrift" is a self-billed invoice in German law (§ 14 Abs. 2 UStG). A German application titles a credit note "Stornorechnung" or "Rechnungskorrektur", with `creditNoteHeadline`, and labels its number accordingly, such as "Stornorechnungs-Nr.", with `creditNoteNumberLabel`.

## Keeping issued invoices unchanged
With `issuedInvoicesReadOnly` of the options, an invoice whose `issuedAt` is set cannot be changed or deleted. Every write of a repository to it is refused with a `409`, and a credit note corrects it instead. A credit note is issued when it is created. Draft an invoice under a temporary number, and set its final number and `issuedAt` when you send it:

```ts
// src/services/invoice-issuing.service.ts
import { inject, Invoice, InvoiceAddress, InvoiceNumberServiceInterface, Repository, repositoryTokenFor, ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from 'zibri';

export async function issueInvoice(draft: Invoice, recipientId: string): Promise<Invoice> {
    const numbers: InvoiceNumberServiceInterface<InvoiceAddress> = inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_NUMBER_SERVICE);
    const invoices: Repository<Invoice> = inject(repositoryTokenFor(Invoice));
    const number: string = await numbers.generateInvoiceNumber(recipientId, draft.customerAddressData, undefined);
    return await invoices.updateById(draft.id, { number, issuedAt: new Date() });
}
```

`issuedInvoicesReadOnly` is `false` by default, and `true` from zibri 4. An invoice without `issuedAt` stays writable. Deleting the tenant of an issued invoice deletes it.

A final number issues an invoice. A write of a repository leaving an invoice or a credit note with a number that does not start with `TEMP` and the `separator`, and without an `issuedAt`, gives it its `date` as its `issuedAt`, and the invoice is issued by that write like by one naming an `issuedAt`: posted, archived and, with `issuedInvoicesReadOnly`, read only from then on. Creating an invoice with its final number, and giving a draft its final number, both issue it. A write that cannot give an invoice its own `date` is refused with a `409` when it would leave one with a final number and no `issuedAt`: one to every invoice a filter matches, when it matches more than one, an `updateEach` of several invoices that names them by no `id`, and an `upsert` that updates a stored invoice. Name the `issuedAt` in such a write, or write the invoice by its id.

An invoice stored by zibri 3.2 has a final number and no `issuedAt`. On every start, each such invoice of every tenant is given its `date` as its `issuedAt`, without being posted into the books or archived, and without `issuedInvoicesReadOnly` refusing the write: it was issued already.

## Archiving issued invoices
GoBD and § 147 AO want the invoices a company sends kept as they were sent. With `archive` of the options, the pdf of each invoice and credit note is rendered once as it is issued, and kept as an `InvoiceDocument` in the [archive](../data/archive.md), with the xml of its electronic invoice where it has one. Name the [file store](../data/files.md#registering-a-file-store) the documents are kept in, the locale their pdfs are rendered in, and the electronic invoice of each invoice:

```ts
// src/invoice-archive.provider.ts
import { defineProvider, DiProvider, InvoicingOptionsInput, ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from 'zibri';

export const invoiceArchive: DiProvider<InvoicingOptionsInput> = defineProvider({
    token: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
    useValue: {
        archive: {
            store: 'invoices',
            locale: 'de',
            resolveConformance: invoice => invoice.customerAddressData.electronicAddress == undefined ? undefined : 'x-rechnung'
        }
    }
});
```

| Option | What it is |
|---|---|
| `store` | The name of the file store the documents are kept in. Required |
| `locale` | The locale the pdf of an issued invoice is rendered in. Required |
| `resolveConformance` | The electronic invoice an invoice is archived as, such as `'x-rechnung'`, or undefined for a pdf alone. Required |
| `retention` | How long each document is kept, in whole `years`, `months` and `days`, counted from the end of the calendar year the invoice was issued in. 8 years by default |

Declare `InvoiceDocument` in the data source of `Invoice`, beside what an [archived entity](../data/archive.md#archiving-a-type-of-document) needs. An application with `archive` and without `InvoiceDocument`, or with `InvoiceDocument` and without `archive`, or naming a store that is not registered, does not start. Without `archive`, nothing is archived.

The pdf is rendered with the pdf service, in the time zone of the `CompanyInfo` of the invoice's tenant, and carries the electronic invoice `resolveConformance` names. Its xml is archived beside it when its conformance service writes one with `generateXml`, as those of EN 16931 do. Both are rendered in the transaction of the write that issues the invoice, before it is written, like [booking issued invoices](#booking-issued-invoices): an invoice whose documents cannot be rendered is not issued, and refused with what rendering failed with, such as an XRechnung without the customer's email. A write that is rolled back keeps no `InvoiceDocument` and no `FileRecord`. The bytes reach the store before the rows, and those of a transaction rolled back are deleted by `FileCleanupCronJob` a day later, see [storing a file in a transaction](../data/files.md#storing-a-file-in-a-transaction).

`resolvePdf` and `resolveElectronicInvoice` of the service under `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_DOCUMENT_SERVICE` answer the documents of an invoice: of an issued one those archived at its issue, the same bytes every time whatever the company, the options or the arguments say since, and of a draft those rendered with the arguments:

```ts
// src/services/invoice-document.function.ts
import { Readable } from 'node:stream';

import { inject, Invoice, ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from 'zibri';

export async function resolveInvoicePdf(invoice: Invoice): Promise<Readable> {
    return await inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_DOCUMENT_SERVICE)
        .resolvePdf(invoice, 'de', 'Europe/Berlin', 'x-rechnung', undefined);
}
```

`generateInvoicePdf` of the pdf service renders an invoice whatever its state. An invoice issued before `archive` was set has no archived documents, and is rendered. `findDocument` finds the `InvoiceDocument` of an invoice. The archive keeps each document unchanged for its retention, checks it on every read and prunes it after, see [archiving documents](../data/archive.md).

An invoice is archived once: one that already has an `InvoiceDocument`, such as one a [restore of the tenant](../data/backup.md#rows-a-tenant-restore-keeps) brought back as a draft and that is issued again, keeps the documents it was sent with. `resolveKeptRowDivergences` of the document service answers the documents whose invoice is gone or a draft, which a restore of a tenant reports.

## Booking issued invoices
With the [bookkeeping plugin](./bookkeeping-plugin.md#posting-invoices-and-credit-notes), an invoice and a credit note are posted into the books of their tenant once they are issued: when one is created with an `issuedAt` or a final number, or a draft gets either, through any write of a repository, see [keeping issued invoices unchanged](#keeping-issued-invoices-unchanged). The entry is posted before the invoice is written, in the transaction of the write, so an invoice whose transaction is rolled back posts nothing, and an invoice that cannot be posted is not issued. A write naming an `issuedAt` or a final number without a transaction runs in one of the data source of `Invoice`, started for it and committed once the invoice is written, so a write that fails, such as on a number taken meanwhile, posts nothing either. Other writes of an invoice run as they are called. The posting is a [write observer](../data/write-observers.md#writing-rows-along-with-a-write) of `Invoice` that requires a transaction.

A posting of your own implements `InvoicePostingInterface`, and is registered with a provider of the variant `INVOICE_POSTING_DI_VARIANT`, see [providing a value](../application/di.md#providing-a-value). It is handed the invoices a write issues, as they are once written, with the transaction of the write, and what it throws refuses the write. What it writes into the data source of `Invoice` is kept or rolled back with the invoice; a posting writing into another data source validates at startup that it writes into the one of `Invoice`, as the bookkeeping plugin does.

## Reading what of an invoice is paid
`resolvePaymentState` of the service under `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_PAYMENT_SERVICE` answers what of an invoice is paid and what is open, after tax:

```ts
// src/services/invoice-payment.function.ts
import { inject, Invoice, InvoicePaymentState, ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from 'zibri';

export async function resolveInvoicePaymentState(invoice: Invoice): Promise<InvoicePaymentState | undefined> {
    return await inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_PAYMENT_SERVICE).resolvePaymentState(invoice);
}
```

| Property | What it is |
|---|---|
| `total` | The total of the invoice after tax |
| `credited` | What the [credit notes](#cancelling-an-invoice) referencing it credit, after tax |
| `paid` | What the payment sources know as paid |
| `open` | The total less what is credited and what is paid. Below zero when more was paid than the credit notes leave, which is owed back |
| `status` | `OPEN` with nothing paid, `PARTLY_PAID` with a part paid and a part open, `PAID` with nothing open, and `CREDITED` when the credit notes credit all of it and nothing was paid |

What is paid comes from the payment sources, such as the matches of the [bank plugin](./bank-plugin.md#matching-transactions-with-invoices) with `matching` set. Without a source, nothing is known of payments, and `resolvePaymentState` answers undefined. `resolvePaymentStates` reads the states of many invoices at once, in their order.

A source of your own implements `InvoicePaymentSourceInterface`, and is registered with a provider of the variant `INVOICE_PAYMENT_SOURCE_DI_VARIANT`, see [providing a value](../application/di.md#providing-a-value). What every source answers is added up, and a source answering undefined tracks no payments.

## Reading invoices through the routes
`InvoicingController` has the routes a frontend lists the invoices and credit notes of a tenant with, and reads one and its documents by. Extend it with a `@Controller` of your own, at the path you choose, and add it to the `controllers` of your application:

```ts
// src/controllers/invoicing.controller.ts
import { Controller, InvoicingController } from 'zibri';

@Controller('/invoicing', { versions: 'all' })
export class AppInvoicingController extends InvoicingController {}
```

Spread `ZIBRI_INVOICING_PERMISSIONS` into your tenant permissions, and `ZIBRI_INVOICING_PLATFORM_PERMISSIONS` into your platform permissions where an operator reads the invoices of every tenant, see [declaring permissions](../auth/roles-and-permissions.md#declaring-permissions):

```ts
// src/models/permissions.ts
import {
    DefinedPermissions,
    definePermissions,
    DefinedPlatformPermissions,
    definePlatformPermissions,
    ZIBRI_INVOICING_PERMISSIONS,
    ZIBRI_INVOICING_PLATFORM_PERMISSIONS,
    ZIBRI_PERMISSIONS,
    ZIBRI_PLATFORM_PERMISSIONS
} from 'zibri';

const PERMISSIONS = [...ZIBRI_PERMISSIONS, ...ZIBRI_INVOICING_PERMISSIONS] as const;
const PLATFORM_PERMISSIONS = [...ZIBRI_PLATFORM_PERMISSIONS, ...ZIBRI_INVOICING_PLATFORM_PERMISSIONS] as const;

export const Permissions: DefinedPermissions<typeof PERMISSIONS> = definePermissions(PERMISSIONS);
export const PlatformPermissions: DefinedPlatformPermissions<typeof PLATFORM_PERMISSIONS> = definePlatformPermissions(PLATFORM_PERMISSIONS);
```

| Permission | Lets |
|---|---|
| `invoicing.invoices.read` | A member list the invoices of the tenant, and read each and its documents |
| `invoicing.invoices.read_all` | An operator do the same for every tenant, in a request naming no tenant, see [accepting a permission of either level](../auth/roles-and-permissions.md#accepting-a-permission-of-either-level). The list takes the `tenantId` of the invoices, and refuses a request naming neither with a `400` |

| Route | What it does | Permission |
|---|---|---|
| `GET /invoices` | A page of the invoices and credit notes, the latest day first, and the count of all matching. Takes `page`, `limit` up to 100, `search`, `issued`, `type`, `open` and `tenantId`, `InvoiceQueryModel` of `zibri-contract` | `invoicing.invoices.read` |
| `GET /invoices/:id` | An invoice | `invoicing.invoices.read` |
| `GET /invoices/:id/pdf` | The pdf of an invoice, `<number>.pdf` | `invoicing.invoices.read` |
| `GET /invoices/:id/electronic-invoice` | The xml of the electronic invoice of an invoice, `<number>.xml`: the one archived, or a preview in the `conformance` it takes, such as `x-rechnung`. A `404` for an invoice archived without one | `invoicing.invoices.read` |

| Parameter of `GET /invoices` | Narrows to |
|---|---|
| `search` | The invoices whose number, or the company name, first name or last name of whose customer, contains it, whatever its case. A `%` or `_` of it is the character it is |
| `issued` | The invoices with an `issuedAt`, `true`, or the drafts, `false` |
| `type` | `INVOICE` or `CREDIT_NOTE` |
| `open` | The invoices with something left to pay after their credit notes and payments, `true`, or with nothing, `false`, by [what of them is paid](#reading-what-of-an-invoice-is-paid). It leaves out the credit notes, which pay nothing, and is refused with a `400` without a payment source, such as the bank plugin with `matching` |

The pdf and the electronic invoice of an issued invoice are those [archived at its issue](#archiving-issued-invoices). Those of a draft, and of an invoice issued before `archive` was set, are rendered as the request asks for them, in the locale and as the electronic invoice of `archive` of the options, or in the locale of the request and as a pdf alone without it, in the time zone of the company of the invoice. The electronic invoice of such an invoice is a preview in the `conformance` the request names, or the one of `archive` of the options without it. A conformance that is not registered, or that writes no xml of its own, and none at all, are refused with a `400` naming those that do, such as `The conformance needs to be one of x-rechnung, peppol.` An archived invoice is answered as it was archived, whatever the `conformance`. `findInvoices` of the service under `ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_SERVICE` finds a page of the invoices from your own code. An `open` reads every invoice the other parameters match, so narrow it by `issued` or a `search`.

## Configuring the plugin
The tokens of `ZIBRI_INVOICING_PLUGIN_DI_TOKENS`. The plugin checks at startup that the required ones are provided.

| Token | Type | What it is |
|---|---|---|
| [`COMPANY_INFO_SERVICE`](#setting-it-up) | `CompanyInfoServiceInterface` | The company each tenant issues its invoices as. Required |
| [`OPTIONS_INPUT`](#setting-it-up) | `InvoicingOptionsInput` | The labels, [font](#choosing-the-font), font sizes, [page size](#choosing-the-page-size), [numbering format](#numbering-invoices), [whether issued invoices are read only](#keeping-issued-invoices-unchanged) and [how they are archived](#archiving-issued-invoices). English labels, Roboto, A4, four digit numbers and no archive by default |
| `OPTIONS` | `InvoicingOptions` | `OPTIONS_INPUT` merged over the defaults. Read, not provided |
| `INVOICE_NUMBER_SERVICE` | `InvoiceNumberServiceInterface` | Numbers the invoices and credit notes. `InvoiceNumberService` by default |
| [`INVOICE_CANCELLATION_SERVICE`](#cancelling-an-invoice) | `InvoiceCancellationServiceInterface` | Creates the credit notes. `InvoiceCancellationService` by default |
| `INVOICE_CALC_SERVICE` | `InvoiceCalcServiceInterface` | Calculates the amounts of an invoice. `InvoiceCalcService` by default |
| [`INVOICE_PAYMENT_SERVICE`](#reading-what-of-an-invoice-is-paid) | `InvoicePaymentServiceInterface` | Resolves what of an invoice is paid and open. `InvoicePaymentService` by default |
| `INVOICE_PDF_SERVICE` | `InvoicePdfServiceInterface` | Renders the pdf of an invoice. `InvoicePdfService` by default |
| `INVOICE_CONFORMANCE_SERVICES` | `InvoiceConformanceServiceInterface[]` | Write the electronic invoices. XRechnung and Peppol by default |
| [`INVOICE_DOCUMENT_SERVICE`](#archiving-issued-invoices) | `InvoiceDocumentServiceInterface` | Archives and answers the documents of the invoices. `InvoiceDocumentService` by default |
| [`INVOICE_SERVICE`](#reading-invoices-through-the-routes) | `InvoiceServiceInterface` | Finds a page of the invoices. `InvoiceService` by default |
| `KEPT_ROW_CHECK` | `KeptRowCheckInterface` | Answers the documents whose invoice is gone or a draft after a restore of a tenant. The `INVOICE_DOCUMENT_SERVICE` by default |
| `DOCUMENT_FILE_STORE` | `string` | The `store` of `archive` of the options, which `InvoiceDocument` reads. Read, not provided |

## Requirements
Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `Invoice`, `NumberInvoices`, `InvoiceRecipientAbbreviation` | The plugin is registered |
| `InvoiceDocument`, `FileRecord`, `ChainGap`, `ChainAnchor` | `archive` of the options is set, in the data source of `Invoice` |

How large each table grows, and what deletes its rows, is in [framework tables](../data/framework-tables.md).

## See also
- [Plugins](../application/plugin.md) — registering a plugin, and writing your own
- [Document generation](../templates/document.md) — building PDF documents of your own
- [Importing bank statements](./bank-plugin.md) — matching the payments received with the invoices they pay
- [Keeping the books](./bookkeeping-plugin.md) — posting the invoices and credit notes issued
- [Tenancy](../data/tenancy.md) — the tenant an invoice belongs to
- [Observing writes](../data/write-observers.md) — how issued and referenced invoices are kept unchanged, and posted
