---
keywords: [accounting, double entry, double-entry bookkeeping, ledger, journal, general ledger, chart of accounts, kontenrahmen, standardkontenrahmen, skr 03, skr03, skr 04, skr04, datev, fiscal year, year end closing, closing entries, opening balances, reversal, storno, gobd, buchhaltung, hgb, ug, gmbh, legal form, posting rules, automatic postings, expenses, receipts, beleg, eingangsrechnung, kleinunternehmer, payment difference, skonto, reports, balance sheet, income statement, profit and loss, trial balance, summen- und saldenliste, bilanz, guv, jahresabschluss, statement mapping, kleinstkapitalgesellschaft, micro corporation, size class, gesetzliche rücklage, legal reserve, pdf, tax audit, betriebsprüfung, außenprüfung, datenüberlassung, datenträgerüberlassung, z3, gdpdu, beschreibungsstandard, index.xml, idea, verfahrensdokumentation, procedure documentation, § 147 ao, export]
---

# Keeping the books
`ZibriBookkeepingPlugin` keeps the books of a [tenant](../glossary.md#tenant) by double-entry bookkeeping: every entry books the same amount on the debit side of one or more accounts and on the credit side of others. A tenant is one company keeping its own books, so a bookkeeping firm keeps those of each client in a tenant of its own. A posted entry is never changed. A wrong one is corrected by reversing it, and the journal of each tenant is a [hash chain](../glossary.md#hash-chain) that tells an entry changed past your application, archived for 10 years. Each fiscal year is closed into the next one, which opens with the balances it closed with. The invoices and credit notes of the [invoicing plugin](./invoicing-plugin.md), the expenses and the bank matches of the [bank plugin](./bank-plugin.md) are posted for you, by posting rules of each fiscal year. The reports answer what the books hold: the journal, the ledger of an account, the trial balance, the balance sheet and the income statement of a fiscal year in the forms of the German HGB, and the revenue of a year, as JSON and as pdfs. A fiscal year exports as the archive a German tax audit takes, with the documents behind it. Rules of a law beyond that, such as those of a legal form, are conformance services: those of a German corporation and of a UG are registered for you.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ZibriBookkeepingPlugin` | class | The plugin for keeping the books |
| `BookkeepingController` | class | The routes of the settings, accounts, fiscal years, posting rules, entries, expenses, reports and the export, below the path of your controller extending it |
| `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS` | DI token | The tokens of the plugin, see [choosing what a tenant without books does](#choosing-what-a-tenant-without-books-does), [the company model](#the-company-model), [posting a source your own way](#posting-a-source-your-own-way) and [holding the books to a law](#holding-the-books-to-a-law) |
| `BookkeepingPluginOptionsInput`, `BookkeepingPluginOptions` | type, type | `tenantsWithoutBooks` and its `resolveSettingsOf`, the `retention` of the journal, and the `receiptStore` and `receiptRetention` of the receipts, via `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS_INPUT`. Required |
| `TenantsWithoutBooks`, `TenantsWithoutBooksOptions`, `ResolveTenantBookkeepingSettings` | type, type, type | `'post-nothing'`, `'refuse'` or `'never'`: what a tenant without bookkeeping settings does, with the function `'never'` takes, see [choosing what a tenant without books does](#choosing-what-a-tenant-without-books-does) |
| `JournalServiceInterface`, `JournalService` | interface, class | Keeps the settings, posts and reverses entries, adds, changes and closes fiscal years, and checks the books. Replaceable through `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.JOURNAL_SERVICE` |
| `BookkeepingReportServiceInterface`, `BookkeepingReportService` | interface, class | Answers the journal, the ledger, the trial balance, the balance sheet, the income statement and the revenue, see [reading the reports](#reading-the-reports). Replaceable through `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.REPORT_SERVICE` |
| `BookkeepingReportPdfServiceInterface`, `BookkeepingReportPdfService` | interface, class | Renders each report as a pdf. Replaceable through `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.REPORT_PDF_SERVICE` |
| `PostingServiceInterface`, `PostingService` | interface, class | Posts an invoice, a credit note, an expense or a bank match with `postFor`, once each. Replaceable through `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_SERVICE` |
| `PostingRuleServiceInterface`, `PostingRuleService` | interface, class | Keeps the posting rules of each fiscal year, and turns a source into the entry its rules post. Replaceable through `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_RULE_SERVICE` |
| `ExpenseServiceInterface`, `ExpenseService` | interface, class | Finds, creates, changes, records and corrects expenses, and keeps their receipts. Replaceable through `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.EXPENSE_SERVICE` |
| `BookkeepingExportServiceInterface`, `BookkeepingExportService` | interface, class | Exports a fiscal year for a tax audit, see [exporting a fiscal year for a tax audit](#exporting-a-fiscal-year-for-a-tax-audit). Replaceable through `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.EXPORT_SERVICE` |
| `BookkeepingExporterInterface`, `GdpduBookkeepingExporter` | interface, class | Writes an export in one format, and the format of the description standard of the German tax administration. Replaceable through `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.EXPORTER` |
| `BookkeepingExportOptions`, `BookkeepingExportArchive`, `BookkeepingExportContent` | type, type, type | Whether an export holds the documents, the archive it answers, and what an exporter writes |
| `BookkeepingExportFile`, `BookkeepingExportTable`, `BookkeepingExportDocument` | type, type, type | A file of an export: a table with its columns and rows, or a document from the archive |
| `BookkeepingExportColumn`, `BookkeepingExportColumnType`, `BookkeepingExportForeignKey`, `BookkeepingExportValue` | type, enum, type, type | A column of a table, `NUMBER`, `TEXT` or `DAY`, a column holding the ids of another table, and a value of a row |
| `BookkeepingConformanceServiceInterface`, `BookkeepingConformance` | interface, type | A service holding the books to the rules of a law, and its name, see [holding the books to a law](#holding-the-books-to-a-law) |
| `HgbCorporationConformanceService` | class | The HGB for a GmbH, UG, AG, KGaA or SE: its company and register in the settings, its size class, the forms of its statements, and the note below the balance sheet of a micro corporation. Registered for you |
| `UgConformanceService`, `UgLegalReserve` | class, type | The legal reserve of a UG, § 5a (3) GmbHG, on the accounts its posting rules name, and what it resolves to. Registered for you |
| `HgbSizeClass`, `HGB_SIZE_CLASS_THRESHOLDS`, `HgbSizeClassThresholds`, `HgbSizeThreshold` | enum, constant, type, type | The size classes of § 267 and § 267a HGB, their thresholds by the fiscal years they apply to, and the limits of one class |
| `HGB_BALANCE_SHEET`, `HGB_SMALL_BALANCE_SHEET`, `HGB_MICRO_BALANCE_SHEET`, `HGB_INCOME_STATEMENT`, `HGB_MICRO_INCOME_STATEMENT`, `HGB_STATEMENT_STRUCTURES` | constant | The forms of the statements of the HGB, see [mapping accounts to the statements](#mapping-accounts-to-the-statements), and all of them, which `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.STATEMENT_STRUCTURES` holds by default |
| `BookkeepingStatementStructure`, `BookkeepingStatementPositionDefinition`, `BookkeepingBalanceSide` | type, type, type | The form of a statement as data, a position of it, and `'debit'` or `'credit'`, the side whose balance counts positive |
| `BookkeepingStatement`, `BookkeepingStatementPosition`, `BookkeepingAccountAmount`, `BookkeepingStatementType` | class, class, class, enum | A statement of a fiscal year in one form, a position of it with its amount, what one account adds to a report, and `BALANCE_SHEET` or `INCOME_STATEMENT` |
| `BookkeepingJournalReport`, `BookkeepingLedgerReport`, `BookkeepingLedgerLine` | class, class, class | The journal of a range, the ledger of an account, and a line of the ledger with the balance after it |
| `BookkeepingTrialBalance`, `BookkeepingTrialBalanceRow`, `BookkeepingRevenueReport` | class, class, class | The trial balance of a fiscal year, a row of it per account, and the revenue of a calendar year |
| `BookkeepingStatementForms`, `BookkeepingReportContext` | type, type | The forms the statements of a fiscal year are in by default, and a fiscal year as a conformance is handed it for a report |
| `BookkeepingStatementFormChoices`, `BookkeepingStatementFormChoice`, `BookkeepingStatementForm` | class, class, class | The forms the balance sheet and the income statement of a fiscal year can be shown in, the one that applies to each, and a form with its name, as `GET /fiscal-years/:id/statement-forms` answers them |
| `BookkeepingStatementUtilities`, `BookkeepingConformanceUtilities` | class, class | The position of an account by its balance and the amounts of a statement, and the conformances that apply to a fiscal year |
| `ResolvedBookkeepingStatement` | type | The `positions` of a statement and the accounts with a balance and no position, `unmapped`, as `resolveStatement` answers them |
| `BookkeepingAccountWriteObserver` | class | Refuses an account mapped to a position the statements do not have, however the repository gets to it. Registered for you |
| `FiscalYearStatement`, `FiscalYearStatementCreateData` | entity, type | A statement of a closed fiscal year in one form with its pdf, archived at its closing. And what creates one. Archived by `ZibriBookkeepingPlugin` |
| `BookkeepingCompany` | class | The company whose books they are: its `name`, `seat`, `registerCourt` and `registerNumber`, which the statements state |
| `resolveBookkeepingCompanyModel` | function | The class of the company of the settings, the one in `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.COMPANY_MODEL`, see [the company model](#the-company-model) |
| `BookkeepingVerificationCronJob` | cron job | Checks the books of every tenant once a day, and records what it finds in the audit trail. Registered for you |
| `ExpenseWriteObserver` | class | Refuses to change or delete a recorded expense, however the repository gets to it, as a [write observer](../data/write-observers.md). Registered for you |
| `ExpenseBankMatcher`, `AccountBankMatcher` | class, class | The matchers of expenses and of accounts, which the bank plugin asks for suggestions. Registered for you |
| `BookkeepingSettings`, `BookkeepingSettingsCreateData` | entity, type | The settings of the books of a tenant, one row at most: its `currency`, the history of its `legalForms` and its `company`. And what creates them. Stored by `ZibriBookkeepingPlugin` |
| `NewBookkeepingSettings`, `BookkeepingSettingsChange` | class, class | What `POST /settings` takes, and what `PATCH /settings` takes: a `currency`, a `legalForm` to append and a `company` to replace, each unchanged when absent |
| `BookkeepingLegalForm` | class | A legal form of the tenant from a day on: `legalForm` and `validFrom`, as the `legalForms` of `POST /settings` and the `legalForm` of `PATCH /settings` take it |
| `BookkeepingAccount`, `BookkeepingAccountCreateData` | entity, type | An account of the books: its `number`, `name`, `type`, `statementPosition`, `creditStatementPosition` and `closedAt`. And what creates one. Stored by `ZibriBookkeepingPlugin` |
| `BookkeepingAccountType` | enum | `ASSET`, `LIABILITY`, `EQUITY`, `REVENUE` and `EXPENSE`: what an account holds |
| `skr03ChartOfAccounts`, `skr04ChartOfAccounts`, `ChartOfAccounts` | constant, constant, type | The SKR 03 and the SKR 04 as data, as valid for 2026, each account mapped to the full HGB statements, and the shape of a chart: its `id`, `name` and `accounts`, see [seeding a chart of accounts](#seeding-a-chart-of-accounts) |
| `FiscalYear`, `FiscalYearCreateData` | entity, type | A fiscal year of the books: its `start` and `end`, `closedAt`, the `conformances` it names, its `averageEmployees`, `balanceSheetNote`, `founded` and `previousSizeClass`, and the `lastSequence` of its entries. And what creates one. Stored by `ZibriBookkeepingPlugin` |
| `FiscalYearChange`, `FiscalYearEntrySourceType` | class, enum | What `PATCH /fiscal-years/:id` takes, and the `sourceType` of the entries closing and opening a fiscal year |
| `JournalEntry` | entity | A posted entry: its fiscal year, `sequence`, document and posting day, text, who posted it, the entry it reverses and what created it. Archived by `ZibriBookkeepingPlugin` |
| `JournalEntryLine` | entity | A line of an entry: the account, the `debit` or the `credit`, and its `role`. Archived by `ZibriBookkeepingPlugin` |
| `JournalEntryLineRole` | enum | `RESULT`, the role of the line of the closing entry carrying the result of the year into equity. Only the closing sets it |
| `JournalEntryDetails` | class | An entry with its lines and the `reversedByEntryId` of the entry reversing it, as posting, reversing and reading one answer it |
| `JournalEntryFilter` | type | What `findEntries` of the journal service narrows a page of the entries by: `fiscalYearId`, `from`, `until` and `accountId` |
| `JournalEntryPage` | class | What `findEntries` and `GET /entries` answer: the `items` of the page, the `totalAmount` of the entries matching, and the `debit` and `credit` of their lines |
| `BookkeepingAccountFilter` | type | What `findAccounts` of the journal service narrows the accounts by: a `search` and whether they are `open` |
| `NewJournalEntry`, `NewJournalEntryLine`, `JournalEntryPosting` | class, class, type | What `POST /entries` takes, a line of it, and what `post` takes beside: `createdBy` and the `sourceType` and `sourceId` of what created the entry |
| `JournalEntryReversal`, `JournalEntryReversalPosting` | class, type | What `POST /entries/:id/reversal` takes, the `postingDate` and the `text`, and what `reverse` takes beside: `createdBy`, `sourceType` and `sourceId` |
| `NewBookkeepingAccount`, `NewFiscalYear` | class, class | What `POST /accounts` and `POST /fiscal-years` take |
| `FiscalYearClosing`, `FiscalYearClosingResult` | class, class | What closing a fiscal year takes, the `resultAccountId`, and what it answers: both fiscal years and the entries it posted |
| `FiscalYearReopening`, `FiscalYearReopeningPosting`, `FiscalYearReopeningResult`, `BookkeepingReopening` | class, type, class, type | What reopening a fiscal year takes, its `reason` and `forCorrection`, the same with the user from code, what it answers, and the fiscal year being reopened as a conformance validates it |
| `BookkeepingClosing`, `BookkeepingAccountBalance`, `BookkeepingCarriedBalances` | type, type, type | A fiscal year about to be closed, as a conformance service is handed it, what its lines add up to on one account, and the balances it starts with, as `resolveCarriedBalances` of the journal service answers them, see [carrying balances over by hand](#carrying-balances-over-by-hand) |
| `BookkeepingClosingProposal` | class | An entry a conformance proposes to post before a fiscal year is closed |
| `BookkeepingObligation` | class | What a conformance asks of a closed fiscal year, such as filing its E-Bilanz, with its `dueOn` and `fulfilledAt` |
| `BookkeepingVerification`, `BookkeepingVerificationProblem` | class, class | What checking the books of a tenant found, and each problem, naming its entry or line |
| `PostingRuleSet`, `PostingRuleSetCreateData` | entity, type | The posting `rules` of a fiscal year from the day `validFrom`. And what creates one. Stored by `ZibriBookkeepingPlugin` |
| `PostingRules`, `NewPostingRuleSet` | class, class | The accounts the postings are booked on, as `PUT /posting-rule-sets/:id` takes them, and what `POST /posting-rule-sets` takes |
| `PostingRuleRevenueAccount`, `PostingRuleTaxAccount`, `PostingRuleBankAccount` | class, class, class | A rule of the revenue of a VAT category and rate, of an account per VAT rate, and of the account of a bank account |
| `PostingSource`, `PostingSourceType` | type, enum | What `postFor` posts, and its kind as the `sourceType` of the entry: `invoicing.invoice`, `invoicing.credit-note`, `bookkeeping.expense` or `bank.match` |
| `Expense`, `ExpenseCreateData` | entity, type | An invoice received or a receipt: its supplier, document, totals per VAT rate, account and receipt, when it was recorded and what posted it. And what creates one. Stored by `ZibriBookkeepingPlugin` |
| `ExpenseData`, `ExpenseSupplier`, `ExpenseTaxTotal` | class, class, class | What `POST /expenses` takes, who issued the document, and the amounts of one VAT rate |
| `ExpenseFilter` | type | Which expenses `findExpenses` answers: those a `search` finds by their document number or the name of their supplier |
| `ExpenseReceipt`, `ExpenseReceiptUpload`, `ExpenseReceiptFile` | entity, class, type | The document of an expense with its file, what `POST /expense-receipts` takes, and what `createReceipt` takes. Archived by `ZibriBookkeepingPlugin` |
| `EXPENSE_RECEIPT_FILE_STORE_NAME` | constant | `'receipts'`, the name of the file store the receipts are kept in unless `receiptStore` of the options names another |
| `AccountMatchRule`, `AccountMatchRuleCreateData`, `NewAccountMatchRule` | entity, type, class | A rule suggesting the account a bank transaction is matched with, what creates one, and what `POST /account-match-rules` takes. Stored by `ZibriBookkeepingPlugin` |
| `BookkeepingLimits` | class | The longest names, numbers and texts, the most lines of an entry and the largest receipt |
| `BookkeepingDayUtilities` | class | The days the books are kept by: resolves, checks, formats and steps a day held as its midnight UTC |
| `JournalEntryUtilities` | class | The lines of entries: what a valid entry holds, and the lines of a reversal, a closing and an opening |
| `BookedJournalEntryLine`, `ClosingJournalEntryLine` | type, type | A line as it is booked, its `accountId`, `debit` and `credit`, and a line of a closing entry, which has its `role` as well |
| `ZIBRI_BOOKKEEPING_PERMISSIONS`, `ZibriBookkeepingPermissions` | constant, constant | The tenant permissions of the routes, to spread into yours, and the same by name |
| `ZIBRI_BOOKKEEPING_PLATFORM_PERMISSIONS`, `ZibriBookkeepingPlatformPermissions` | constant, constant | The platform permissions of the routes, for the books of every tenant, and the same by name |

`zibri-contract` has the models of the routes for your frontend, such as `JournalEntryDetailsModel`, `NewJournalEntryModel`, `PostingRuleSetModel`, `ExpenseModel`, `BookkeepingStatementModel` and `BookkeepingStatementFormChoicesModel`, `JournalEntryQueryModel` for the query of `GET /entries` and `JournalEntryPageModel` for its answer, `BookkeepingAccountQueryModel` for the query of `GET /accounts`, `ExpenseQueryModel` for the query of `GET /expenses`, `BookkeepingAccountType`, `BookkeepingStatementType` and the permissions.

## Setting it up
Add `new ZibriBookkeepingPlugin()` to the `plugins` of your application, see [registering a plugin](../application/plugin.md#registering-a-plugin), and `BookkeepingSettings`, `BookkeepingAccount`, `FiscalYear`, `JournalEntry`, `JournalEntryLine`, `PostingRuleSet`, `Expense`, `ExpenseReceipt` and `FiscalYearStatement` to the `entities` of one data source, beside what an [archived entity](../data/archive.md#archiving-a-type-of-document) needs. With the invoicing plugin, `Invoice` is in the same data source, and with the bank plugin matching, `BankMatch` and `AccountMatchRule` are. You import the names of the plugin from `zibri/plugin/bookkeeping`.

The receipts of expenses, and the pdfs of the statements archived at each closing, are kept in the file store named `receipts`, unless `receiptStore` of the options names another. Register it, of whichever storage you keep your documents in, see [registering a file store](../data/files.md#registering-a-file-store):

```ts
// src/files/receipt.file-store.ts
import { FileStore, FsFileStore, FsUtilities } from 'zibri';
import { EXPENSE_RECEIPT_FILE_STORE_NAME } from 'zibri/plugin/bookkeeping';

@FileStore()
export class ReceiptFileStore extends FsFileStore {
    constructor() {
        // the folder the files are kept in
        super(EXPENSE_RECEIPT_FILE_STORE_NAME, FsUtilities.getPath('/var/lib/app/receipts'));
    }
}
```

Say what a tenant without bookkeeping settings does, see [choosing what a tenant without books does](#choosing-what-a-tenant-without-books-does), in a provider you add to your `providers`:

```ts
// src/bookkeeping-options.provider.ts
import { defineProvider, DiProvider } from 'zibri';
import { BookkeepingPluginOptionsInput, ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from 'zibri/plugin/bookkeeping';

export const bookkeepingOptions: DiProvider<BookkeepingPluginOptionsInput> = defineProvider({
    token: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
    useValue: { tenantsWithoutBooks: 'post-nothing' }
});
```

Extend `BookkeepingController` with a `@Controller` of your own, at the path you choose:

```ts
// src/controllers/bookkeeping.controller.ts
import { Controller } from 'zibri';
import { BookkeepingController } from 'zibri/plugin/bookkeeping';

@Controller('/bookkeeping', { versions: 'all' })
export class AppBookkeepingController extends BookkeepingController {}
```

Add the plugin, the controller and the store to your application:

```ts
// src/application-options.base.ts
import { OmitStrict, ZibriApplicationOptions } from 'zibri';
import { ZibriBookkeepingPlugin } from 'zibri/plugin/bookkeeping';

import { AppBookkeepingController } from './controllers/bookkeeping.controller';
import { ReceiptFileStore } from './files/receipt.file-store';

export const baseApplicationOptions: OmitStrict<ZibriApplicationOptions, 'dataSources'> = {
    name: 'Task Tracker',
    baseUrl: 'http://localhost:3000',
    version: '1.0.0',
    environment: 'development',
    plugins: [new ZibriBookkeepingPlugin()],
    controllers: [AppBookkeepingController],
    fileStores: [ReceiptFileStore],
    websocketControllers: [],
    defaultAuth: 'public',
    twoFactorAtLogin: 'never'
};
```

Spread `ZIBRI_BOOKKEEPING_PERMISSIONS` into your tenant permissions, see [declaring permissions](../auth/roles-and-permissions.md#declaring-permissions), and give them to the roles that keep the books:

```ts
// src/models/permissions.ts
import { DefinedPermissions, definePermissions, ZIBRI_PERMISSIONS } from 'zibri';
import { ZIBRI_BOOKKEEPING_PERMISSIONS } from 'zibri/plugin/bookkeeping';

const PERMISSIONS = [...ZIBRI_PERMISSIONS, ...ZIBRI_BOOKKEEPING_PERMISSIONS, 'invoices.read'] as const;

export const Permissions: DefinedPermissions<typeof PERMISSIONS> = definePermissions(PERMISSIONS);
```

| Permission | Lets a member |
|---|---|
| `bookkeeping.read` | Read the settings, accounts, fiscal years, posting rules, entries, expenses and reports, and check the books |
| `bookkeeping.post` | Post and reverse entries |
| `bookkeeping.close-fiscal-year` | Read what the conformances propose at closing, and close a fiscal year |
| `bookkeeping.reopen-fiscal-year` | Reopen a closed fiscal year to correct its books |
| `bookkeeping.manage` | Start the books and change their settings, add accounts, posting rules and account match rules, and add and change fiscal years |
| `bookkeeping.expenses.manage` | Upload receipts, and enter, change, delete, record and correct expenses |
| `bookkeeping.export` | Export a fiscal year for a tax audit, with its documents |

## Starting the books
A tenant keeps books once it has bookkeeping settings: the `currency` its books are kept in, the history of its legal form, and its `company`, which the pdfs of the reports state. `POST /settings` creates them, once per tenant:

```bash
curl https://api.example.com/bookkeeping/settings \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'content-type: application/json' \
    -d '{
        "currency": "EUR",
        "legalForms": [{ "legalForm": "UG", "validFrom": "2025-01-01" }],
        "company": { "name": "Acme Software UG (haftungsbeschränkt)", "seat": "Berlin", "registerCourt": "Amtsgericht Charlottenburg", "registerNumber": "HRB 123456 B" }
    }'
```

`createSettings` of the journal service does the same from your own code. Creating them a second time is refused with a `409`. Every amount of the books is in their currency, with its minor units, such as 2 decimals for EUR. The conformances of each legal form of the history check the settings: a corporation names the `name`, `seat`, `registerCourt` and `registerNumber` of its company, § 264 (1a) HGB, and settings without them are refused with a `400`. A company of another legal form names what it has, or none.

`PATCH /settings` changes the settings, and `updateSettings` of the journal service does the same from your own code. A property the change leaves out stays as it is:

| Property | What it does |
|---|---|
| `currency` | Changes the currency, only while there is no fiscal year. Refused with a `409` once there is one |
| `legalForm` | Appends a legal form to the history: its `legalForm` and `validFrom` |
| `company` | Replaces the company whole: what the company before held and the new one leaves out is gone. `null` removes the company |

A legal form is valid from a day after the latest one of the history and after the end of the last closed fiscal year, so the legal form a closed year was closed with stays as it was. Anything else is refused with a `409`. Appending a legal form checks the posting rules of the open fiscal years it applies to by its conformances, such as those of a UG naming the accounts of its legal reserve, and refuses it with a `409` when they do not hold. A closed year keeps the company its archived pdfs state.

The change is applied in one transaction and checked as a whole: the conformances of each legal form of the resulting history check the settings the change results in, as they check the settings the books start with. A change that is refused changes nothing. A sole proprietorship becoming a GmbH, whose conformances ask for the register of its company, names the legal form and the company in one change:

```bash
curl -X PATCH https://api.example.com/bookkeeping/settings \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'content-type: application/json' \
    -d '{
        "legalForm": { "legalForm": "GmbH", "validFrom": "2027-06-01" },
        "company": { "name": "Acme Software GmbH", "seat": "Berlin", "registerCourt": "Amtsgericht Charlottenburg", "registerNumber": "HRB 123456 B" }
    }'
```

### The company model
A law can ask more of the company than its name, seat and register, such as the tax number and the tax office the [E-Bilanz](./e-bilanz.md) states. `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.COMPANY_MODEL` holds the class of the `company` of the settings, `BookkeepingCompany` by default. Register a class extending it, and the `company` of `POST /settings` and `PATCH /settings` takes, validates and answers its properties, the [API documentation](../endpoints/open-api.md) describes them, and the settings store them:

```ts
// src/company-model.provider.ts
import { DiProvider, Newable } from 'zibri';
import { BookkeepingCompany, GermanBookkeepingCompany, ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from 'zibri/plugin/bookkeeping';

export const companyModel: DiProvider<Newable<BookkeepingCompany>> = {
    token: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.COMPANY_MODEL,
    useValue: GermanBookkeepingCompany
};
```

With the default, a property of another class is refused with a `400`. A company stored before you registered a class holds only what the class then asked for, until a `company` of `PATCH /settings` replaces it. `resolveBookkeepingCompanyModel` answers the class registered, for a model of your own holding the company.

## Adding accounts
An account has a `number`, unique among the accounts of the tenant, a `name` and a `type`. An asset, liability or equity account is on the balance sheet, a revenue or expense account in the income statement. `statementPosition` names the position of a statement it is reported in, and `creditStatementPosition` the one it is reported in while its balance is a credit, see [mapping accounts to the statements](#mapping-accounts-to-the-statements). No chart of accounts is seeded: `POST /accounts` adds an account, and your own code seeds a chart with the repository, such as [the SKR 03 or the SKR 04](#seeding-a-chart-of-accounts):

```ts
// src/services/seed-accounts.function.ts
import { inject, Repository, repositoryTokenFor } from 'zibri';
import { BookkeepingAccount, BookkeepingAccountCreateData, BookkeepingAccountType } from 'zibri/plugin/bookkeeping';

export async function seedAccounts(): Promise<BookkeepingAccount[]> {
    const accounts: Repository<BookkeepingAccount, BookkeepingAccountCreateData> = inject(repositoryTokenFor(BookkeepingAccount));
    return await accounts.createAll([
        {
            number: '1200',
            name: 'Bank',
            type: BookkeepingAccountType.ASSET,
            statementPosition: 'assets.B.IV',
            creditStatementPosition: 'equity-and-liabilities.C.2'
        },
        { number: '1400', name: 'Receivables', type: BookkeepingAccountType.ASSET, statementPosition: 'assets.B.II.1' },
        { number: '1576', name: 'Input tax 19 %', type: BookkeepingAccountType.ASSET, statementPosition: 'assets.B.II.4' },
        { number: '1600', name: 'Payables', type: BookkeepingAccountType.LIABILITY, statementPosition: 'equity-and-liabilities.C.4' },
        {
            number: '1776',
            name: 'Output tax 19 %',
            type: BookkeepingAccountType.LIABILITY,
            statementPosition: 'assets.B.II.4',
            creditStatementPosition: 'equity-and-liabilities.C.8'
        },
        { number: '2900', name: 'Share capital', type: BookkeepingAccountType.EQUITY, statementPosition: 'equity-and-liabilities.A.I' },
        { number: '2970', name: 'Profit carried forward', type: BookkeepingAccountType.EQUITY, statementPosition: 'equity-and-liabilities.A.IV' },
        { number: '4210', name: 'Rent', type: BookkeepingAccountType.EXPENSE, statementPosition: 'income-statement.8' },
        { number: '8400', name: 'Revenue 19 %', type: BookkeepingAccountType.REVENUE, statementPosition: 'income-statement.1' }
    ]);
}
```

VAT is a line of its own, on an account of the tax per rate. An account whose `closedAt` you set takes no more postings.

## Mapping accounts to the statements
The balance sheet and the income statement are made of positions, such as the trade receivables or the revenue. Each account names the position it is reported in, and its balance adds to it. The forms of the statements are data, a `BookkeepingStatementStructure` each, and those of the German HGB are registered for you:

| Form | Id | What it is |
|---|---|---|
| `HGB_BALANCE_SHEET` | `hgb.balance-sheet` | The full balance sheet of a corporation, § 266 (2) and (3) HGB |
| `HGB_SMALL_BALANCE_SHEET` | `hgb.balance-sheet.small` | The shortened balance sheet of a small corporation, § 266 (1) sentence 3 HGB: the positions with letters and Roman numerals |
| `HGB_MICRO_BALANCE_SHEET` | `hgb.balance-sheet.micro` | The shortened balance sheet of a micro corporation (Kleinstkapitalgesellschaft), § 266 (1) sentence 4 HGB: the positions with letters |
| `HGB_INCOME_STATEMENT` | `hgb.income-statement` | The full income statement by the nature of expense method (Gesamtkostenverfahren), § 275 (2) HGB |
| `HGB_MICRO_INCOME_STATEMENT` | `hgb.income-statement.micro` | The shortened income statement of a micro corporation, § 275 (5) HGB |

Accounts are mapped to the positions of the full forms alone, to those without positions below them. Each position of a shortened form adds up positions of the full one, so one mapping serves every form, and the E-Bilanz maps the same positions.

The id of a position of the full balance sheet is its side followed by its numbering in § 266 HGB: `assets` for the assets (Aktiva) and `equity-and-liabilities` for the equity and liabilities (Passiva), then the letter, the Roman numeral and the number, each after a dot. The id of a position of the full income statement is `income-statement` followed by its number in § 275 (2) HGB, and a letter for the parts of a number. The ids are stable: a chart of accounts maps to them.

| Id | Position, as the HGB names it |
|---|---|
| `assets.A.I.1` | Selbst geschaffene gewerbliche Schutzrechte und ähnliche Rechte und Werte |
| `assets.A.I.2` | Entgeltlich erworbene Konzessionen, gewerbliche Schutzrechte und ähnliche Rechte und Werte sowie Lizenzen an solchen Rechten und Werten |
| `assets.A.I.3` | Geschäfts- oder Firmenwert |
| `assets.A.I.4` | Geleistete Anzahlungen |
| `assets.A.II.1` | Grundstücke, grundstücksgleiche Rechte und Bauten einschließlich der Bauten auf fremden Grundstücken |
| `assets.A.II.2` | Technische Anlagen und Maschinen |
| `assets.A.II.3` | Andere Anlagen, Betriebs- und Geschäftsausstattung |
| `assets.A.II.4` | Geleistete Anzahlungen und Anlagen im Bau |
| `assets.A.III.1` | Anteile an verbundenen Unternehmen |
| `assets.A.III.2` | Ausleihungen an verbundene Unternehmen |
| `assets.A.III.3` | Beteiligungen |
| `assets.A.III.4` | Ausleihungen an Unternehmen, mit denen ein Beteiligungsverhältnis besteht |
| `assets.A.III.5` | Wertpapiere des Anlagevermögens |
| `assets.A.III.6` | Sonstige Ausleihungen |
| `assets.B.I.1` | Roh-, Hilfs- und Betriebsstoffe |
| `assets.B.I.2` | Unfertige Erzeugnisse, unfertige Leistungen |
| `assets.B.I.3` | Fertige Erzeugnisse und Waren |
| `assets.B.I.4` | Geleistete Anzahlungen |
| `assets.B.II.1` | Forderungen aus Lieferungen und Leistungen |
| `assets.B.II.2` | Forderungen gegen verbundene Unternehmen |
| `assets.B.II.3` | Forderungen gegen Unternehmen, mit denen ein Beteiligungsverhältnis besteht |
| `assets.B.II.4` | Sonstige Vermögensgegenstände |
| `assets.B.III.1` | Anteile an verbundenen Unternehmen |
| `assets.B.III.2` | Sonstige Wertpapiere |
| `assets.B.IV` | Kassenbestand, Bundesbankguthaben, Guthaben bei Kreditinstituten und Schecks |
| `assets.C` | Rechnungsabgrenzungsposten |
| `assets.D` | Aktive latente Steuern |
| `assets.E` | Aktiver Unterschiedsbetrag aus der Vermögensverrechnung |
| `equity-and-liabilities.A.I` | Gezeichnetes Kapital |
| `equity-and-liabilities.A.II` | Kapitalrücklage |
| `equity-and-liabilities.A.III.1` | Gesetzliche Rücklage |
| `equity-and-liabilities.A.III.2` | Rücklage für Anteile an einem herrschenden oder mehrheitlich beteiligten Unternehmen |
| `equity-and-liabilities.A.III.3` | Satzungsmäßige Rücklagen |
| `equity-and-liabilities.A.III.4` | Andere Gewinnrücklagen |
| `equity-and-liabilities.A.IV` | Gewinnvortrag/Verlustvortrag |
| `equity-and-liabilities.A.V` | Jahresüberschuss/Jahresfehlbetrag |
| `equity-and-liabilities.B.1` | Rückstellungen für Pensionen und ähnliche Verpflichtungen |
| `equity-and-liabilities.B.2` | Steuerrückstellungen |
| `equity-and-liabilities.B.3` | Sonstige Rückstellungen |
| `equity-and-liabilities.C.1` | Anleihen |
| `equity-and-liabilities.C.2` | Verbindlichkeiten gegenüber Kreditinstituten |
| `equity-and-liabilities.C.3` | Erhaltene Anzahlungen auf Bestellungen |
| `equity-and-liabilities.C.4` | Verbindlichkeiten aus Lieferungen und Leistungen |
| `equity-and-liabilities.C.5` | Verbindlichkeiten aus der Annahme gezogener Wechsel und der Ausstellung eigener Wechsel |
| `equity-and-liabilities.C.6` | Verbindlichkeiten gegenüber verbundenen Unternehmen |
| `equity-and-liabilities.C.7` | Verbindlichkeiten gegenüber Unternehmen, mit denen ein Beteiligungsverhältnis besteht |
| `equity-and-liabilities.C.8` | Sonstige Verbindlichkeiten |
| `equity-and-liabilities.D` | Rechnungsabgrenzungsposten |
| `equity-and-liabilities.E` | Passive latente Steuern |
| `income-statement.1` | Umsatzerlöse |
| `income-statement.2` | Erhöhung oder Verminderung des Bestands an fertigen und unfertigen Erzeugnissen |
| `income-statement.3` | Andere aktivierte Eigenleistungen |
| `income-statement.4` | Sonstige betriebliche Erträge |
| `income-statement.5.a` | Aufwendungen für Roh-, Hilfs- und Betriebsstoffe und für bezogene Waren |
| `income-statement.5.b` | Aufwendungen für bezogene Leistungen |
| `income-statement.6.a` | Löhne und Gehälter |
| `income-statement.6.b` | Soziale Abgaben und Aufwendungen für Altersversorgung und für Unterstützung |
| `income-statement.7.a` | Abschreibungen auf immaterielle Vermögensgegenstände des Anlagevermögens und Sachanlagen |
| `income-statement.7.b` | Abschreibungen auf Vermögensgegenstände des Umlaufvermögens, soweit diese die in der Kapitalgesellschaft üblichen Abschreibungen überschreiten |
| `income-statement.8` | Sonstige betriebliche Aufwendungen |
| `income-statement.9` | Erträge aus Beteiligungen |
| `income-statement.10` | Erträge aus anderen Wertpapieren und Ausleihungen des Finanzanlagevermögens |
| `income-statement.11` | Sonstige Zinsen und ähnliche Erträge |
| `income-statement.12` | Abschreibungen auf Finanzanlagen und auf Wertpapiere des Umlaufvermögens |
| `income-statement.13` | Zinsen und ähnliche Aufwendungen |
| `income-statement.14` | Steuern vom Einkommen und vom Ertrag |
| `income-statement.16` | Sonstige Steuern |

The positions above them add up the ones below, such as `assets.B.II` the four receivables and `assets` the balance sheet total. `income-statement.15`, the result after taxes, adds up 1 to 14, and `income-statement.17`, the net income or net loss for the year, adds up 15 and 16. The result of the fiscal year is part of `equity-and-liabilities.A.V`, whether or not it is posted. The positions of `hgb.balance-sheet.small` and `hgb.balance-sheet.micro` have the ids of the full positions they add up, such as `assets.B.II`. Those of `hgb.income-statement.micro` are `micro-income-statement` followed by their number in § 275 (5) HGB:

| Id | Position | Adds up |
|---|---|---|
| `micro-income-statement.1` | Umsatzerlöse | `income-statement.1` |
| `micro-income-statement.2` | Sonstige Erträge | `income-statement.2`, `.3`, `.4`, `.9`, `.10` and `.11` |
| `micro-income-statement.3` | Materialaufwand | `income-statement.5` |
| `micro-income-statement.4` | Personalaufwand | `income-statement.6` |
| `micro-income-statement.5` | Abschreibungen | `income-statement.7` and `.12` |
| `micro-income-statement.6` | Sonstige Aufwendungen | `income-statement.8` and `.13` |
| `micro-income-statement.7` | Steuern | `income-statement.14` and `.16` |
| `micro-income-statement.8` | Jahresüberschuss/Jahresfehlbetrag | `income-statement.17` |

An account whose balance can be on either side, such as a bank account that is overdrawn or the VAT of a month that is owed or refunded, names a second position with `creditStatementPosition`. While its balance is a credit, it is reported there, and in `statementPosition` while it is a debit. A bank account with `statementPosition: 'assets.B.IV'` and `creditStatementPosition: 'equity-and-liabilities.C.2'` is a bank balance on the left, or a liability to the bank on the right.

Saving an account checks its positions, however the repository saves it: a position no full form has, one with positions below it, or one of the other statement than the type of the account is refused with a `400`. An account with a balance and no position, or with a position the form does not have, is reported in `unmapped` of the statement, never left out.

A form takes amounts with a sign: a balance on the side a position counts by adds, the other side subtracts. The assets count debits, the equity and liabilities credits, and the income statement counts its income positive and its expenses negative, so `income-statement.8` of a year with 350.00 € of rent is `-350.00`.

> [!NOTE]
> The labels of the positions are the wording of the HGB, without its remarks ("davon ...") and without the further positions of § 268 HGB, such as a deficit not covered by equity on the asset side. A statement in a form reads the positions of the accounts as they are.

## Seeding a chart of accounts
A chart of accounts (Kontenrahmen) numbers the accounts a company books on. `skr03ChartOfAccounts` and `skr04ChartOfAccounts` are the two standard charts of German bookkeeping, those of DATEV, as data: the SKR 03, ordered by the flow of the business (Prozessgliederungsprinzip), and the SKR 04, ordered by the statements (Abschlussgliederungsprinzip). Each is a `ChartOfAccounts`, an `id`, a `name` and the `accounts` of a corporation, each account mapped to a position of the full forms of § 266 and § 275 (2) HGB, see [mapping accounts to the statements](#mapping-accounts-to-the-statements). Nothing is seeded for you. Spread the accounts of a chart into your seed, and add or change accounts beside them:

```ts
// src/services/seed-chart-of-accounts.function.ts
import { inject, Repository, repositoryTokenFor } from 'zibri';
import { BookkeepingAccount, BookkeepingAccountCreateData, BookkeepingAccountType, skr04ChartOfAccounts } from 'zibri/plugin/bookkeeping';

export async function seedChartOfAccounts(): Promise<BookkeepingAccount[]> {
    const accounts: Repository<BookkeepingAccount, BookkeepingAccountCreateData> = inject(repositoryTokenFor(BookkeepingAccount));
    const chart: BookkeepingAccountCreateData[] = skr04ChartOfAccounts.accounts.map(account => account.number === '1800'
        // your own name of an account of the chart
        ? { ...account, name: 'Sparkasse Berlin' }
        : account);
    return await accounts.createAll([
        ...chart,
        // an account of your own
        {
            number: '1860',
            name: 'Tagesgeld',
            type: BookkeepingAccountType.ASSET,
            statementPosition: 'assets.B.IV',
            creditStatementPosition: 'equity-and-liabilities.C.2'
        }
    ]);
}
```

Each number is in a chart once, so an account of your own takes a number the chart does not have, and changing one of the chart replaces it rather than adding it twice. The charts follow the standard charts of DATEV valid for 2026, with 1,437 accounts in the SKR 03 and 1,441 in the SKR 04: the number, the type and the positions of each account are those of its frame. The names of the accounts are German, as the charts are: they are data, not texts your application translates.

An account whose balance can be on either side names both positions, such as a bank account (`assets.B.IV`, or `equity-and-liabilities.C.2` while it is overdrawn), each account of the VAT (`assets.B.II.4` or `equity-and-liabilities.C.8`), the receivables and payables, and the clearing accounts, such as money in transit or the wages. The accounts appropriating the result, such as the allocation to the legal reserve, `2496` in the SKR 03 and `7765` in the SKR 04, are equity accounts in `equity-and-liabilities.A.V`: they move equity between its positions and leave the result of the year as it is, as the [legal reserve of a UG](#the-legal-reserve-of-a-ug) posts it.

The accounts of class 9 are in no position:

| Accounts | What they hold |
|---|---|
| `9000` to `9090` | The counter accounts of balances and open items carried forward by hand, such as the opening balances of books kept elsewhere before. Their balance is 0 once every balance is posted. Equity accounts, so a balance left is reported in `unmapped` of the balance sheet and leaves the result as it is |
| `9101` to `9998` | Statistical figures and their counter accounts, such as the days of sale, the contingent liabilities stated below the balance sheet, the capital accounts of partners and the adjustments of the taxable profit outside the statements. Expense accounts, so their balances add up to 0 in the result, stay out of the revenue and start at 0 in each fiscal year. A year that posts them reports them in `unmapped` of the income statement |

A year whose opening balances come from the closing of the year before posts on neither, and its statements have no `unmapped` balance.

### Carrying balances over by hand
The first fiscal year of books kept elsewhere before, such as in GnuCash, starts with their balances posted by hand against a carry-forward account: an equity account in no position, by neither `statementPosition` nor `creditStatementPosition`, such as `9000` to `9090` of both charts. An account of your own chart that is one counts the same. Such an entry, such as `9000` debited and `0860` credited with the profit carried forward, carries a balance into the year as the opening entry does. `resolveCarriedBalances` of `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.JOURNAL_SERVICE` answers what the year starts with as `BookkeepingCarriedBalances`: what the lines of its opening entry and of each entry with a line on a carry-forward account add up to on each account, the carry-forward accounts left out, and the ids of those entries. The [legal reserve of a UG](#the-legal-reserve-of-a-ug) reads a loss carried forward from it, and the [E-Bilanz](./e-bilanz.md#comparing-the-business-assets) the balances before the year.

> [!NOTE]
> The charts leave out the accounts of the frames that only sole proprietors and partnerships book on, such as the private and capital accounts of the partners, the special items with an equity portion, and the items of a group, such as profit transfers. Accounts the frames keep for the cash basis accounting of § 4 (3) EStG are part of them, mapped as the frames map them.

A chart of accounts as such is not protected by copyright (KG Berlin, judgment of 13.02.1987, 5 U 4910/84). The numbers and positions are facts of the frames, and the names of the accounts are Zibri's own wording, written from what each account holds.

## Adding fiscal years
Entries are posted into the fiscal year their posting day falls into. `POST /fiscal-years` and `createFiscalYear` of the journal service add one:

```bash
curl https://api.example.com/bookkeeping/fiscal-years \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'content-type: application/json' \
    -d '{ "start": "2025-03-15" }'
```

The fiscal years of a tenant follow each other without overlapping and without a gap: each starts the day after the one before it ends, and a fiscal year that does not is refused with a `409` naming the day it needs to start on. The first one names its `start`, and ends at the end of its calendar year unless it names its `end`, such as a short year after the founding. Every later one starts the day after the one before, and ends the day before the same day a year later, so a calendar year follows a calendar year. A fiscal year after another starts with a copy of the posting rules valid at the end of that one, see [setting the posting rules](#setting-the-posting-rules).

Every day of the books is written as `2026-03-31` and held as its midnight UTC: `start`, `end`, `postingDate`, `documentDate` and `validFrom`. A date with a time is refused with a `400`.

A fiscal year holds what its statements need beside the books, which it takes when it is added, or from `PATCH /fiscal-years/:id` and `updateFiscalYear` of the journal service while it is open:

| Property | What it is |
|---|---|
| `averageEmployees` | The average number of employees during the fiscal year, such as for the [size class of a corporation](#the-size-class-of-a-corporation) |
| `balanceSheetNote` | The text stated below the balance sheet where the conformances of the year state one, such as a micro corporation. None for a year with nothing to state |
| `founded` | Whether the company was founded in the fiscal year, for the first fiscal year of the books |
| `previousSizeClass` | The size class the company had at the balance sheet date before the first fiscal year of the books, such as `SMALL`, for a company that existed before |

```bash
curl -X PATCH https://api.example.com/bookkeeping/fiscal-years/1e7d5c4b-3a21-4f20-9b6a-8d4e3c1f7a52 \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'content-type: application/json' \
    -d '{ "averageEmployees": 2.5, "balanceSheetNote": "Haftungsverhältnisse nach § 268 Abs. 7 HGB bestehen nicht." }'
```

A property absent from the body stays as it is. A closed fiscal year keeps what it was closed with, and changing it is refused with a `409`.

## Posting an entry
`POST /entries` posts an entry into the books of the tenant:

```bash
curl https://api.example.com/bookkeeping/entries \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'content-type: application/json' \
    -d '{
        "documentDate": "2026-03-01",
        "postingDate": "2026-03-01",
        "documentReference": "L-2026-03",
        "text": "Rent March",
        "lines": [
            { "accountId": "0b6d6a7e-61a4-4c2f-9d0e-5f2b8c1e7a90", "debit": "1200.00" },
            { "accountId": "9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d", "credit": "1200.00" }
        ]
    }'
```

`post` of the journal service posts one from your own code, in the transaction you pass:

```ts
// src/services/rent.function.ts
import { BigNumber, inject } from 'zibri';
import { JournalEntryDetails, ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from 'zibri/plugin/bookkeeping';

export async function postRent(rentAccountId: string, bankAccountId: string): Promise<JournalEntryDetails> {
    return await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.JOURNAL_SERVICE).post({
        documentDate: new Date('2026-11-01T00:00:00.000Z'),
        postingDate: new Date('2026-11-01T00:00:00.000Z'),
        documentReference: 'L-2026-11',
        text: 'Rent November',
        lines: [
            { accountId: rentAccountId, debit: new BigNumber('1200.00') },
            { accountId: bankAccountId, credit: new BigNumber('1200.00') }
        ],
        sourceType: 'lease',
        sourceId: 'L-2026-11'
    });
}
```

`sourceType` and `sourceId` name what created the entry, such as an invoice. A source is posted once: a second entry of the same `sourceType` and `sourceId` is refused with a `409`. Each entry gets the next `sequence` of its fiscal year, counting from 1. The sequence is drawn in the transaction of the entry: an entry whose transaction is rolled back leaves no gap, and two entries posted at once get one each. The writes of the books of one tenant run one after the other. An entry is refused when it does not hold:

| Status | When |
|---|---|
| `400` | It has fewer than 2 lines, a line has a debit and a credit or neither, an amount is not above 0 or has more decimals than the currency, the debits do not add up to the credits, or a day has a time. The message says what the value needs to be |
| `409` | The tenant has no settings, the posting day falls into no fiscal year or into a closed one, a line names an account that is not an open account of the books, or its source is posted already |

Each answer holds the entry and its lines:

```json
{
    "entry": {
        "id": "7d2e4c1a-5b3f-4a6e-9c8d-1f0e2b3a4c5d",
        "fiscalYearId": "1e7d5c4b-3a21-4f20-9b6a-8d4e3c1f7a52",
        "sequence": 12,
        "documentDate": "2026-03-01T00:00:00.000Z",
        "postingDate": "2026-03-01T00:00:00.000Z",
        "documentReference": "L-2026-03",
        "text": "Rent March",
        "reversesEntryId": null,
        "sourceType": null,
        "sourceId": null,
        "chainSequence": 40,
        "retainUntil": "2036-12-31T23:00:00.000Z"
    },
    "lines": [
        { "accountId": "0b6d6a7e-61a4-4c2f-9d0e-5f2b8c1e7a90", "debit": "1200", "credit": null },
        { "accountId": "9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d", "debit": null, "credit": "1200" }
    ]
}
```

## Reversing an entry
A posted entry is corrected by reversing it and posting the corrected one. `POST /entries/:id/reversal` posts the mirror of the entry, its lines with debit and credit swapped, on the day it names:

```bash
curl https://api.example.com/bookkeeping/entries/7d2e4c1a-5b3f-4a6e-9c8d-1f0e2b3a4c5d/reversal \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'content-type: application/json' \
    -d '{ "postingDate": "2026-03-05", "text": "Booked on the wrong account" }'
```

The reversal names the entry in `reversesEntryId`, keeps its `documentReference`, and is posted into the open fiscal year of its own day. An entry is reversed once, and a reversal is not reversed: both are refused with a `409`. So is an entry of the source type `bookkeeping.closing` or `bookkeeping.opening`, which only [reopening its fiscal year](#reopening-a-fiscal-year) reverses. `reverse` of the journal service does the same from your own code. Every route answering an entry names the entry reversing it in `reversedByEntryId`, null while none does, read from the `reversesEntryId` of the reversal, as an entry is not changed once it is posted.

## Closing a fiscal year
Closing a fiscal year refuses every further posting into it, and opens the next one with the balances it closes with. `POST /fiscal-years/:id/closing` closes one, naming the equity account its result goes to:

```bash
curl https://api.example.com/bookkeeping/fiscal-years/1e7d5c4b-3a21-4f20-9b6a-8d4e3c1f7a52/closing \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'content-type: application/json' \
    -d '{ "resultAccountId": "4b3a2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d" }'
```

In one transaction, it:

1. closes the fiscal year, once the postings into it under way are done
2. has the [conformances](#holding-the-books-to-a-law) of the year validate the closing, any of which can refuse it
3. archives the balance sheet and the income statement, in the forms that apply and in the full forms, each with its pdf, as `FiscalYearStatement` rows, see [reading the reports](#reading-the-reports). Everything they are resolved from is read in the transaction of the closing, so an entry posted in it before, such as a proposal, is part of them
4. posts the closing entry on the last day of the year: each revenue and expense account booked to zero, and the result, a profit on the credit side and a loss on the debit side, on the result account, a line with the `role` `result`. Each other account in the position the result is part of, the `resultPosition` of a full balance sheet such as `equity-and-liabilities.A.V`, is booked to zero into the result account as well, in lines without a role: an account appropriating the result, such as the allocation to the legal reserve, starts the next year at 0, and the profit carried forward holds what is left of the result. Its `sourceType` is `bookkeeping.closing`. Only the closing gives a line a role: a `NewJournalEntryLine` has none
5. creates the next fiscal year when there is none, with a copy of the posting rules
6. posts the opening entry on the first day of the next year: the balance of each asset, liability and equity account, on the side it is on. Its `sourceType` is `bookkeeping.opening`

The answer, a `FiscalYearClosingResult`, holds both fiscal years and both entries, null for an entry that would have no lines. A fiscal year is closed after the one before it, and closing one that is closed is refused with a `409`, as is a result account that is not an equity account of the books.

The entries a conformance proposes, such as the reserve of a UG, are posted before the year is closed. `GET /fiscal-years/:id/closing-proposals` answers them, each with the name of its conformance and an entry as `POST /entries` takes it. Review each, post it, then close the year. A conformance whose proposals are not posted refuses the closing.

## Reopening a fiscal year
The books of a closed fiscal year can still be corrected until its accounts are adopted and filed, such as a rent booked twice that the tax advisor finds while preparing the tax return. `POST /fiscal-years/:id/reopening` reopens one, naming why, with a [second factor](../auth/two-factor.md) given again for the request:

```bash
curl https://api.example.com/bookkeeping/fiscal-years/1e7d5c4b-3a21-4f20-9b6a-8d4e3c1f7a52/reopening \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'x-authorization-otp: 123456' \
    -H 'content-type: application/json' \
    -d '{ "reason": "Rent of March booked twice" }'
```

In one transaction, it:

1. has the conformances of the year validate the reopening, any of which can refuse it, such as the [E-Bilanz](./e-bilanz.md#correcting-a-filed-fiscal-year) once it is filed
2. opens the fiscal year again, and counts the reopening in its `reopenings`
3. posts the reversal of the closing entry on the last day of the year, naming it in `reversesEntryId`, with the reason as its text and the `sourceType` `bookkeeping.closing`
4. posts the reversal of the opening entry the next fiscal year took from the closing on its first day, with the `sourceType` `bookkeeping.opening`
5. records it in the [audit trail](../data/audit.md) of the tenant, once it is committed

Post the corrections into the year, then close it again, see [closing a fiscal year](#closing-a-fiscal-year): the conformances validate the closing again, its statements are archived anew, and a new closing entry and a new opening entry of the next year are posted. The answer, a `FiscalYearReopeningResult`, holds both fiscal years and both reversals, null for an entry the closing did not post. `reopenFiscalYear` of the journal service does the same from your own code.

A reopening is refused with a `409` for an open fiscal year, and for one whose next fiscal year is closed: the next one opened with its closing, so the latest closed year is reopened first. The permission `bookkeeping.reopen-fiscal-year` is its own, apart from closing.

Nothing of the closing is changed or deleted. Its entries stay in the journal beside their reversals, and the statements archived at it stay archived beside those of the next closing, each `FiscalYearStatement` numbered by its `closing`. A fiscal year answers the statements of the closing after its last reopening, `reopenings` + 1. A conformance refuses a reopening with `validateReopening`, which it is handed a `BookkeepingReopening` for: the settings, the fiscal year as it was closed, the legal form, `forCorrection`, and the transaction.

> [!NOTE]
> Under the GoBD, a booking is not changed once it is recorded, and a correction keeps both the original and the fact that it was corrected visible. A reopening holds to that: it corrects by reversals that name what they reverse, deletes nothing, keeps every statement archived, and records who reopened the year, when and why. It is meant for the time before the accounts are adopted and filed. A fiscal year whose accounts are filed, such as by an accepted E-Bilanz, is reopened only to file a correction.

## Reading the reports
The report service answers what the books of the current tenant hold, and a route of the controller answers each:

| Report | Method of the report service | Route |
|---|---|---|
| The journal: the entries with their lines posted on the days of a range, with the sums of their debits and credits | `resolveJournal(from, until)` | `GET /reports/journal?from=2026-01-01&until=2026-12-31` |
| The ledger of an account: its lines on the days of a range, with the balance before and after each | `resolveLedger(accountId, from, until)` | `GET /reports/ledger?accountId=...&from=...&until=...` |
| The trial balance (Summen- und Saldenliste): the debits, credits and balance of each account of a fiscal year, up to a day, its last by default | `resolveTrialBalance(fiscalYearId, until)` | `GET /reports/trial-balance?fiscalYearId=...&until=2026-06-30` |
| The balance sheet of a fiscal year in a form | `resolveBalanceSheet(fiscalYearId, form)` | `GET /reports/balance-sheet?fiscalYearId=...&form=hgb.balance-sheet.small` |
| The income statement of a fiscal year in a form | `resolveIncomeStatement(fiscalYearId, form)` | `GET /reports/income-statement?fiscalYearId=...&form=hgb.income-statement` |
| The revenue of a calendar year: the credits less the debits of each revenue account, such as to watch the turnover limits of a small business exempt from VAT | `resolveRevenue(year)` | `GET /reports/revenue?year=2026` |

```ts
// src/services/annual-statements.function.ts
import { inject } from 'zibri';
import { BookkeepingReportServiceInterface, BookkeepingStatement, ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from 'zibri/plugin/bookkeeping';

export async function resolveAnnualStatements(fiscalYearId: string): Promise<BookkeepingStatement[]> {
    const reports: BookkeepingReportServiceInterface = inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.REPORT_SERVICE);
    return [
        await reports.resolveBalanceSheet(fiscalYearId, undefined),
        await reports.resolveIncomeStatement(fiscalYearId, undefined)
    ];
}
```

A statement without a `form` is in the form the [conformances](#holding-the-books-to-a-law) of its fiscal year resolve, such as the shortened forms of a micro corporation, or the full form when none does. `resolveStatementForms` answers which. `resolveStatementFormChoices`, and `GET /fiscal-years/:id/statement-forms`, answer that form as `applies` beside every form the statement can be shown in, each structure of its type with its `id` and its `name` in the locale of the request, for a frontend to choose from:

```json
{
    "fiscalYearId": "1e7d5c4b-3a21-4f20-9b6a-8d4e3c1f7a52",
    "balanceSheet": {
        "applies": "hgb.balance-sheet.small",
        "forms": [
            { "id": "hgb.balance-sheet", "name": "Balance sheet (§ 266 HGB)" },
            { "id": "hgb.balance-sheet.small", "name": "Shortened balance sheet of a small corporation (§ 266 (1) sentence 3 HGB)" },
            { "id": "hgb.balance-sheet.micro", "name": "Shortened balance sheet of a micro corporation (§ 266 (1) sentence 4 HGB)" }
        ]
    },
    "incomeStatement": {
        "applies": "hgb.income-statement",
        "forms": [
            { "id": "hgb.income-statement", "name": "Income statement by the nature of expense method (§ 275 (2) HGB)" },
            { "id": "hgb.income-statement.micro", "name": "Shortened income statement of a micro corporation (§ 275 (5) HGB)" }
        ]
    }
}
```

Each position comes with its `id`, the `parentId` of the position it is below, its `depth`, its `label` in the locale of the request, its `amount`, its `previousAmount` in the fiscal year before, § 265 (2) HGB, and the accounts it holds:

```json
{
    "fiscalYearId": "1e7d5c4b-3a21-4f20-9b6a-8d4e3c1f7a52",
    "previousFiscalYearId": "6d4e3c1f-7a52-4b6a-9f20-1e7d5c4b3a21",
    "previousEnd": "2025-12-31T00:00:00.000Z",
    "type": "BALANCE_SHEET",
    "form": "hgb.balance-sheet",
    "label": "Balance sheet",
    "closed": false,
    "positions": [
        { "id": "assets", "parentId": null, "depth": 0, "label": "Assets", "amount": "26197", "previousAmount": "18430", "accounts": [] },
        { "id": "assets.B.IV", "parentId": "assets.B", "depth": 2, "label": "Cash on hand, central bank balances, bank balances and checks", "amount": "25821", "previousAmount": "18430", "accounts": [{ "accountId": "0b6d6a7e-61a4-4c2f-9d0e-5f2b8c1e7a90", "number": "1200", "name": "Bank", "amount": "25821" }] }
    ],
    "unmapped": [],
    "result": "950"
}
```

The figures of the year before are those of the same form, from the statement archived at its closing, or from its books while it is open. The first fiscal year of the books has none: its `previousFiscalYearId`, `previousEnd` and every `previousAmount` are null, and its pdfs leave the column empty.

The reports read the entries as they were posted:

- The balances of a fiscal year leave out the entry closing it, so its trial balance and its statements read the same before the closing and after it. The ledger and the journal hold every entry.
- The balance sheet holds the result of the year in the result position of its form, `equity-and-liabilities.A.V`, whether or not the year is closed.
- The balance of a ledger runs within each fiscal year, which opens with the entry of the opening balances.
- The balance sheet and the income statement of a closed fiscal year are those archived at its closing, `FiscalYearStatement` rows, whatever the accounts are mapped to since. A form that was not archived adds up the archived full form. The trial balance, the journal and the ledger read no mapping and are resolved from the entries, which do not change once the year is closed.

The archived statements are kept for the `retention` of the options, from the end of the calendar year the fiscal year ends in, like the journal. Their labels are in the locale the year was closed in.

Every amount is a decimal of the currency of the books, written as a string in JSON. A fiscal year whose year before is open has no opening entry yet, so its balance sheet holds what was posted in it alone.

## Rendering the reports as pdfs
Each report is a pdf as well, in the locale of the request: the same route with `.pdf`, such as `GET /reports/balance-sheet.pdf?fiscalYearId=...`, or the report pdf service, which answers a readable of the finished pdf:

```ts
// src/services/balance-sheet-pdf.function.ts
import { Readable } from 'node:stream';

import { inject } from 'zibri';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from 'zibri/plugin/bookkeeping';

export async function resolveBalanceSheetPdf(fiscalYearId: string): Promise<Readable> {
    return await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.REPORT_PDF_SERVICE).resolveBalanceSheetPdf(fiscalYearId, undefined);
}
```

Each pdf states the `company` of the settings, its seat and its register, above the report, and a statement the figures of the year before beside its own. The balance sheet and the income statement of a closed fiscal year are the pdfs archived at its closing, read through the [archive](../data/archive.md). A pdf is written with [`PdfUtilities`](../templates/document.md), with pdfmake 0.2 or 0.3. The conformances of the fiscal year update the pdf of a balance sheet or an income statement, such as with the note below the balance sheet of a micro corporation. To lay the pdfs out differently, extend `BookkeepingReportPdfService`, override the method of a report, such as `resolveStatementDefinition`, and provide your class under `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.REPORT_PDF_SERVICE`.

## Setting the posting rules
Invoices, credit notes, expenses and bank matches are posted by the posting rules of the fiscal year their day falls into. A rule set names the accounts:

| Rule | What it is |
|---|---|
| `receivablesAccountId` | The account the total of an invoice is posted on. Needed to post invoices |
| `payablesAccountId` | The account the total of an expense is posted on. Needed to post expenses |
| `revenueAccounts` | The revenue account of each VAT `categoryCode` and `rate` of the items of an invoice, such as `S` and `19`, or `E` and `0` for items exempt from VAT |
| `outputTaxAccounts` | The account of the VAT of an invoice of each `rate` |
| `inputTaxAccounts` | The account of the VAT of an expense of each `rate` |
| `paymentDifferenceAccounts` | The account of what of an invoice a payment leaves open within the tolerance of the bank matching, of each `rate`, see [posting bank matches](#posting-bank-matches) |
| `bankAccounts` | The account of the books of each bank account of the bank plugin, by its `bankAccountId` |
| `legalReserveAccountId` | The equity account the legal reserve of a year is credited to, such as that of a UG, see [the legal reserve of a UG](#the-legal-reserve-of-a-ug) |
| `reserveAllocationAccountId` | The equity account the legal reserve of a year is taken from, debited |

`POST /posting-rule-sets` adds the rules of a fiscal year, valid from its first day unless `validFrom` names another day of it:

```bash
curl https://api.example.com/bookkeeping/posting-rule-sets \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'content-type: application/json' \
    -d '{
        "fiscalYearId": "1e7d5c4b-3a21-4f20-9b6a-8d4e3c1f7a52",
        "rules": {
            "receivablesAccountId": "0b6d6a7e-61a4-4c2f-9d0e-5f2b8c1e7a90",
            "payablesAccountId": "9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d",
            "revenueAccounts": [{ "categoryCode": "S", "rate": 19, "accountId": "5e7d6c4b-3a21-4f20-9b6a-8d4e3c1f7a52" }],
            "outputTaxAccounts": [{ "rate": 19, "accountId": "4b3a2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d" }],
            "inputTaxAccounts": [{ "rate": 19, "accountId": "3c1f7a52-8d4e-4b6a-9f20-1e7d5c4b3a21" }],
            "paymentDifferenceAccounts": [{ "rate": 19, "accountId": "2a1b0c9d-8e7f-4a6b-9c5d-4e3f2a1b0c9d" }],
            "bankAccounts": [{ "bankAccountId": "7f6e5d4c-3b2a-4190-8f7e-6d5c4b3a2190", "accountId": "1e7d5c4b-3a21-4f20-9b6a-8d4e3c1f7a52" }]
        }
    }'
```

A document is posted by the rule set of its fiscal year with the latest `validFrom` on or before its day. A second rule set of a year changes the rules from its day on, such as once the VAT exemption of a small business ends within the year: the rules until then post revenue of the VAT category `E` to an account of exempt revenue, and the rules from then the VAT of each rate. `PUT /posting-rule-sets/:id` replaces the rules of a rule set, which post what is posted from then on. Whatever is posted already stays as it was.

Every account a rule names needs to be an account of the books, and each VAT category and rate, rate and bank account is named once, which saving the rules checks: an account that does not exist, or that another tenant has, is refused with a `409`. A document whose rules do not name an account it needs is refused with a `409` naming it, such as `The posting rules valid on 2026-03-01 need to name a revenue account for the VAT S 16 %.`, as is one of a day without a fiscal year or rules.

A fiscal year after another starts with a copy of the rule set valid at the end of that one, valid from its first day, whether you add it or closing the year before creates it.

## Posting invoices and credit notes
An invoice is posted once it is issued: when it is created with an `issuedAt` or a final number, or a draft gets either, see [keeping issued invoices unchanged](./invoicing-plugin.md#keeping-issued-invoices-unchanged). Its entry is posted before the invoice is written, in the transaction of the write, on the day of the invoice in the default time zone of your application:

| Line | Amount |
|---|---|
| Debit `receivablesAccountId` | The total after tax |
| Credit the revenue account of each VAT category and rate | The total before tax of its items |
| Credit the output tax account of each rate | The tax of its items |

The amounts are those of the [invoice calc service](./invoicing-plugin.md#calculating-the-amounts), and the entry has the number of the invoice as its `documentReference` and `invoicing.invoice` as its `sourceType`. An invoice of a VAT category without tax, such as of a small business exempt from VAT, posts the receivables against the revenue alone.

A credit note crediting all of its invoice posts the mirror of the entry of the invoice, as an entry of its own with the credit note as its `sourceType` `invoicing.credit-note`, so the invoice is undone on the same accounts even once the rules changed. A partial credit note posts the mirror of what its own items post as an invoice. Neither is a reversal: [reversing an entry](#reversing-an-entry) corrects a wrong booking, and a credit note is a document of its own.

What the posting refuses, such as an invoice of a day without a fiscal year, refuses the write, so the invoice is not issued. An invoice issued in a transaction that is rolled back posts nothing. A write issuing an invoice without a transaction runs in one of its own, so a write that fails after the posting posts nothing either, see [booking issued invoices](./invoicing-plugin.md#booking-issued-invoices).

## Recording an expense
An expense is an invoice received or a receipt: who issued it, its `documentNumber` and `documentDate`, its `totals` per VAT rate and the account its amounts before tax are posted on. That account is any account of the books: an expense account for the rent, or a liability account for a tax paid, such as the VAT prepayment of a month. `POST /expense-receipts` keeps its document first, as the `file` part of a multipart body:

```bash
curl https://api.example.com/bookkeeping/expense-receipts \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -F 'file=@invoice-office-supplies-r-77.pdf'
```

The receipt is an [archived document](../data/archive.md), kept unchanged in the store `receipts` for 8 years from the end of the year it was uploaded in, which § 147 AO asks of the documents behind the books. An expense without a receipt, such as a bank fee whose document is the statement, names none. `POST /expenses` enters the expense as a draft, naming its receipt:

```bash
curl https://api.example.com/bookkeeping/expenses \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'content-type: application/json' \
    -d '{
        "supplier": { "name": "Office Supplies GmbH", "address": "Main Street 1\n12345 Berlin", "vatId": "DE987654321" },
        "documentNumber": "R-77",
        "documentDate": "2026-03-05",
        "dueDate": "2026-03-19",
        "totals": [{ "rate": 19, "net": "100.00", "tax": "19.00" }],
        "currency": "EUR",
        "accountId": "5e7d6c4b-3a21-4f20-9b6a-8d4e3c1f7a52",
        "receiptId": "0b6d6a7e-61a4-4c2f-9d0e-5f2b8c1e7a90"
    }'
```

A draft is changed with `PUT /expenses/:id` and deleted with `DELETE /expenses/:id`. `POST /expenses/:id/recording` records it, which posts it in the same transaction, on its `documentDate`:

| Line | Amount |
|---|---|
| Debit the `accountId` of the expense | The amounts before tax |
| Debit the input tax account of each rate | The tax of the rate |
| Credit `payablesAccountId` | The total |

The expense keeps the entry as its `postedEntryId`, and the entry has `bookkeeping.expense` as its `sourceType`. A recorded expense is not changed or deleted, through any write of a repository. `POST /expenses/:id/correction` corrects it: a new expense referencing it in `correctsExpenseId` is recorded, and the entry of the one it corrects is reversed on the day of the new document. An expense is corrected once. `createExpense`, `updateExpense`, `recordExpense`, `correctExpense` and `createReceipt` of the expense service do the same from your own code:

```ts
// src/services/record-rent.function.ts
import { BigNumber, inject } from 'zibri';
import { Expense, ExpenseServiceInterface, ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from 'zibri/plugin/bookkeeping';

export async function recordRent(rentAccountId: string): Promise<Expense> {
    const expenses: ExpenseServiceInterface = inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.EXPENSE_SERVICE);
    const draft: Expense = await expenses.createExpense({
        supplier: { name: 'Landlord GmbH' },
        documentNumber: 'L-2026-11',
        documentDate: new Date('2026-11-01T00:00:00.000Z'),
        totals: [{ rate: 0, net: new BigNumber('1200.00'), tax: new BigNumber('0') }],
        currency: 'EUR',
        accountId: rentAccountId
    });
    return await expenses.recordExpense(draft.id);
}
```

Totals of no rate or a rate twice, an amount below 0 and a total of 0 are refused with a `400`, an account that is not one of the books with a `409`.

`GET /expenses?search=R-77` and `findExpenses` of the expense service find the expenses whose document number or supplier name contains a text, whatever its case, such as to pick the expense a bank transaction pays and propose that match, see [confirming a match](./bank-plugin.md#confirming-a-match). A `%` or `_` of the text is the character it is.

## Posting bank matches
With the [bank plugin](./bank-plugin.md#matching-transactions-with-invoices) matching, each match is posted once it is confirmed, in the transaction it is written in, on the day the transaction was booked:

| Match | Lines |
|---|---|
| A payment of an invoice | Debit the account of the bank account, credit the receivables |
| A payment of an expense | Debit the payables, credit the account of the bank account |
| An account, of money received | Debit the account of the bank account, credit the account |
| An account, of money paid | Debit the account, credit the account of the bank account |

The entry has `bank.match` as its `sourceType`. A match leaving an invoice open by at most `paymentDifferenceTolerance` of the matching options, such as a payment 0.01 € short, counts the invoice as paid, and its difference is posted on the debit side as well: it is split by the tax groups of the invoice in proportion to what each holds after tax, and of each part its tax goes off the output tax account of its rate and the rest onto its payment difference account. That corrects the VAT of the invoice, as § 17 UStG asks for a payment that is less. A payment of 221.00 € of an invoice of 100.00 € at 19 % and 100.00 € at 7 % posts:

| Account | Debit | Credit |
|---|---|---|
| Bank | 221.00 | |
| Payment differences 19 % | 2.21 | |
| Output tax 19 % | 0.42 | |
| Payment differences 7 % | 2.21 | |
| Output tax 7 % | 0.16 | |
| Receivables | | 226.00 |

Reversing a match reverses its entry, on the day of the entry, with the match reversing it as its source.

## Matching transactions with accounts
Money that pays no invoice and no expense, such as a deposit of capital or a transfer between your own accounts, is matched with an account of the books. An account match rule names the account and what a transaction has: the IBAN of the counterparty, a text its remittance information or the name of its counterparty holds, in any case, or both. `POST /account-match-rules` adds one:

```bash
curl https://api.example.com/bookkeeping/account-match-rules \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'content-type: application/json' \
    -d '{ "accountId": "4b3a2c1d-0e9f-4a8b-9c7d-6e5f4a3b2c1d", "counterpartyIban": "DE02 1203 0000 0000 2020 51", "text": "capital" }'
```

The bank plugin suggests the account of each rule that applies to a transaction it has not matched in full, with a confidence of 0.5 for each of the two the rule names. A person confirms each of them: the policy of `autoApproveConfidence` never approves a match of an account, whatever its confidence. `DELETE /account-match-rules/:id` removes a rule.

## Choosing what a tenant without books does
A tenant without bookkeeping settings keeps no books in your application, such as a tenant that issues invoices and keeps its books elsewhere. `tenantsWithoutBooks` of the options says what its invoices, expenses and bank matches do, and has no default, as each is what an application may want:

| Value | What a tenant without books does |
|---|---|
| `'post-nothing'` | Issues its invoices, records its expenses and confirms its bank matches without a posting |
| `'refuse'` | Is refused, with a `409`, until its settings are created: `The bookkeeping settings of the tenant need to be created before anything of it is posted.` |
| `'never'` | Does not exist: every tenant is created with its settings, which `resolveSettingsOf` resolves. Required with `'never'`, and taken with it only |

A tenant with settings posts each of them, or is refused what cannot be posted.

With `'never'`, the settings of each tenant of the [entity of the tenants](../data/tenancy.md#declaring-the-tenants) are created in the transaction it is created in, however the repository creates it. What `resolveSettingsOf` throws, or settings the journal service refuses, refuse the tenant, and a tenant rolled back leaves no settings. A corporation is created with its `company` and register, which its conformances need, so the tenant holds what `resolveSettingsOf` reads them from. The entity of the tenants is in the data source of the books:

```ts
// src/bookkeeping-tenants.provider.ts
import { defineProvider, DiProvider } from 'zibri';
import { BookkeepingPluginOptionsInput, NewBookkeepingSettings, ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from 'zibri/plugin/bookkeeping';

export const bookkeepingTenants: DiProvider<BookkeepingPluginOptionsInput> = defineProvider({
    token: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
    useValue: {
        tenantsWithoutBooks: 'never',
        resolveSettingsOf: async (): Promise<NewBookkeepingSettings> => ({
            // the currency, legal form and company of each new tenant
            currency: 'EUR',
            legalForms: [{ legalForm: 'GmbH', validFrom: new Date('2026-01-01T00:00:00.000Z') }],
            company: { name: 'Acme Software GmbH', seat: 'Berlin', registerCourt: 'Amtsgericht Charlottenburg', registerNumber: 'HRB 123456 B' }
        })
    }
});
```

A tenant that is not deactivated and has no settings, such as one created before the application kept books, keeps the application from starting, and the error names each of them. Commands initialize the application without starting it, so a command of your own can create the missing settings, see [commands](../application/commands.md). A tenant is created with its settings as a [write observer](../data/write-observers.md#writing-rows-along-with-a-write) of the entity of the tenants completes its write.

## Posting a source your own way
`postFor` of the posting service posts the entry of a source from your own code, such as an invoice issued before the tenant kept books, in the transaction you pass. It answers undefined for a tenant without books whose sources post nothing:

```ts
// src/services/post-invoice.function.ts
import { inject } from 'zibri';
import { JournalEntryDetails, PostingSourceType, ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from 'zibri/plugin/bookkeeping';
import { Invoice } from 'zibri/plugin/invoicing';

export async function postInvoice(invoice: Invoice): Promise<JournalEntryDetails | undefined> {
    return await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_SERVICE).postFor({ type: PostingSourceType.INVOICE, invoice });
}
```

A source is posted once. Posted again, such as an invoice that a [restore of the tenant](#restoring-a-tenant-that-keeps-books) brought back as a draft and that is issued again, `postFor` answers the entry that stands and posts nothing, as long as that entry posts the same day and the same total as the source does now. It is refused with a `409` when that entry is reversed, or posts other amounts or another day, with a message that points to reversing it and posting the corrected entry with `POST /entries`.

The posting rule service turns a source into its entry. To post a source differently, extend `PostingRuleService` and override the method of the source, such as `resolveExpenseEntry`, and provide your class under `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_RULE_SERVICE`:

```ts
// src/services/app-posting-rule.service.ts
import { Transaction } from 'zibri';
import { BookkeepingSettings, Expense, NewJournalEntry, PostingRuleService } from 'zibri/plugin/bookkeeping';

export class AppPostingRuleService extends PostingRuleService {
    protected override async resolveExpenseEntry(expense: Expense, settings: BookkeepingSettings, transaction: Transaction): Promise<NewJournalEntry | undefined> {
        const entry: NewJournalEntry | undefined = await super.resolveExpenseEntry(expense, settings, transaction);
        // your own text of the entry
        return entry == undefined ? undefined : { ...entry, text: `${expense.supplier.name}, ${expense.documentNumber}` };
    }
}
```

## Holding the books to a law
The plugin knows double-entry bookkeeping and no law. What a law adds, such as the reserve a German UG puts aside from its profit, is a conformance service. Two are registered for you:

| Conformance | `name` | Applies to | What it does |
|---|---|---|---|
| `HgbCorporationConformanceService` | `hgb-corporation` | A German corporation (Kapitalgesellschaft): `GmbH`, `UG`, `AG`, `KGaA` and `SE` | Refuses settings without the company and its register, resolves the size class of § 267 and § 267a HGB and from it the forms of the statements, refuses to close a fiscal year without its `averageEmployees`, and adds the `balanceSheetNote` below the balance sheet of a micro corporation |
| `UgConformanceService` | `ug-legal-reserve` | A `UG` | Refuses posting rules without the accounts of the legal reserve of § 5a (3) GmbHG, proposes its entry at closing, and refuses the closing until it is posted |

A conformance applies to a fiscal year by the legal form the tenant has on its last day, the balance sheet date: a UG that became a GmbH in June is closed as a GmbH, without a legal reserve. A fiscal year that names `conformances` applies those instead, and none for an empty list. A name that is not registered is refused with a `409`.

### The size class of a corporation
`HgbCorporationConformanceService` classifies a corporation on the balance sheet date of a fiscal year by three figures: the balance sheet total of its full balance sheet, the revenue of its full income statement (`income-statement.1`), and the `averageEmployees` of the fiscal year. It is of a size class when it exceeds at most one of its limits, which `HGB_SIZE_CLASS_THRESHOLDS` holds for the fiscal years starting after 2023-12-31:

| Size class | Balance sheet total | Revenue | Employees | Balance sheet | Income statement |
|---|---|---|---|---|---|
| `MICRO`, § 267a HGB | 450,000 € | 900,000 € | 10 | `hgb.balance-sheet.micro` | `hgb.income-statement.micro` |
| `SMALL`, § 267 (1) HGB | 7,500,000 € | 15,000,000 € | 50 | `hgb.balance-sheet.small` | `hgb.income-statement` |
| `MEDIUM`, § 267 (2) HGB | 25,000,000 € | 50,000,000 € | 250 | `hgb.balance-sheet` | `hgb.income-statement` |
| `LARGE`, § 267 (3) HGB | | | | `hgb.balance-sheet` | `hgb.income-statement` |

The size class changes only once a limit is crossed on two consecutive balance sheet dates, § 267 (4) HGB, so a micro corporation above its limits in one year stays one. `resolveSizeClass` of the service answers the size class of a fiscal year. A fiscal year whose size class is needed without its `averageEmployees` is refused with a `409`, as is the default form of its statements and its closing: a form named in the request is answered without it.

The first fiscal year of the books has no balance sheet date before it in the books, so it says what there was: `founded: true` for a company founded in it, which is classified by its own date alone, § 267 (4) sentence 2 HGB, or the `previousSizeClass` it had at the date before, which it keeps for the year, as a change takes two dates. One of them is required: a first fiscal year whose size class is needed without either, or with both, is refused with a `409`.

> [!NOTE]
> The `previousSizeClass` stands for the class the company had and for its figures at that date alike. The revenue is that of the fiscal year, also of a short one, and the books are kept in EUR.

A micro corporation states below its balance sheet what would otherwise be in the notes to its financial statements, § 264 (1) sentence 5 HGB, such as its contingent liabilities. Its pdf in `hgb.balance-sheet.micro` states the `balanceSheetNote` of the fiscal year below it, see [adding fiscal years](#adding-fiscal-years), and nothing for a year without one, which has nothing to state. Set it before the year is closed: the archived pdf holds the note it was closed with.

### The legal reserve of a UG
A UG puts a quarter of its net income for the year, less a loss carried forward from the year before, into its legal reserve, § 5a (3) GmbHG. `UgConformanceService` proposes the entry at closing, on the last day of the fiscal year: the `reserveAllocationAccountId` of the posting rules valid at the end of the year debited, and their `legalReserveAccountId` credited, by the amount rounded up to the cent. The loss carried forward is read from the balances the year starts with on the accounts in `equity-and-liabilities.A.IV` and `equity-and-liabilities.A.V`: those of its opening entry, and those [carried over by hand](#carrying-balances-over-by-hand) against a carry-forward account. Closing a year whose reserve is not posted is refused with a `409` saying what is missing. A year without net income left after the loss needs none.

The posting rules of a fiscal year of a UG name both accounts, see [setting the posting rules](#setting-the-posting-rules): a rule set without them is refused with a `409`, and so is appending the legal form `UG` while an open fiscal year it applies to has such a rule set. `resolveLegalReserve` of the service answers the net income, the loss carried forward, the reserve and what is posted of it. The E-Bilanz of such a year states its balance sheet profit and the allocation in the appropriation of profits, see [appropriating the result](./e-bilanz.md#appropriating-the-result).

### Writing a conformance of your own
Each conformance has a `name`, says with `isApplicable` whether it applies to a legal form, proposes entries at closing with `resolveClosingProposals`, and validates the closing with `validateClosing`. It may resolve the forms of the statements with `resolveStatementForms`, update the pdf of a statement with `updateReportDefinition`, validate the settings of a legal form it applies to with `validateSettings`, the posting rules of a fiscal year it applies to with `validatePostingRules`, and say what it asks of a closed fiscal year with `resolveObligations`, such as [filing the E-Bilanz](./e-bilanz.md#knowing-the-deadline), which `GET /fiscal-years/:id/obligations` and `resolveObligations` of the journal service answer:

```ts
// src/services/clearing.conformance-service.ts
import { $ts, ConflictError } from 'zibri';
import { BookkeepingAccountBalance, BookkeepingClosing, BookkeepingConformanceServiceInterface, NewJournalEntry } from 'zibri/plugin/bookkeeping';

export class ClearingConformanceService implements BookkeepingConformanceServiceInterface {
    readonly name: string = 'clearing-account';

    isApplicable(): boolean {
        return true;
    }

    resolveClosingProposals(): NewJournalEntry[] {
        return [];
    }

    validateClosing(closing: BookkeepingClosing): void {
        const clearing: BookkeepingAccountBalance | undefined = closing.balances.find(b => b.account.number === '1360');
        if (clearing != undefined && !clearing.debit.isEqualTo(clearing.credit)) {
            throw new ConflictError($ts`The clearing account 1360 needs to be zero before the fiscal year is closed.`);
        }
    }
}
```

List the conformance services under `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.BOOKKEEPING_CONFORMANCE_SERVICES`, which holds the two of the HGB by default. A list of your own replaces them, so name them in it as well:

```ts
// src/providers.ts
import { DiProvider, inject } from 'zibri';
import { HgbCorporationConformanceService, UgConformanceService, ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from 'zibri/plugin/bookkeeping';

import { ClearingConformanceService } from './services/clearing.conformance-service';

export const providers: DiProvider<unknown>[] = [
    {
        token: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.BOOKKEEPING_CONFORMANCE_SERVICES,
        useFactory: () => [inject(HgbCorporationConformanceService), inject(UgConformanceService), new ClearingConformanceService()]
    }
];
```

A `BookkeepingClosing` holds the settings of the books, the fiscal year, the legal form, the balances of the year before its closing entry, and the transaction it is closed in, which is undefined while proposals are resolved. A `BookkeepingReportContext` holds the settings, the fiscal year, the legal form, and the transaction to read in, the one of the closing while its statements are archived and undefined otherwise. The first conformance of a fiscal year whose `resolveStatementForms` answers decides its forms. To change what a conformance of the HGB does, such as its `thresholds` or `legalForms`, extend it and list your class in its place.

## Replacing the statement structures
`ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.STATEMENT_STRUCTURES` holds the forms of the statements, `HGB_STATEMENT_STRUCTURES` by default. Provide your own list for the forms of another law: each `BookkeepingStatementStructure` has an `id`, a `type`, a `label`, a `name` telling it from the other forms of its type where one is chosen, its `label` by default, the `positiveBalance` of its positions, and its `positions`, each with an `id`, a `label`, and positions below it or the ids of the positions it `sums`. A shortened structure names the full one it `rollsUpFrom`, and a full balance sheet its `resultPosition`. Labels are English, marked with `$t`, and translated as the [strings of your application](../templates/localization.md):

```ts
// src/statements/cash-statement.ts
import { $t } from 'zibri';
import { BookkeepingStatementStructure, BookkeepingStatementType } from 'zibri/plugin/bookkeeping';

export const CASH_BALANCE_SHEET: BookkeepingStatementStructure = {
    id: 'cash.balance-sheet',
    type: BookkeepingStatementType.BALANCE_SHEET,
    label: $t`Balance sheet`,
    positiveBalance: 'debit',
    resultPosition: 'cash.equity.result',
    positions: [
        { id: 'cash.assets', label: $t`Assets`, positions: [{ id: 'cash.assets.bank', label: $t`Bank` }] },
        {
            id: 'cash.equity',
            label: $t`Equity`,
            positiveBalance: 'credit',
            positions: [{ id: 'cash.equity.capital', label: $t`Capital` }, { id: 'cash.equity.result', label: $t`Result of the year` }]
        }
    ]
};
```

The structures are checked as the application starts: unique ids, sums of positions that exist without a cycle, a shortened structure rolling up from a full one of its type, and the positions accounts are mapped to unique among the full structures. A list without a full structure of a type has no default form of it.

## Keeping the journal
Every `JournalEntry` and `JournalEntryLine` is [archived](../data/archive.md): the repository refuses to change or delete one before its retention ends, and the entries and the lines of each tenant are each a chain of their own. The retention counts from the end of the calendar year the fiscal year of the entry ends in, 10 years by default, which § 147 AO asks of the books. The options set another, beside `tenantsWithoutBooks`:

```ts
// src/bookkeeping-retention.provider.ts
import { defineProvider, DiProvider } from 'zibri';
import { BookkeepingPluginOptionsInput, ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from 'zibri/plugin/bookkeeping';

export const bookkeepingRetention: DiProvider<BookkeepingPluginOptionsInput> = defineProvider({
    token: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
    useValue: { tenantsWithoutBooks: 'refuse', retention: { years: 11 }, receiptStore: 'documents' }
});
```

| Option | What it is |
|---|---|
| `tenantsWithoutBooks` | What a tenant without bookkeeping settings does: `'post-nothing'`, `'refuse'` or `'never'`, see [choosing what a tenant without books does](#choosing-what-a-tenant-without-books-does). Required |
| `resolveSettingsOf` | Resolves the settings each tenant is created with, from the tenant and the transaction it is created in. Required with `'never'`, and taken with it only |
| `retention` | How long each entry and its lines, and each statement archived at a closing, are kept, in whole `years`, `months` and `days`, counted from the end of the calendar year the fiscal year ends in. 10 years by default |
| `receiptStore` | The name of the [file store](../data/files.md#registering-a-file-store) the receipts of expenses are kept in, which `ExpenseReceipt` reads through `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.RECEIPT_FILE_STORE`. `'receipts'` by default |
| `receiptRetention` | How long each receipt and its file are kept, counted from the end of the year it was uploaded in. 8 years by default |

[Pruning the archive](../data/archive.md#pruning-the-archive) deletes the entries, lines and receipts whose retention ended.

## Checking the books
`resolveVerification` of the journal service checks the books of the current tenant: the chain of its entries, the chain of its lines, and that every entry has at least 2 lines whose debits add up to its credits. `GET /verification` answers the same:

```ts
// src/services/check-books.function.ts
import { inject, ZIBRI_DI_TOKENS } from 'zibri';
import { BookkeepingVerification, ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from 'zibri/plugin/bookkeeping';

export async function checkBooks(tenantId: string): Promise<BookkeepingVerification> {
    return await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
        tenantId,
        async () => await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.JOURNAL_SERVICE).resolveVerification()
    );
}
```

```json
{
    "intact": false,
    "newestEntrySequence": null,
    "newestEntryHash": null,
    "newestLineSequence": 1204,
    "newestLineHash": "Xq3sM0v1kF2lYp8T4hJ9cR7nB6wE5aZ1dG0uQ3iO2yU",
    "problems": [
        { "entryId": "7d2e4c1a-5b3f-4a6e-9c8d-1f0e2b3a4c5d", "lineId": null, "reason": "The row is not as it was written." }
    ]
}
```

`problems` names the first entry and the first line where a chain breaks, see [checking a chain](../data/tamper-evident-tables.md#checking-a-chain), and every entry that does not balance. `BookkeepingVerificationCronJob` checks the books of every tenant with settings once a day, and records each problem in the [audit trail](../data/audit.md) of its tenant as `bookkeeping.verification`, with the outcome `failure`, the reason `tampered` and the entry or line as `subject`. It logs where the chains of intact books end.

> [!NOTE]
> A chain alone cannot tell that its newest rows were removed. Keep `newestEntrySequence` and `newestLineSequence` with their hashes outside the data source, such as in your logs, and compare them with the next check.

## Restoring a tenant that keeps books
A [restore of a tenant](../data/backup.md#rows-a-tenant-restore-keeps) resets its invoices, credit notes, expenses, settings, accounts, fiscal years and posting rules to the backup, and the states of its bank transactions to what its matches say. It keeps what is append only or chained as it is now: the entries and their lines, the receipts of expenses, the [archived documents](./invoicing-plugin.md#archiving-issued-invoices) of invoices, and the bank transactions and their matches. It posts, archives and issues nothing.

What was issued, recorded or matched after the backup was taken therefore stays in the books while its source is gone or a draft again. The restore reports each such row in the tenant's audit trail as `backup.tenant.restore-divergence`, and `resolveKeptRowDivergences` of the posting service answers the same of the entries, receipts and expense matches at any time, such as beside `resolveVerification`:

```ts
// src/services/find-kept-divergences.function.ts
import { inject, KeptRowDivergence, ZIBRI_DI_TOKENS } from 'zibri';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from 'zibri/plugin/bookkeeping';

export async function findKeptDivergences(tenantId: string): Promise<KeptRowDivergence[]> {
    return await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
        tenantId,
        async () => await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_SERVICE).resolveKeptRowDivergences()
    );
}
```

Nothing is changed for you. Each is resolved by the books:

| Kept row | Reason | How it is resolved |
|---|---|---|
| `JournalEntry` | `SOURCE_DRAFT`: its invoice, credit note or expense is a draft again | Issue or record it again with the same amounts and day: [posting it again](#posting-a-source-your-own-way) answers the entry kept and posts nothing, and its archived documents stay. If it was not meant to be issued, [reverse the entry](#reversing-an-entry) |
| `JournalEntry` | `SOURCE_MISSING`: its source is gone | Create the source again and issue it, which posts a new entry under its new id, and reverse the kept one; or reverse the kept entry alone when the source was not meant to be |
| `JournalEntry` | `SOURCE_CHANGED`: its source posts other amounts or another day now | Reverse the entry and post the corrected entry with `POST /entries`. Issuing the source again is refused until then and points there |
| `ExpenseReceipt` | `SOURCE_MISSING`: no expense names it | Record the expense again with the receipt, or leave it to its retention. A receipt uploaded and not yet attached is reported too |
| `BankMatch` | `SOURCE_MISSING` or `SOURCE_DRAFT`: what it pays is gone or a draft again | [Reverse the match](./bank-plugin.md#reversing-a-match), which posts the reversal of its entry, and match the transaction again |
| `InvoiceDocument` | `SOURCE_MISSING` or `SOURCE_DRAFT` | Kept as the documents the invoice was sent with. Issuing the invoice again archives nothing new |

## Exporting a fiscal year for a tax audit
In a German tax audit, a company hands the auditor its books as files the audit software reads (Datenüberlassung, § 147 (6) AO). `GET /fiscal-years/:id/export` answers a fiscal year of the tenant as such a zip archive, in the description standard of the German tax administration (Beschreibungsstandard für die Datenüberlassung, in the appendix of the GoBD), which the audit software IDEA reads:

```bash
curl https://api.example.com/bookkeeping/fiscal-years/0b6d6a7e-61a4-4c2f-9d0e-5f2b8c1e7a90/export \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -o gobd-export-2026.zip
```

The file is named after the fiscal year, such as `gobd-export-2026.zip`, or `gobd-export-2025-07-01-2026-06-30.zip` for one that is not a calendar year. The archive is written while it is sent, so neither the rows nor the documents of the year are held in memory. `exportFiscalYear` of the export service writes the same from your own code:

```ts
// src/services/tax-audit-export.function.ts
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { inject, ZIBRI_DI_TOKENS } from 'zibri';
import { BookkeepingExportArchive, ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from 'zibri/plugin/bookkeeping';

export async function writeTaxAuditExport(tenantId: string, fiscalYearId: string, path: string): Promise<void> {
    const archive: BookkeepingExportArchive = await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
        tenantId,
        async () => await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.EXPORT_SERVICE).exportFiscalYear(fiscalYearId, { documents: true })
    );
    await pipeline(Readable.from(archive.content), createWriteStream(path));
}
```

The archive is read in the tenant it was exported in, wherever it is read. An entry posted into an open fiscal year while the archive is read is left out with its lines, so export a fiscal year once it is closed.

| File | What it holds |
|---|---|
| `index.xml` | The description of every CSV file: its columns and their kinds, its primary and foreign keys, the days it is valid for, and a comment saying what checking the books found |
| `fiscal-years.csv` | The fiscal year, with the currency of the books |
| `accounts.csv` | Every account of the books |
| `journal-entries.csv` | Every entry of the fiscal year once, by sequence, with its place and hash in its chain |
| `journal-entry-lines.csv` | Every line of those entries, with the number of its account, its `role`, and its place and hash in its chain |
| `invoices.csv` | The invoices and credit notes the entries were posted from, with their totals and the paths of the pdf and the xml archived at their issue. With the invoicing plugin |
| `expenses.csv` | The expenses the entries were posted from, with the path of their receipts |
| `bank-matches.csv` | The bank matches the entries were posted from, with their transactions. With the bank plugin matching |
| `bank-statements.csv` | The bank statements covering a day of the fiscal year, with the path of their files. With the bank plugin |
| `fiscal-year-statements.csv` | The statements archived at the closing of the fiscal year, with the path of their pdfs |
| `verification.csv` | What checking the books found as the export started, and how many documents could not be read |
| `verification-problems.csv` | Each problem checking the books found, and each document that could not be read |
| `documents/` | The pdfs and the xml of the invoices and credit notes, the receipts, the original files of the bank statements and the pdfs of the archived statements, each read from the first of its [copies](../data/archive.md#keeping-copies-of-the-files) that holds |

The CSV files are in UTF-8, as `index.xml` states, and otherwise in the defaults of the standard: values separated by `;`, text in `"` with a `"` in it doubled, records ended by CRLF, and a header naming the columns, which the audit software skips. Numbers have a decimal comma and no thousands separator, such as `1190,00`, with the decimals of the currency of the books. Days are `DD.MM.YYYY`. A moment, such as when an entry was posted, is text in ISO 8601 and UTC. A line break inside a text is written as a space, as the audit software ends a record at each. The days of an invoice and of a bank transaction are those of the `defaultTimezone` of the [localize options](../templates/localization.md), which they are posted on. The documents of an invoice are those the invoicing plugin archived at its issue, with `archive` of its options, see [archiving issued invoices](./invoicing-plugin.md#archiving-issued-invoices). An invoice issued without has its row alone.

Checking the books covers every fiscal year of the tenant, as a chain holds only as a whole, see [checking the books](#checking-the-books). Books whose chain is broken export as they are: `verification.csv` and `verification-problems.csv` say what does not hold, and so do the comment of `index.xml` and the description of `verification.csv`. A document none of whose copies holds is left out of `documents/` and named in `verification-problems.csv`.

`documents` of the options leaves the documents out, and so does the query parameter of the route, such as `GET /fiscal-years/:id/export?documents=false`. The columns naming them are empty then.

> [!NOTE]
> `index.xml` names its document type definition, `gdpdu-01-09-2004.dtd`, and the archive leaves the file out: CaseWare Germany GmbH, the distributor of IDEA, hands it out free of charge on request at [caseware.net](https://www.caseware.net/), under no license that lets it be passed on. Put it beside `index.xml` when the software reading the archive asks for it.

### Exporting in another format
`ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.EXPORTER` writes the archive, `GdpduBookkeepingExporter` by default. An exporter of your own, such as for an interface a later law asks for, takes the same `BookkeepingExportContent`: the fiscal year, the settings, when it was exported, what checking the books found, and the files, read once and in order. The rows of a table are read before the next file, and each document is a stream to read or destroy:

```ts
// src/bookkeeping/json-lines.exporter.ts
import { MimeType } from 'zibri';
import { BookkeepingExportArchive, BookkeepingExportContent, BookkeepingExporterInterface } from 'zibri/plugin/bookkeeping';

export class JsonLinesExporter implements BookkeepingExporterInterface {
    resolveArchive(content: BookkeepingExportContent): BookkeepingExportArchive {
        return { fileName: 'books.jsonl', mimeType: MimeType.NDJSON, content: this.resolveLines(content) };
    }

    private async* resolveLines(content: BookkeepingExportContent): AsyncGenerator<Buffer> {
        for await (const file of content.files) {
            if (file.kind === 'document') {
                file.content.destroy();
                continue;
            }
            for await (const row of file.rows) {
                yield Buffer.from(`${JSON.stringify({ table: file.name, row })}\n`);
            }
        }
    }
}
```

Provide it in place of the default, in a provider you add to your `providers`:

```ts
// src/bookkeeping-exporter.provider.ts
import { defineProvider, DiProvider } from 'zibri';
import { BookkeepingExporterInterface, ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from 'zibri/plugin/bookkeeping';

import { JsonLinesExporter } from './bookkeeping/json-lines.exporter';

export const bookkeepingExporter: DiProvider<BookkeepingExporterInterface> = defineProvider({
    token: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.EXPORTER,
    useFactory: () => new JsonLinesExporter()
});
```

## Referring to the books in a procedure documentation
A procedure documentation (Verfahrensdokumentation) describes how a company keeps its books and documents, and the GoBD ask one of every company keeping them electronically. Yours describes your application and how the company works with it, and refers to what the plugin holds:

| What | How the plugin holds it |
|---|---|
| Entries are complete and in order | Each entry of a fiscal year is numbered by its `sequence`, from 1 without a gap, drawn in the transaction it is posted in, so an entry rolled back leaves no gap. An entry is posted into an open fiscal year only, with at least 2 lines whose debits add up to its credits, on open accounts |
| Entries are never changed | The repository refuses to change or delete a `JournalEntry` or a `JournalEntryLine`, in every data source. A wrong entry is corrected by its reversal, which references it, once. A closed fiscal year takes no entry until a person reopens it, with a second factor and a reason, which reverses its closing the same way and is recorded in the audit trail, see [reopening a fiscal year](#reopening-a-fiscal-year) |
| What an entry is booked from | Each entry names its document by `documentDate` and `documentReference`, who posted it by `createdBy`, when by `postedAt`, and what created it by `sourceType` and `sourceId`. Each source is posted once |
| A change past the application is told | The entries and the lines of each tenant are each a [hash chain](../data/tamper-evident-tables.md). Checking the books, by `GET /verification` and once a day by `BookkeepingVerificationCronJob`, names the first row that is not as it was written and every entry that does not balance, and records each in the audit trail, see [checking the books](#checking-the-books) |
| Retention | Entries, lines and the statements archived at closing are kept for `retention`, 10 years from the end of the calendar year their fiscal year ends in by default, receipts for `receiptRetention`, 8 years by default, and the documents of issued invoices for `retention` of `archive` of the invoicing options, 8 years from the end of the calendar year of their issue by default. Neither a row nor its file is changed or deleted before, see [archiving documents](../data/archive.md) |
| Documents are kept unchanged | The pdf and the electronic invoice of each invoice and credit note as it was issued, with `archive` of the invoicing options, the receipts of expenses, the original files of bank statements and the pdfs of the statements of a closed fiscal year are archived with their SHA-256, which every read checks, and can be kept in several stores. The document service of the invoicing plugin answers an issued invoice with its archived documents, see [archiving issued invoices](./invoicing-plugin.md#archiving-issued-invoices) |
| Data access in a tax audit | A fiscal year exports with its documents in the description standard of the tax administration, see [exporting a fiscal year for a tax audit](#exporting-a-fiscal-year-for-a-tax-audit) |

What is yours to describe: who holds which permission, how documents reach the application, your backups, and how the servers and the data sources are run.

## Reaching the books of every tenant
Each route takes a permission of `ZIBRI_BOOKKEEPING_PLATFORM_PERMISSIONS` beside its tenant permission, see [accepting a permission of either level](../auth/roles-and-permissions.md#accepting-a-permission-of-either-level). In a request naming no tenant, a caller holding it acts on the books of the tenant the entry, fiscal year, rule set, rule or expense of the route belongs to, and every other route takes the `tenantId` of the books as a query parameter, such as `GET /settings?tenantId=6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f`. A request naming neither is refused with a `400`.

| Platform permission | Lets an operator |
|---|---|
| `bookkeeping.read_all` | Do what `bookkeeping.read` does, for every tenant |
| `bookkeeping.post_all` | Do what `bookkeeping.post` does, for every tenant |
| `bookkeeping.close-fiscal-year_all` | Do what `bookkeeping.close-fiscal-year` does, for every tenant |
| `bookkeeping.reopen-fiscal-year_all` | Do what `bookkeeping.reopen-fiscal-year` does, for every tenant |
| `bookkeeping.manage_all` | Do what `bookkeeping.manage` does, for every tenant |
| `bookkeeping.expenses.manage_all` | Do what `bookkeeping.expenses.manage` does, for every tenant |
| `bookkeeping.export_all` | Do what `bookkeeping.export` does, for every tenant |

## Listing the books
| Route | What it does | Permission |
|---|---|---|
| `GET /settings` | The settings of the books, `404` for a tenant without | `bookkeeping.read` |
| `POST /settings` | Starts the books: `currency`, `legalForms` and `company`, see [starting the books](#starting-the-books) | `bookkeeping.manage` |
| `PATCH /settings` | Changes the settings in one transaction, checked as a whole: `currency` while there is no fiscal year, `legalForm` appended to the history, and `company` replaced whole or removed with `null`, each unchanged when absent. See [starting the books](#starting-the-books) | `bookkeeping.manage` |
| `GET /accounts` | The accounts, by number. Takes `search` for those whose number starts with it or whose name contains it, whatever its case, `open` for those not closed, `true`, or closed, `false`, and `tenantId`, `BookkeepingAccountQueryModel` of `zibri-contract` | `bookkeeping.read` |
| `GET /accounts/:id` | An account, such as the one a bank match is booked against | `bookkeeping.read` |
| `POST /accounts` | Adds an account: `number`, `name`, `type`, `statementPosition` and `creditStatementPosition` | `bookkeeping.manage` |
| `GET /fiscal-years` | The fiscal years, the earliest first | `bookkeeping.read` |
| `POST /fiscal-years` | Adds a fiscal year, see [adding fiscal years](#adding-fiscal-years) | `bookkeeping.manage` |
| `PATCH /fiscal-years/:id` | Changes the `averageEmployees`, `balanceSheetNote`, `founded` or `previousSizeClass` of an open fiscal year | `bookkeeping.manage` |
| `GET /reports/journal` | The journal, see [reading the reports](#reading-the-reports). Takes `from`, `until` and `tenantId` | `bookkeeping.read` |
| `GET /reports/ledger` | The ledger of an account. Takes `accountId`, `from` and `until` | `bookkeeping.read` |
| `GET /reports/trial-balance` | The trial balance of a fiscal year. Takes `fiscalYearId` and `until` | `bookkeeping.read` |
| `GET /reports/balance-sheet` | The balance sheet of a fiscal year. Takes `fiscalYearId` and `form` | `bookkeeping.read` |
| `GET /reports/income-statement` | The income statement of a fiscal year. Takes `fiscalYearId` and `form` | `bookkeeping.read` |
| `GET /reports/revenue` | The revenue of a calendar year. Takes `year` and `tenantId` | `bookkeeping.read` |
| `GET /reports/<report>.pdf` | Each of the reports above as a pdf, with the same parameters, see [rendering the reports as pdfs](#rendering-the-reports-as-pdfs) | `bookkeeping.read` |
| `GET /entries` | A page of the entries with their lines and the entry reversing each, by posting day and sequence, the count of all matching, and the `debit` and `credit` of the lines of all matching, those on the `accountId` alone where it is given, `JournalEntryPageModel` of `zibri-contract`. Takes `page`, `limit` up to 100, `fiscalYearId`, the days `from` and `until`, `accountId` for the entries with a line on it, and `tenantId`, `JournalEntryQueryModel` of `zibri-contract`. A day with a time, an `until` before `from` or an account the books don't have is refused with a `400` | `bookkeeping.read` |
| `POST /entries` | Posts an entry, see [posting an entry](#posting-an-entry) | `bookkeeping.post` |
| `GET /entries/:id` | An entry with its lines | `bookkeeping.read` |
| `POST /entries/:id/reversal` | Reverses an entry, see [reversing an entry](#reversing-an-entry) | `bookkeeping.post` |
| `GET /fiscal-years/:id/statement-forms` | The forms the balance sheet and the income statement of a fiscal year can be shown in, with their names, and the one that applies to each, see [reading the reports](#reading-the-reports) | `bookkeeping.read` |
| `GET /fiscal-years/:id/closing-proposals` | The entries the conformances of a fiscal year propose | `bookkeeping.close-fiscal-year` |
| `GET /fiscal-years/:id/obligations` | What the conformances ask of a closed fiscal year, with their deadlines, such as its [E-Bilanz](./e-bilanz.md) | `bookkeeping.read` |
| `POST /fiscal-years/:id/closing` | Closes a fiscal year, see [closing a fiscal year](#closing-a-fiscal-year) | `bookkeeping.close-fiscal-year` |
| `POST /fiscal-years/:id/reopening` | Reopens a closed fiscal year, with a second factor, see [reopening a fiscal year](#reopening-a-fiscal-year) | `bookkeeping.reopen-fiscal-year` |
| `GET /fiscal-years/:id/export` | Exports a fiscal year as a zip archive, see [exporting a fiscal year for a tax audit](#exporting-a-fiscal-year-for-a-tax-audit). Takes `documents` | `bookkeeping.export` |
| `GET /verification` | Checks the books, see [checking the books](#checking-the-books) | `bookkeeping.read` |
| `GET /posting-rule-sets` | The rule sets, by the day they are valid from. Takes `fiscalYearId` | `bookkeeping.read` |
| `POST /posting-rule-sets` | Adds a rule set, see [setting the posting rules](#setting-the-posting-rules) | `bookkeeping.manage` |
| `PUT /posting-rule-sets/:id` | Replaces the rules of a rule set | `bookkeeping.manage` |
| `GET /account-match-rules` | The account match rules | `bookkeeping.read` |
| `POST /account-match-rules` | Adds an account match rule, see [matching transactions with accounts](#matching-transactions-with-accounts) | `bookkeeping.manage` |
| `DELETE /account-match-rules/:id` | Removes an account match rule | `bookkeeping.manage` |
| `GET /expenses` | A page of the expenses, the latest document first, and the count of all matching. Takes `page`, `limit` up to 100, `search` for those whose document number or supplier name contains it, whatever its case, such as to pick the expense a bank transaction pays, and `tenantId`, `ExpenseQueryModel` of `zibri-contract` | `bookkeeping.read` |
| `GET /expenses/:id` | An expense | `bookkeeping.read` |
| `POST /expenses` | Enters an expense as a draft, see [recording an expense](#recording-an-expense) | `bookkeeping.expenses.manage` |
| `PUT /expenses/:id` | Changes a draft | `bookkeeping.expenses.manage` |
| `DELETE /expenses/:id` | Deletes a draft | `bookkeeping.expenses.manage` |
| `POST /expenses/:id/recording` | Records a draft, which posts it | `bookkeeping.expenses.manage` |
| `POST /expenses/:id/correction` | Corrects a recorded expense by a new one | `bookkeeping.expenses.manage` |
| `POST /expense-receipts` | Keeps the document of an expense, taken as a multipart body | `bookkeeping.expenses.manage` |

Every route answers the books of the tenant of the request alone, and an entry, fiscal year, rule set, rule or expense of another tenant answers `404`. A page holds at most 100 rows.

## Requirements
| Package | Used for |
|---|---|
| `pdfmake` | The pdfs of the reports and of the statements archived at closing, in version 0.2 or 0.3. You install it to close fiscal years and render the reports |

Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `BookkeepingSettings`, `BookkeepingAccount`, `FiscalYear`, `JournalEntry`, `JournalEntryLine`, `PostingRuleSet`, `Expense`, `ExpenseReceipt`, `FiscalYearStatement` | The plugin is registered, all in one data source |
| `FileRecord`, `ChainGap`, `ChainAnchor` | The plugin is registered, for the archived entries, lines and receipts and their files |
| `Invoice` | The invoicing plugin is registered, in the data source of the books |
| `BankMatch`, `AccountMatchRule` | The bank plugin matches transactions, in the data source of the books |
| The entity of the tenants | `tenantsWithoutBooks` is `'never'`, in the data source of the books |

How large each table grows, and what deletes its rows, is in [framework tables](../data/framework-tables.md).

## See also
- [Issuing invoices](./invoicing-plugin.md) — the invoices and credit notes the books post
- [Document generation](../templates/document.md) — the pdfs of the reports, and the versions of pdfmake
- [Importing bank statements](./bank-plugin.md) — the transactions whose matches the books post
- [Archiving documents](../data/archive.md) — how the journal and the receipts are kept, checked and pruned
- [Tamper-evident tables](../data/tamper-evident-tables.md) — the chains of the entries and lines, and checking a chain
- [Files](../data/files.md) — the file store the receipts are kept in
- [Audit trail](../data/audit.md) — where a check that finds a problem records it
- [Plugins](../application/plugin.md) — registering a plugin, and writing your own
- [Filing the E-Bilanz](./e-bilanz.md) — the balance sheet and income statement of each closed fiscal year for the tax administration
- [Tenancy](../data/tenancy.md) — the tenant whose books they are
- [Observing writes](../data/write-observers.md) — how recorded expenses are kept unchanged, and tenants created with their books
