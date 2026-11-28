---
keywords: [camt, camt.053, iso 20022, bank statements, bank import, account statement, kontoauszug, sepa, iban, bank transactions, gobd, reconciliation, payment matching, open items]
---

# Importing bank statements
`ZibriBankPlugin` imports the statements of the bank accounts of a [tenant](../glossary.md#tenant) from CAMT.053 files, the ISO 20022 format every SEPA bank exports its statements in. Each statement keeps its opening and closing balance and its original file, which is [archived](../data/archive.md) for 8 years from the end of its year, and each booked transaction is stored once, however many files hold it. With `matching`, the plugin suggests the invoices the money received pays, and what further matchers match a transaction with, such as the expenses and the accounts of the [bookkeeping plugin](./bookkeeping-plugin.md), as [approval requests](./approval-plugin.md) a person confirms, and approves those it is sure of on its own.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ZibriBankPlugin` | class | The plugin for importing bank statements |
| `BankController` | class | The routes of the bank accounts, statements, transactions and matches, below the path of your controller extending it |
| `ZIBRI_BANK_PLUGIN_DI_TOKENS` | DI token | The tokens of the plugin, see [keeping the original files](#keeping-the-original-files) and [matching transactions with invoices](#matching-transactions-with-invoices) |
| `BankStatementServiceInterface`, `BankStatementService` | interface, class | Imports the statements of a CAMT.053 file with `importStatements`. Replaceable through `ZIBRI_BANK_PLUGIN_DI_TOKENS.BANK_STATEMENT_SERVICE` |
| `BankMatchServiceInterface`, `BankMatchService` | interface, class | Suggests matches of transactions, records those approved, reverses them, answers what is paid of an invoice, lists the transactions with what of each is open and the suggestions of one, and recomputes the states of the transactions. Replaceable through `ZIBRI_BANK_PLUGIN_DI_TOKENS.BANK_MATCH_SERVICE` |
| `BankMatcherInterface`, `BANK_MATCHER_DI_VARIANT` | interface, constant | Matches transactions with targets other than invoices, such as expenses, and the variant its provider is registered with, see [matching transactions with other targets](#matching-transactions-with-other-targets) |
| `BankMatcherTransaction`, `BankMatcherSuggestion`, `BankMatchTarget` | type, type, type | A transaction a matcher is asked about, what it suggests, and a target as it resolves it |
| `BankMatchPostingInterface`, `BANK_MATCH_POSTING_DI_VARIANT` | interface, constant | Books the matches as they are written, such as the bookkeeping plugin, and the variant its provider is registered with |
| `BankMatchUtilities`, `BankMatchCandidate`, `BankMatchScore` | class, type, type | Scores a suggestion by its reasons, a transaction and an invoice as an invoice is scored, and the confidence with its reasons |
| `normalizeIban` | function | Writes an IBAN in capitals and without spaces, as the plugin stores it |
| `BankMatchApprovalAction`, `BANK_MATCH_ACTION_NAME` | class, constant | The approval action `'bank.match'` the suggestions are requests of. Registered for you |
| `BANK_STATEMENT_FILE_STORE_NAME` | constant | `'bank-statements'`, the name of the file store the original files are kept in unless `store` of the options names another |
| `BankAccount`, `BankAccountCreateData` | entity, type | A bank account of a tenant: its `iban`, `name` and `currency`. And what creates one. Stored by `ZibriBankPlugin` |
| `BankStatement` | entity | A statement imported: its account, the id the bank gave it, its period, its opening and closing balance and its original `file`. Archived by `ZibriBankPlugin` |
| `BankTransaction` | entity | A booked transaction of an account: its dates, signed `amount`, counterparty, remittance information and references. Stored by `ZibriBankPlugin` |
| `BankTransactionState`, `BankTransactionStateCreateData` | entity, type | What of a transaction is left to match: its `openAmount` and `status`, with the account, statement and booking date of the transaction, see [keeping what is left to match](#keeping-what-is-left-to-match). And what creates one. Stored by `ZibriBankPlugin` |
| `BankTransactionWriteObserver`, `BankMatchWriteObserver` | class, class | Create the state of each transaction as it is written, and write it again with each match and reversal, in the same transaction. Registered for you |
| `BankTransactionStateCronJob` | cron job | Recomputes the state of every transaction once a day, and logs each that did not hold. Registered for you |
| `BankTransactionStateUtilities` | class | Resolves the state of a transaction from what of it is open |
| `BankTransactionDetails`, `BankTransactionFilter`, `BankTransactionStatus` | class, type, enum | What `GET /transactions` answers of each transaction: the `transaction` and its `openAmount`. Which transactions `findTransactionDetails` answers. And `OPEN` or `MATCHED`, see [reviewing what is left to match](#reviewing-what-is-left-to-match) |
| `BankTransactionSuggestion` | class | A pending suggestion of a transaction, as `GET /transactions/:id/suggestions` answers it: the `requestId`, the target, the `amount`, `confidence` and `reasons`, the `paymentDifference` and the `summary` |
| `BankStatementFile` | type | What `importStatements` takes: the `name` and the `data` of a file, and who `importedBy` |
| `BankStatementImport` | class | What an import answers: the statements stored, and how many statements and transactions were stored and skipped |
| `BankStatementUpload` | class | What `POST /statements` takes: the `file`, as a part of a multipart body |
| `NewBankAccount` | class | What `POST /accounts` takes |
| `BankPluginOptionsInput`, `BankPluginOptions` | type, type | The `store` of the original files, the `retention` of the statements and the `matching` of transactions, via `ZIBRI_BANK_PLUGIN_DI_TOKENS.OPTIONS_INPUT`. Defaults to `bank-statements`, 8 years and no matching |
| `BankMatchingOptions` | type | `autoApproveConfidence` and `paymentDifferenceTolerance`, as `matching` of the options, see [approving matches automatically](#approving-matches-automatically) and [accepting a payment a little short](#accepting-a-payment-a-little-short) |
| `BankMatch`, `BankMatchCreateData` | entity, type | A confirmed match: the `transactionId`, the `targetType` and `targetId` of what it is matched with, the `amount` and `difference`, the match it reverses, the approval request and who confirmed it. Stored by `ZibriBankPlugin` |
| `BankMatchTargetType` | enum | `INVOICE`, `EXPENSE` or `ACCOUNT`: what a transaction is matched with |
| `BankMatchInput`, `BankMatchReason` | class, enum | What `'bank.match'` runs with: the `transactionId`, `targetType`, `targetId`, `amount`, `confidence` and `reasons`. And the reasons, see [scoring a suggestion](#scoring-a-suggestion) |
| `BankMatchFilter` | type | Which matches `findMatches` answers: by `transactionId` and `invoiceId` |
| `ZIBRI_BANK_PERMISSIONS`, `ZibriBankPermissions` | constant, constant | The tenant permissions of the routes, to spread into yours, and the same by name |

`zibri-contract` has the models of the routes for your frontend: `BankAccountModel`, `NewBankAccountModel`, `BankStatementModel`, `BankStatementImportModel`, `BankTransactionModel`, `BankTransactionDetailsModel`, `BankTransactionQueryModel` for the query of `GET /transactions`, `BankTransactionStatus`, `BankTransactionSuggestionModel`, `ArchivedFileModel`, `BankMatchModel`, `BankMatchTargetType`, `BankMatchInputModel` for the input of the requests of `'bank.match'`, `BankMatchReason` and the permissions.

## Setting it up
Add `new ZibriBankPlugin()` to the `plugins` of your application, see [registering a plugin](../application/plugin.md#registering-a-plugin), and `BankAccount`, `BankStatement`, `BankTransaction` and `BankTransactionState` to the `entities` of your data source, beside what an [archived entity](../data/archive.md#archiving-a-type-of-document) needs. You import the names of the plugin from `zibri/plugin/bank`.

The original files are kept in the file store named `bank-statements`, unless `store` of the options names another, see [keeping the original files](#keeping-the-original-files). Register it, of whichever storage you keep your documents in, see [registering a file store](../data/files.md#registering-a-file-store):

```ts
// src/files/bank-statement.file-store.ts
import { FileStore, FsFileStore, FsUtilities } from 'zibri';
import { BANK_STATEMENT_FILE_STORE_NAME } from 'zibri/plugin/bank';

@FileStore()
export class BankStatementFileStore extends FsFileStore {
    constructor() {
        // the folder the files are kept in
        super(BANK_STATEMENT_FILE_STORE_NAME, FsUtilities.getPath('/var/lib/app/bank-statements'));
    }
}
```

Extend `BankController` with a `@Controller` of your own, at the path you choose:

```ts
// src/controllers/bank.controller.ts
import { Controller } from 'zibri';
import { BankController } from 'zibri/plugin/bank';

@Controller('/bank', { versions: 'all' })
export class AppBankController extends BankController {}
```

Add the store and the controller to your application:

```ts
// src/application-options.base.ts
import { OmitStrict, ZibriApplicationOptions } from 'zibri';
import { ZibriBankPlugin } from 'zibri/plugin/bank';

import { AppBankController } from './controllers/bank.controller';
import { BankStatementFileStore } from './files/bank-statement.file-store';

export const baseApplicationOptions: OmitStrict<ZibriApplicationOptions, 'dataSources'> = {
    name: 'Task Tracker',
    baseUrl: 'http://localhost:3000',
    version: '1.0.0',
    environment: 'development',
    plugins: [new ZibriBankPlugin()],
    controllers: [AppBankController],
    fileStores: [BankStatementFileStore],
    websocketControllers: [],
    defaultAuth: 'public',
    twoFactorAtLogin: 'never'
};
```

Spread `ZIBRI_BANK_PERMISSIONS` into your tenant permissions, see [declaring permissions](../auth/roles-and-permissions.md#declaring-permissions), and give them to the roles that keep the books:

```ts
// src/models/permissions.ts
import { DefinedPermissions, definePermissions, ZIBRI_PERMISSIONS } from 'zibri';
import { ZIBRI_BANK_PERMISSIONS } from 'zibri/plugin/bank';

const PERMISSIONS = [...ZIBRI_PERMISSIONS, ...ZIBRI_BANK_PERMISSIONS, 'invoices.read'] as const;

export const Permissions: DefinedPermissions<typeof PERMISSIONS> = definePermissions(PERMISSIONS);
```

| Permission | Lets a member |
|---|---|
| `bank.accounts.manage` | Add the bank accounts of the tenant |
| `bank.statements.import` | Import statements |
| `bank.transactions.read` | List the accounts, the statements and the transactions, and the pending suggestions of a transaction |
| `bank.matches.read` | List the matches of a transaction or an invoice |
| `bank.matches.suggest` | Suggest matches again, and propose a match of their own |
| `bank.matches.confirm` | Approve or reject a suggested match, beside `approval-requests.decide` |

## Adding a bank account
A statement is imported into the bank account of its IBAN, which the tenant adds first. `POST /accounts` adds one:

```bash
curl https://api.example.com/bank/accounts \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'content-type: application/json' \
    -d '{ "iban": "DE89 3704 0044 0532 0130 00", "name": "Business account", "currency": "EUR" }'
```

The IBAN is stored in capitals and without spaces, `DE89370400440532013000`, and is unique among the accounts of a tenant. Two tenants can each have an account of the same IBAN, and a statement is imported into that of the tenant importing it. Your own code adds one with the repository of `BankAccount`, writing the IBAN the same way.

## Importing a statement
`POST /statements` takes a CAMT.053 file as the `file` part of a multipart body:

```bash
curl https://api.example.com/bank/statements \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -F 'file=@statement-2026-11.xml'
```

`importStatements` of the bank statement service imports a file from your own code:

```ts
// src/services/statement-import.function.ts
import { inject } from 'zibri';
import { BankStatementImport, ZIBRI_BANK_PLUGIN_DI_TOKENS } from 'zibri/plugin/bank';

export async function importStatementFile(name: string, data: Buffer): Promise<BankStatementImport> {
    return await inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.BANK_STATEMENT_SERVICE).importStatements({ name, data });
}
```

It takes the transaction to import in as its second argument, of the data source of the plugin's entities. Both read files of the versions `camt.053.001.02` and `camt.053.001.08`. A file can hold several statements, of several accounts. Each statement is stored with its booked transactions, and the answer names what was stored:

```json
{
    "statements": [
        {
            "id": "0b6d6a7e-61a4-4c2f-9d0e-5f2b8c1e7a90",
            "accountId": "3c1f7a52-8d4e-4b6a-9f20-1e7d5c4b3a21",
            "bankStatementId": "S-2026-002",
            "electronicSequenceNumber": 2,
            "periodStart": "2026-11-02T23:00:00.000Z",
            "periodEnd": "2026-11-03T22:59:59.000Z",
            "openingBalance": "1833.01",
            "closingBalance": "2133",
            "currency": "EUR",
            "format": "camt.053.001.08",
            "file": { "name": "statement-2026-11.xml", "mimeType": "application/xml", "size": 4812, "url": null },
            "retainUntil": "2034-12-31T23:00:00.000Z"
        }
    ],
    "skippedStatementCount": 0,
    "transactionCount": 2,
    "skippedTransactionCount": 0
}
```

An amount is a decimal string, negative below zero. A transaction is positive for money received and negative for money paid. Its counterparty is who paid for money received and who was paid for money paid, and a reversal, such as a returned direct debit, keeps the counterparty of the booking it reverses. An entry booking several transactions at once, such as a batch of transfers, is stored as one transaction each when their amounts make up the entry, and as one transaction otherwise. A pending entry is left out, and imported once a later statement books it. Every statement of a file is imported, or none of it:

| A file is refused with | When |
|---|---|
| `400` | It is not a CAMT.053 file of one of the two versions, or a statement of it names no IBAN, has no opening or closing booked balance, or has booked entries that do not add up from its opening to its closing balance |
| `409` | A statement is of an IBAN the tenant has no account of, which the message names, is in another currency than its account, or does not continue the statement before it, see [importing statements in order](#importing-statements-in-order) |

## Skipping what was imported before
Each transaction of an account is stored once, however many files hold it. A transaction is told apart by the reference the bank gave its entry, or by a hash of what it holds when the bank gives none: its dates, amount, counterparty, remittance information and references. Two bookings holding the same, such as two coffees of one price on one day, are two transactions, and the same two of another file are the same two again.

A statement imported before is skipped, by the id the bank gave it. So is a statement holding no transaction that is not stored, such as a daily statement of a period an export of several days covered. Importing the same file twice, or files whose periods overlap, stores each transaction once, and the answer counts what was skipped in `skippedStatementCount` and `skippedTransactionCount`. A transaction is stored with the statement it was first imported with.

## Importing statements in order
Each statement continues the one before it: its opening balance is where the statement imported last for its account closed. A statement whose opening balance does not continue it is refused with a `409`, as a statement between them is missing:

```json
{
    "message": "The statement \"S-2026-003\" of DE89370400440532013000 opens with 2133, and needs to continue the statement \"S-2026-001\", which closed with 1833.01 on 2026-11-02.\nImport the statements between them first."
}
```

Import the missing statement, and then the refused one. A statement whose period overlaps the one before continues it by the bookings both hold. The first statement of an account starts its history, so import the statements of an account from the oldest on. Statements of one file are imported in the order of their opening balances.

## Keeping the original files
Each statement keeps the file it was imported from, in the store `bank-statements` by default, as an [archived document](../data/archive.md): its row and its file are kept unchanged for 8 years from the end of the year the bank created the statement in. A bank statement is a booking document, which § 147 AO keeps for 8 years since the Bürokratieentlastungsgesetz IV of 2025. An update is refused, a delete before `retainUntil` is refused with an `ArchiveRetentionError`, and checking the archive covers the SHA-256 of every file. Once the retention ended, [pruning the archive](../data/archive.md#pruning-the-archive) deletes the statement and its file. Its transactions stay.

The options name another store and another retention, such as the store of your other documents and 10 years:

```ts
// src/providers.ts
import { defineProvider, DiProvider } from 'zibri';
import { ZIBRI_BANK_PLUGIN_DI_TOKENS } from 'zibri/plugin/bank';

export const bankProviders: DiProvider<unknown>[] = [
    defineProvider({
        token: ZIBRI_BANK_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
        useValue: { store: 'documents', retention: { years: 10 } }
    })
];
```

| Option | What it is |
|---|---|
| `store` | The name of the [file store](../data/files.md#registering-a-file-store) the original files are kept in, which `BankStatement` reads through `ZIBRI_BANK_PLUGIN_DI_TOKENS.STATEMENT_FILE_STORE`. `'bank-statements'` by default |
| `retention` | How long each statement and its file are kept, in whole `years`, `months` and `days`, counted from the end of the year the bank created it in. 8 years by default |
| `matching` | Matches the transactions received with invoices, see [matching transactions with invoices](#matching-transactions-with-invoices). No transaction is matched by default |

A statement keeps the `retainUntil` it was imported with, and its file the store it was stored in, when the options change.

`readFile` of the archive service reads the original file of a statement, see [keeping copies of the files](../data/archive.md#keeping-copies-of-the-files).

## Matching transactions with invoices
A match says which invoice of the [invoicing plugin](./invoicing-plugin.md) a transaction of money received pays, and how much of it. The plugin suggests matches, and each suggestion is an [approval request](./approval-plugin.md) a person confirms. Set `matching` in the options, add `ZibriApprovalPlugin` and `ZibriInvoicingPlugin` to the `plugins` of your application, and `BankMatch` to the data source of `ApprovalRequest`:

```ts
// src/providers.ts
import { defineProvider, DiProvider } from 'zibri';
import { ZIBRI_BANK_PLUGIN_DI_TOKENS } from 'zibri/plugin/bank';

export const bankMatchingProviders: DiProvider<unknown>[] = [
    defineProvider({
        token: ZIBRI_BANK_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
        useValue: { matching: { paymentDifferenceTolerance: 0.05 } }
    })
];
```

| Option | What it is |
|---|---|
| `paymentDifferenceTolerance` | The most of an invoice a match may leave open for the invoice to count as paid, in its currency, see [accepting a payment a little short](#accepting-a-payment-a-little-short). `0` leaves every difference open. Required |
| `autoApproveConfidence` | The confidence from which a suggestion is approved without a person, see [approving matches automatically](#approving-matches-automatically). Every suggestion waits for a person by default |

Once an import is committed, each transaction of money received it stored is compared with the open invoices of the tenant in its currency: invoices with an `issuedAt`, whatever their number, no credit notes, and something left to pay after their credit notes and matches. Each invoice it is likely to pay is proposed as a request of the action `'bank.match'`, by the system `bank-matching`:

```json
{
    "action": "bank.match",
    "input": {
        "transactionId": "0b6d6a7e-61a4-4c2f-9d0e-5f2b8c1e7a90",
        "targetType": "INVOICE",
        "targetId": "3c1f7a52-8d4e-4b6a-9f20-1e7d5c4b3a21",
        "amount": "50",
        "confidence": 0.75,
        "reasons": ["INVOICE_NUMBER", "COUNTERPARTY_NAME"]
    },
    "reason": "The payer names the invoice number. The payer has the name of the recipient of the invoice.",
    "summary": "Match €50.00 paid by SIEMENS AG on 11/11/2026 with the invoice 2026-SIEMEN-0002.",
    "proposedBy": "bank-matching",
    "proposedByKind": "SYSTEM",
    "status": "PENDING"
}
```

The `summary` is written once, as the match is proposed, in the locale of the request proposing it, or the `defaultLocale` outside of one, see [resolving the locale of a request](../templates/localization.md#resolving-the-locale-of-a-request). The amount is written as a price in the currency of the transaction and the day of the booking as a date of that locale, see [formatting](../templates/localization.md#formatting): `Match €50.00 paid by SIEMENS AG on 11/11/2026 ...` in `en-US`, `50,00 €, gezahlt von SIEMENS AG am 11.11.2026, der Rechnung 2026-SIEMEN-0002 zuordnen.` in `de-DE`. A currency that is not in `currencyCodes` is written as the bank names it, such as `50 XYZ`.

A suggestion matches what is left of the transaction or of the invoice, whichever is less. A transaction paying several invoices gets a suggestion for each, the most likely first, until its amount is used up. An invoice paid in parts gets one for each part. What a pending suggestion matches counts as used on both sides, so two suggestions never claim the same money. What the invoices leave of a transaction, of money received or paid, is offered to the [matchers of other targets](#matching-transactions-with-other-targets).

The suggestions are made after the import, in the same request. One that fails is logged, and leaves the import as it was stored.

Without `matching`, an application with the approval plugin knows the action `'bank.match'` too, and refuses every proposal of it with a `409`: `This application does not match bank transactions with invoices.`

## Scoring a suggestion
Each suggestion has a `confidence` from 0 to 1, the sum of its `reasons`:

| Reason | When | Adds |
|---|---|---|
| `INVOICE_NUMBER` | The remittance information or the end-to-end id names the invoice number | 0.6 |
| `AMOUNT` | What is left of the transaction is what is left of the invoice | 0.25 |
| `COUNTERPARTY_NAME` | The name of the payer is the name of the recipient of the invoice | 0.15 |
| `COUNTERPARTY_IBAN` | The account of the payer paid an invoice of the same recipient before | 0.15 |
| `DOCUMENT_NUMBER` | The remittance information or the end-to-end id names the document number of an expense | 0.6 |
| `ACCOUNT_RULE` | An account match rule names the counterparty or the text of the transaction | 0.5 for each of the two it names |

`DOCUMENT_NUMBER` and `ACCOUNT_RULE` are the reasons of the matchers of the bookkeeping plugin, which score an expense the way an invoice is scored, by its document number, its amount and the name of its supplier. The payer adds 0.15 once, by its name or its account. An invoice below 0.4 is not suggested: the invoice number alone is enough, and so are the amount and the payer together. A transaction naming the number of an invoice and paying all of it, from an account of the recipient, scores 1.

The number is found as a word of its own, with or without its separators: `2026 SIEMEN 0002` and `2026SIEMEN0002` name `2026-SIEMEN-0002`, and `2026-SIEMEN-00021` does not. A name matches when every word of the company name of the recipient, without its legal form such as `GmbH` or `AG`, is a word of the name of the payer, or the last name of a private recipient is. Case and accents do not count.

## Confirming a match
A suggestion is decided like every approval request, through the routes of your [approval request controller](./approval-plugin.md#approving-and-rejecting). Approving it takes `bank.matches.confirm` and `approval-requests.decide`, and records a `BankMatch`, which is the `result` of the decision:

```json
{
    "id": "7d2e9f10-5a4b-4c3d-9e8f-1a2b3c4d5e6f",
    "transactionId": "0b6d6a7e-61a4-4c2f-9d0e-5f2b8c1e7a90",
    "targetType": "INVOICE",
    "targetId": "3c1f7a52-8d4e-4b6a-9f20-1e7d5c4b3a21",
    "amount": "50",
    "difference": null,
    "currency": "EUR",
    "reversesMatchId": null,
    "requestId": "9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d",
    "confirmedBy": "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b",
    "confirmedByKind": "USER",
    "confirmedAt": "2026-11-16T09:30:00.000Z"
}
```

Approving checks again what is left of the transaction and of the invoice, one match of a tenant at a time. A match above either leaves the request `FAILED`, with the error, such as once another transaction paid the invoice meanwhile: `A match of the invoice 2026-SIEMEN-0002 needs to be at most 0 EUR, what of it is open.` Approving a suggestion of an invoice that changed since it was proposed is refused with a `409`, see [approving and rejecting](./approval-plugin.md#approving-and-rejecting). A user with `bank.matches.suggest` proposes a match of their own with `POST /` of the approval requests, naming the `transactionId`, `targetType`, `targetId` and `amount` as its `input`, `BankMatchInputModel` of `zibri-contract`.

A transaction can pay several invoices and an invoice can be paid by several transactions, each with a match of its own. The invoicing plugin reads what is paid of an invoice from the matches, see [reading what of an invoice is paid](./invoicing-plugin.md#reading-what-of-an-invoice-is-paid). With the [bookkeeping plugin](./bookkeeping-plugin.md#posting-bank-matches), each match is posted in the transaction it is written in, and a match that cannot be posted is refused.

## Accepting a payment a little short
A customer paying a little less than the invoice, such as 0.01 € short, leaves a difference nobody collects. A match leaving an invoice open by at most `paymentDifferenceTolerance` of `matching` records what it leaves as its `difference`, and the invoice counts as paid: its `paid` is the amount and the difference together, and nothing of it is open. The bookkeeping plugin posts the difference to the payment difference accounts and corrects the VAT of the invoice, see [posting bank matches](./bookkeeping-plugin.md#posting-bank-matches). A match leaving more than the tolerance leaves the rest of the invoice open, for a further payment or a credit note.

## Reversing a match
A match is kept for good, and a wrong one is undone by a match reversing it. `POST /matches/:id/reversal` records one, of the negative amount and difference, with `reversesMatchId` naming the match:

```bash
curl -X POST https://api.example.com/bank/matches/7d2e9f10-5a4b-4c3d-9e8f-1a2b3c4d5e6f/reversal \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f'
```

What it reversed is open again on both sides, and suggested again. A match is reversed once, and a reversal is not reversed: both are refused with a `409`. It takes `bank.matches.confirm`, records the user as `confirmedBy`, and names no approval request. `reverseMatch` of the bank match service does the same from your own code, in the transaction you pass. With the bookkeeping plugin, the entry of the match is reversed in the same transaction.

## Matching transactions with other targets
A matcher matches transactions with a type of target other than an invoice: `BankMatcherInterface` with the `targetType` it matches, `resolveSuggestions` answering what the transactions left by the invoices may be matched with, each with the open amount of its target and a score, and `resolveTarget` resolving a target a match is about to be confirmed with, refusing one the transaction cannot be matched with. Register it with a provider of the variant `BANK_MATCHER_DI_VARIANT`, see [providing a value](../application/di.md#providing-a-value). The bookkeeping plugin registers two:

| Target | Matched with | Suggested by |
|---|---|---|
| `EXPENSE` | Money paid, of a recorded expense in its currency | Its document number, its amount and the name of its supplier |
| `ACCOUNT` | Money received or paid, booked against an account of the books, such as a deposit of capital | The account match rules, see [matching transactions with accounts](./bookkeeping-plugin.md#matching-transactions-with-accounts) |

A match of an account is always confirmed by a person.

## Approving matches automatically
`autoApproveConfidence` of `matching` approves the suggestions of at least that confidence without a person:

```ts
// src/providers.ts
import { defineProvider, DiProvider } from 'zibri';
import { ZIBRI_BANK_PLUGIN_DI_TOKENS } from 'zibri/plugin/bank';

export const bankAutoApprovingProviders: DiProvider<unknown>[] = [
    defineProvider({
        token: ZIBRI_BANK_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
        useValue: { matching: { autoApproveConfidence: 0.95, paymentDifferenceTolerance: 0.05 } }
    })
];
```

| Option | What it is |
|---|---|
| `autoApproveConfidence` | The confidence from which a suggestion is approved by a policy, above 0 and at most 1. Every suggestion waits for a person by default |

The [policy](./approval-plugin.md#approving-automatically) is named `confidence-at-least-0.95`, which the decision and the match record as who confirmed it, with `confirmedByKind` `POLICY`. It approves the suggestions of the system alone, so a match a user proposes waits for a person, whatever confidence it names. It never approves a match of an account, which books money that pays no document.

## Suggesting matches again
`POST /matches/suggestions` suggests matches for every transaction received that is not matched in full, such as once the invoice of a payment is created after its statement was imported. `suggestMatches` of the bank match service does the same from your own code, for the transactions you pass or all of them:

```ts
// src/services/bank-matching.function.ts
import { inject } from 'zibri';
import { ApprovalRequestDetails } from 'zibri/plugin/approval';
import { ZIBRI_BANK_PLUGIN_DI_TOKENS } from 'zibri/plugin/bank';

export async function suggestBankMatches(): Promise<ApprovalRequestDetails[]> {
    return await inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.BANK_MATCH_SERVICE).suggestMatches();
}
```

Both answer the requests they proposed. A transaction and an invoice with a pending request are not suggested again, and neither are those a person rejected. A suggestion that expired or failed is made again, for what is left.

## Reviewing what is left to match
`GET /transactions` answers each transaction with its `openAmount`: its amount without its sign, less its confirmed matches, so a reversal opens again what it reverses. `status` narrows the list to the transactions with something left to match, `OPEN`, or to those matched in full, `MATCHED`, and the page counts every one of them:

```bash
curl 'https://api.example.com/bank/transactions?page=1&limit=20&status=OPEN&from=2026-11-01&until=2026-11-30' \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f'
```

```json
{
    "items": [
        {
            "transaction": { "id": "0b6d6a7e-61a4-4c2f-9d0e-5f2b8c1e7a90", "amount": "119", "currency": "EUR", "counterpartyName": "SIEMENS AG" },
            "openAmount": "69"
        }
    ],
    "totalAmount": 1
}
```

`from` and `until` are days, such as `2026-11-30`, and a booking at any time of `until` is on it. A day with a time, and an `until` before `from`, are refused with a `400`. The list is read from the stored state of each transaction, see [keeping what is left to match](#keeping-what-is-left-to-match). Without `matching`, every transaction is open by its amount.

`GET /transactions/:id/suggestions` answers the pending suggestions of a transaction, the most likely first, each with the `requestId` the [approval request routes](./approval-plugin.md#approving-and-rejecting) approve or reject it by:

```json
[
    {
        "requestId": "9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d",
        "targetType": "INVOICE",
        "targetId": "3c1f7a52-8d4e-4b6a-9f20-1e7d5c4b3a21",
        "amount": "1189.99",
        "confidence": 0.75,
        "reasons": ["INVOICE_NUMBER", "COUNTERPARTY_NAME"],
        "paymentDifference": "0.01",
        "summary": "Match €1,189.99 paid by SIEMENS AG on 11/20/2026 with the invoice 2026-SIEMEN-0001."
    }
]
```

`paymentDifference` is what approving it would record as the `difference` of the match, from what of the invoice is open now, see [accepting a payment a little short](#accepting-a-payment-a-little-short). It is null for no difference, and for every target other than an invoice. A transaction of another tenant is answered with a `404`, and without `matching` a transaction has no suggestions. `findTransactionDetails` and `findSuggestions` of the bank match service do the same from your own code.

## Keeping what is left to match
A transaction and its matches are kept as they were written, so what of a transaction is left to match is kept beside it, as a `BankTransactionState`: its `openAmount` and its `status`, `OPEN` until the open amount is zero and `MATCHED` from then on. A state is created with each transaction, open by its whole amount, in the transaction the transaction is written in, however it is written, such as by an import. It is written again with each match and each reversal of one, in the transaction of the match, so a match rolled back leaves it as it was. Matches of a tenant are written one at a time, so matches written at once leave it as their amounts add up.

Each state is derived from its transaction and its matches. `recomputeTransactionStates` of the bank match service recomputes it from them, of the transactions you pass or of every one of the tenant, writes each state that differs or is missing, and answers those it wrote. `BankTransactionStateCronJob` does so for every tenant once a day, and logs each state it wrote as an error, as a state only differs once something wrote around the plugin, such as a row changed by hand in the database.

The state is in the data source of `BankTransaction`, and with `matching`, `BankMatch` is too.

A [backup](../data/backup.md) holds the states with the rest of the data. A restore of a tenant brings back its states and keeps its transactions and matches as they are, as they are append only, so the instance that restored recomputes the states of every tenant once the restore is done. A match it keeps whose invoice it took away or made a draft again is reported, see [rows a tenant restore keeps](../data/backup.md#rows-a-tenant-restore-keeps), and `resolveKeptRowDivergences` of the bank match service answers those at any time. [Reverse such a match](#reversing-a-match) and match the transaction again.

## Listing statements and transactions
| Route | What | Permission |
|---|---|---|
| `POST /accounts` | Adds an account: `iban`, `name` and `currency` | `bank.accounts.manage` |
| `GET /accounts` | The accounts of the tenant, by name | `bank.transactions.read` |
| `POST /statements` | Imports a CAMT.053 file, see [importing a statement](#importing-a-statement) | `bank.statements.import` |
| `GET /statements` | A page of the statements, the latest period first. Takes `page`, `limit` and `accountId` | `bank.transactions.read` |
| `GET /transactions` | A page of the transactions with what of each is open, the latest booking first, and the count of all matching. Takes `page`, `limit`, `accountId`, `statementId`, the days `from` and `until` of the booking and `status`, `BankTransactionQueryModel` of `zibri-contract`, see [reviewing what is left to match](#reviewing-what-is-left-to-match) | `bank.transactions.read` |
| `GET /transactions/:id/suggestions` | The pending suggestions of a transaction, see [reviewing what is left to match](#reviewing-what-is-left-to-match) | `bank.transactions.read` |
| `GET /matches` | A page of the matches, the latest confirmed first. Takes `page`, `limit`, `transactionId` and `invoiceId` | `bank.matches.read` |
| `POST /matches/suggestions` | Suggests matches again, see [suggesting matches again](#suggesting-matches-again) | `bank.matches.suggest` |
| `POST /matches/:id/reversal` | Reverses a match, see [reversing a match](#reversing-a-match) | `bank.matches.confirm` |

Every route answers the accounts, statements, transactions and matches of the tenant of the request alone. A page holds at most 100 rows.

## Requirements
Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `BankAccount`, `BankStatement`, `BankTransaction`, `BankTransactionState` | The plugin is registered. `BankTransactionState` in the data source of `BankTransaction` |
| `FileRecord`, `ChainGap`, `ChainAnchor` | The plugin is registered, for the archived statements and their files |
| `BankMatch` | `matching` of the options is set. In the data source of `ApprovalRequest` and `BankTransaction` |
| `Invoice`, `ApprovalRequest`, `ApprovalDecision` | `matching` of the options is set, for the invoices matched and the suggestions |

How large each table grows, and what deletes its rows, is in [framework tables](../data/framework-tables.md).

## See also
- [Approving actions](./approval-plugin.md) — the requests the suggestions are, and deciding them
- [Issuing invoices](./invoicing-plugin.md) — the invoices matched, and what of each is paid
- [Keeping the books](./bookkeeping-plugin.md) — the expenses and accounts matched, and posting the matches
- [Archiving documents](../data/archive.md) — how statements and their files are kept, checked and pruned
- [Files](../data/files.md) — the file stores the original files are kept in
- [Plugins](../application/plugin.md) — registering a plugin, and writing your own
- [Tenancy](../data/tenancy.md) — the tenant an account belongs to
