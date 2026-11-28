---
keywords: [e-bilanz, ebilanz, § 5b estg, elster, eric, xbrl, hgb taxonomy, taxonomie, kerntaxonomie, gcd, stammdaten, mussfeld, summenmussfeld, nil, kontennachweis, account level detail, anlagenspiegel, statement of changes in fixed assets, steuerbilanz, einheitsbilanz, bundesfinanzamtsnummer, steuernummer, tax office, filing deadline, abgabefrist, § 149 ao, myebilanz, transmission protocol, übertragungsprotokoll]
---

# Filing the E-Bilanz
`ZibriEBilanzPlugin` states the books of the [bookkeeping plugin](./bookkeeping-plugin.md) as the E-Bilanz: the content of the balance sheet and the income statement a German company keeping balance sheets files with the tax administration every fiscal year, § 5b EStG. It is stated in the HGB taxonomy of XBRL Deutschland e.V., a list of positions with mandatory ones (Mussfelder) and calculation rules, published each year in a new version. The plugin maps each account of a closed fiscal year to a position of the version the year needs, lists the accounts under each position (Kontennachweis), states NIL for each position the tax administration asks for that the books cannot fill, and adds the statement of changes in fixed assets (Anlagenspiegel) and the company data of the GCD module. It checks the E-Bilanz before anything is filed, keeps a record of its preparation and filing, archived for 10 years, and asks for it once a fiscal year is closed, with its deadline. A transmitter you provide sends it, or a person files an export by hand and records it. Nothing is sent without a person asking for it.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ZibriEBilanzPlugin` | class | The plugin for the E-Bilanz, beside `ZibriBookkeepingPlugin` |
| `EBilanzController` | class | The routes of the E-Bilanz, below the path of your controller extending it |
| `EBilanzConformanceService` | class | Asks for the E-Bilanz of each closed fiscal year of a corporation, with its deadline. Listed by you in `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.BOOKKEEPING_CONFORMANCE_SERVICES`. Required |
| `ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS` | DI token | The tokens of the plugin: its options, the versions of the taxonomy, their adapters, the service and the file store |
| `E_BILANZ_TRANSMITTER_DI_VARIANT`, `EBilanzTransmitterInterface` | constant, interface | The variant of the one transmitter that sends the E-Bilanz, and what it implements. None is registered for you |
| `E_BILANZ_EXPORTER_DI_VARIANT`, `EBilanzExporterInterface` | constant, interface | The variant of the exporters writing the E-Bilanz as a file to file by hand, and what each implements. None is registered for you |
| `XbrlEBilanzExporter` | class | Writes the E-Bilanz as the XBRL instance document of its version of the taxonomy, named `xbrl`. Registered by you with `E_BILANZ_EXPORTER_DI_VARIANT` |
| `EBilanzServiceInterface`, `EBilanzService` | interface, class | Prepares, exports and sends the E-Bilanz, keeps its records and the certificate. Replaceable through `ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.E_BILANZ_SERVICE` |
| `GermanBookkeepingCompany`, `GermanCompanyAddress`, `GermanCompanyShareholder`, `EBilanzSender` | class, class, class, class | The company the E-Bilanz states: the `BookkeepingCompany` with its legal form, tax number, tax office, address, business, tax advisor, sender and shareholders. Registered by you as the company model of the bookkeeping settings. Required |
| `ZIBRI_E_BILANZ_PERMISSIONS`, `ZibriEBilanzPermissions` | constant, constant | The [tenant](../glossary.md#tenant) permissions of the routes, to spread into yours, and the same by name |
| `ZIBRI_E_BILANZ_PLATFORM_PERMISSIONS`, `ZibriEBilanzPlatformPermissions` | constant, constant | The platform permissions of the routes, for the E-Bilanz of every tenant, and the same by name |
| `EBilanzPluginOptions` | type | The `store` the certificates and protocols are kept in, the `receiptStore` of the bookkeeping plugin by default, and the `transmissionTimeoutInMs` a transmitter may take, 30 minutes by default, via `ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.OPTIONS_INPUT` |
| `EBilanzTaxonomy`, `E_BILANZ_TAXONOMIES`, `HGB_TAXONOMY_6_9`, `HGB_TAXONOMY_6_10` | type, constant, constant, constant | A version of the taxonomy as data, the versions shipped, and each of them |
| `EBilanzTaxonomyStatements`, `EBilanzStatementName`, `EBilanzTaxonomyPositionRow`, `EBilanzTaxonomyColumnRow`, `EBilanzTaxonomyFieldRow`, `EBilanzRequirement` | type, type, type, type, type, type | The statements of a version, their names, a position, a column of the statement of changes in fixed assets and a field of the GCD module as data, and `M`, `S` or `R`, what the tax administration asks |
| `EBilanzTaxonomyChange`, `EBilanzTaxonomyStatementChange` | type, type | A version stated as what it changes of the one before it |
| `EBilanzTaxonomyPosition`, `EBilanzTaxonomyUtilities` | type, class | A position resolved from its row, and the versions as data: resolving, picking the version of a fiscal year, checking them |
| `EBilanzTaxonomyAdapterInterface`, `Hgb6EBilanzTaxonomyAdapter`, `EBilanzTotal`, `EBilanzFieldContext`, `EBilanzAppropriationPositions`, `EBilanzBusinessAssetComparisonPositions` | interface, class, type, type, type, type | What a structure of the taxonomy needs beside its data, that of the versions 6.x, a total checked against the books, what the fields of the GCD module are resolved from, the positions a balance sheet after the partial appropriation of the result is stated by, and those of the [comparison of business assets](#comparing-the-business-assets) |
| `EBilanzContent`, `EBilanzPosition`, `EBilanzAccount`, `EBilanzField` | class, class, class, class | An E-Bilanz, a position with its amount or NIL and its accounts, an account of the account level detail, and a field of the GCD module |
| `EBilanzFixedAsset`, `EBilanzFixedAssetValue`, `EBilanzFixedAssetInput`, `EBilanzFixedAssetInputValue` | class, class, class, class | A row of the statement of changes in fixed assets, a value of a column, and the figures of a row the books do not hold |
| `EBilanzAccountingStandard`, `EBilanzIncomeStatementForm` | enum, enum | `UNIFIED` or `TAX`, which balance sheet it states, and `TOTAL_COST` or `MICRO`, the form of the income statement |
| `EBilanzRevisionStatus` | enum | `ORIGINAL`, or how a correction corrects the E-Bilanz filed before |
| `EBilanzPreparationInput`, `EBilanzPreparation`, `EBilanzFinding` | class, class, class | What preparing takes beside the books, the content with what it needs, and something it needs, naming the position |
| `EBilanzBooks`, `EBilanzAccountBalance`, `EBilanzResultLine`, `EBilanzEquityLine`, `EBilanzUtilities` | type, type, type, type, class | What an E-Bilanz is resolved from, what an account holds in the year, a line of the closing carrying the result into equity, a line of an entry on the equity, and the resolution and checks themselves |
| `EBilanzDeadlineUtilities` | class | The deadline of an E-Bilanz, § 149 AO |
| `EBilanzFiling`, `EBilanzFilingCreateData`, `EBilanzFilingKind` | entity, type, enum | A record of the E-Bilanz of a fiscal year, what creates one, and `PREPARED`, `TEST_TRANSMISSION`, `TRANSMISSION` or `MANUAL_FILING`. Archived by `ZibriEBilanzPlugin` |
| `EBilanzSettings`, `EBilanzSettingsCreateData`, `EBilanzSettingsView` | entity, type, class | The certificate of a tenant, what creates it, and what the routes answer of it. Stored by `ZibriEBilanzPlugin` |
| `EBilanzAccountMapping`, `EBilanzAccountMappingCreateData`, `EBilanzAccountMappingInput` | entity, type, class | An account mapped to a position of its own, what creates one, and what `PUT /account-mappings/:accountId` takes. Stored by `ZibriEBilanzPlugin` |
| `EBilanzState`, `EBilanzExporterInfo` | class, class | The E-Bilanz of a fiscal year with its records, deadline and how it can be filed, and an exporter it can be downloaded with |
| `EBilanzCertificateUpload`, `EBilanzProtocolUpload` | class, class | What `PUT /settings/certificate` and `POST /fiscal-years/:id/manual-filing` take as a multipart body |
| `EBilanzCertificate`, `EBilanzTransmissionOptions`, `EBilanzTransmission` | type, type, type | The certificate a transmitter signs with, how it sends with the `signal` of its timeout, and what it answers |
| `EBilanzNotSentError` | error | Thrown by a transmitter that knows nothing reached the tax administration |
| `EBilanzTransmissionStatus`, `EBilanzTransmissionSummary`, `EBilanzTransmissionFailure` | enum, class, class | Where a transmission stands, a transmission with the record of its result, and what a transmitter failed with |
| `EBilanzFile`, `EBilanzExport` | type, type | A file uploaded or written, and the E-Bilanz an exporter wrote |

`zibri-contract` has the models of the routes for your frontend, such as `EBilanzStateModel`, `EBilanzContentModel`, `EBilanzFilingModel`, `GermanBookkeepingCompanyModel`, `EBilanzPreparationInputModel`, `EBilanzFilingKind` and the permissions.

## Setting it up
Add `new ZibriEBilanzPlugin()` beside the bookkeeping plugin, see [setting it up](./bookkeeping-plugin.md#setting-it-up), and `EBilanzSettings`, `EBilanzAccountMapping` and `EBilanzFiling` to the data source of the books. List `EBilanzConformanceService` among the conformances of the books, beside those of the HGB:

```ts
// src/e-bilanz-conformances.provider.ts
import { DiProvider, EBilanzConformanceService, HgbCorporationConformanceService, inject, UgConformanceService, ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from 'zibri';

export const eBilanzConformances: DiProvider<unknown> = {
    token: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.BOOKKEEPING_CONFORMANCE_SERVICES,
    useFactory: () => [inject(HgbCorporationConformanceService), inject(UgConformanceService), inject(EBilanzConformanceService)]
};
```

The application refuses to start with the plugin and without the conformance, as no fiscal year would ask for its E-Bilanz then. Register `GermanBookkeepingCompany`, or a class extending it, as the company of the bookkeeping settings, see [the company model](./bookkeeping-plugin.md#the-company-model):

```ts
// src/company-model.provider.ts
import { BookkeepingCompany, DiProvider, GermanBookkeepingCompany, Newable, ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from 'zibri';

export const companyModel: DiProvider<Newable<BookkeepingCompany>> = {
    token: ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.COMPANY_MODEL,
    useValue: GermanBookkeepingCompany
};
```

The application refuses to start with the plugin and another company model, as the bookkeeping settings would not hold what the E-Bilanz states then. Extend `EBilanzController` with a `@Controller` of your own:

```ts
// src/controllers/e-bilanz.controller.ts
import { Controller, EBilanzController } from 'zibri';

@Controller('/e-bilanz', { versions: 'all' })
export class AppEBilanzController extends EBilanzController {}
```

Spread `ZIBRI_E_BILANZ_PERMISSIONS` into your tenant permissions, see [declaring permissions](../auth/roles-and-permissions.md#declaring-permissions):

| Permission | Lets a member |
|---|---|
| `bookkeeping.e-bilanz.read` | Read the E-Bilanz of a fiscal year, its records, when the certificate was uploaded and the account mappings |
| `bookkeeping.e-bilanz.prepare` | Prepare and export the E-Bilanz |
| `bookkeeping.e-bilanz.transmit` | Send the E-Bilanz as a test and for real, and record it as filed by hand |
| `bookkeeping.e-bilanz.manage` | Upload the certificate and map accounts |

The certificates and the protocols are kept in the `receiptStore` of the bookkeeping plugin, unless `store` of `ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.OPTIONS_INPUT` names another [file store](../data/files.md#registering-a-file-store).

## Entering the company
The E-Bilanz states the company of the [bookkeeping settings](./bookkeeping-plugin.md#starting-the-books), with more than its statements do: a `GermanBookkeepingCompany` is the `BookkeepingCompany` with what the GCD module of the taxonomy asks of a corporation. Registered as the company model, it is what `POST /settings` and `PATCH /settings` of the bookkeeping controller take and validate as the `company`. A `company` of `PATCH /settings` replaces the company whole:

```bash
curl -X PATCH https://api.example.com/bookkeeping/settings \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'content-type: application/json' \
    -d '{
        "company": {
            "name": "Acme Software GmbH", "seat": "Berlin", "registerCourt": "Amtsgericht Charlottenburg", "registerNumber": "HRB 123456 B",
            "legalStatus": "GmbH", "taxNumber": "1121081508150", "taxOfficeNumber": "1121",
            "address": { "street": "Hauptstraße", "houseNumber": "1", "postalCode": "10115", "city": "Berlin", "country": "DE" },
            "business": "Software development", "taxAdvisor": false
        }
    }'
```

| Property | What it is |
|---|---|
| `legalStatus` | The legal form as the GCD module names it, such as `GmbH` or `UG`. Required |
| `taxNumber` | The tax number in the 13 digit format of ELSTER. Required |
| `taxOfficeNumber` | The 4 digit number of the tax office (Bundesfinanzamtsnummer). Required |
| `economicId` | The economic identification number (W-IdNr.), `DE` and 9 digits, a `-` and 5 digits. None by default |
| `address` | The street, house number, postal code, city and ISO country code of the seat. Required |
| `business` | What the company does (Geschäftstätigkeit). Required |
| `taxAdvisor` | Whether a tax advisor prepares the tax return, which gives it the later deadline. Required |
| `sender` | Who sends the E-Bilanz (Datenlieferant), its name, address, phone and email. The company itself by default |
| `shareholders` | Each shareholder with its `name`, `taxNumber`, `taxId`, `legalStatus` and `share`. None by default |

A company entered before the German company was registered holds none of these, and the E-Bilanz names it among its findings until a `company` of `PATCH /settings` enters them.

## Mapping the accounts to the taxonomy
Each account reports as a position of the taxonomy by the position of the statements of the books it is mapped to, see [mapping accounts to the statements](./bookkeeping-plugin.md#mapping-accounts-to-the-statements). `Hgb6EBilanzTaxonomyAdapter` maps each position of the full statements of the HGB to a position of the versions 6.x: the one stating the same, or where the taxonomy breaks a position down further, its part that is not broken down (nicht zuordenbar), such as `assets.B.IV` to `bs.ass.currAss.cashEquiv.misc`. The self-created intangible assets, the deferred taxes and the difference of offsetting plan assets have no position in a tax balance sheet, so an account on them needs a mapping of its own.

### Mapping an account of its own
`PUT /account-mappings/:accountId` maps an account to a position of its own, such as the revenue at 19 % to the revenue of the general rate of VAT, and `creditPosition` names the position it reports as while its balance is a credit:

```bash
curl -X PUT https://api.example.com/e-bilanz/account-mappings/5e7d6c4b-3a21-4f20-9b6a-8d4e3c1f7a52 \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'content-type: application/json' \
    -d '{ "position": "is.netIncome.regular.operatingTC.grossTradingProfit.totalOutput.netSales.grossSales.generalRateVAT" }'
```

`DELETE /account-mappings/:accountId` removes it, and the account reports by its statement position again. A position is named by its element name in the taxonomy; the positions of a version are in its `statements`, each with its German label. An account mapped to a position that sums others, to one of the other statement, or to one the version does not have, is named among the findings.

## Preparing the E-Bilanz
The E-Bilanz states a closed fiscal year, see [closing a fiscal year](./bookkeeping-plugin.md#closing-a-fiscal-year). `POST /fiscal-years/:id/preview` answers it as the books state it, with its findings, and keeps nothing. `POST /fiscal-years/:id/preparation` prepares it: refused with a `409` naming each finding while it has any, and otherwise archived as a record, which an export and a transmission send:

```bash
curl https://api.example.com/e-bilanz/fiscal-years/1e7d5c4b-3a21-4f20-9b6a-8d4e3c1f7a52/preparation \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'content-type: application/json' \
    -d '{ "accountingStandard": "unified" }'
```

| Property | What it is |
|---|---|
| `accountingStandard` | `unified` for the commercial balance sheet that is the tax balance sheet as well (Einheitsbilanz), `tax` for a tax balance sheet of its own the books state. Required |
| `taxonomyVersion` | The version of the taxonomy, which needs to allow the fiscal year. The version the fiscal year needs to be stated in by default |
| `fixedAssets` | The figures of the statement of changes in fixed assets the books do not hold, each `position` with the `amount` of each `column`. None by default |
| `revisionStatus` | How it corrects the E-Bilanz filed before, see [preparing the correction](#preparing-the-correction). Required once the fiscal year is filed, `original` before |

The E-Bilanz holds:

- each account with a balance, the debits less the credits of the year without its closing entry, under its position, positive on the side the position counts
- the result of the year in `bs.eqLiab.equity.netIncome`, as the balance sheet of the books holds it, while the year carries the whole result forward, with each account a line of the closing entry with the `role` `result` books it to as its account, with the part that line carries. Such an account is listed twice when it holds a balance of its own, such as a profit carried forward: with its balance under its own position, and with the result under this one. A year whose result position holds accounts appropriating part of it, such as the allocation to the legal reserve of a UG, is stated as drawn up after the partial appropriation of the result (§ 268 (1) HGB), see [appropriating the result](#appropriating-the-result)
- each position summing others with the sum of those stated, and NIL for each position the tax administration asks for (`M` or `S`) at the top of the balance sheet and the income statement or below a position stated. NIL says the books do not state it, which is not 0
- the income statement of a micro corporation, `ismi.*`, when the conformances of the year state its statements in the forms of a micro corporation, with the positions of the full income statement it adds up
- a row of the statement of changes in fixed assets for each position of the fixed assets with accounts: the additions of the year from the books, the acquisition costs and the depreciation at the start as 0 for accounts without an opening balance, the figures `fixedAssets` names, each column summing others as the sum of its parts, and NIL for the rest. The sums are the acquisition costs at the end (`gross`), the accumulated depreciation at the end (`accDepr`) and the book value at the end (`all`), `gross` less `accDepr` plus the write-ups (`revaluation`), which needs to equal the position in the balance sheet. Each position above such a row, up to `bs.ass.fixAss`, has a row as well, such as `bs.ass.fixAss.tan` for the office equipment: each column the sum of that column of the rows of the positions it sums, NIL where none of them states it, and its book value the position in the balance sheet too. Each row names the row it is summed into as its `parent`, null for `bs.ass.fixAss`. A group without accounts below it, such as `bs.ass.fixAss.fin`, has no row, `M` and `S` ones included: the tax administration asks for the columns of the positions stating a value (B.14.12.1 a of its technical guide), and from 6.10 on takes a row of a position that is neither `M` nor `S` only with a value (B.14.12.1 k)
- the steuerlicher Betriebsvermögensvergleich (BVV), the `BVV.*` positions with the `statement` `businessAssetComparison`, see [comparing the business assets](#comparing-the-business-assets)
- the fields of the GCD module: the period, the company with the country of its seat by its German name, such as `Deutschland` for `DE`, its tax numbers and shareholders, and the parts of the report

Each finding names a position, a field or the number of an account as its `position`. Its `message` says in the language of the request what is wrong, and where it is clear, what to change. It names a position by its label and an account by its number and name, and states each amount in euro, such as `The balance sheet does not balance: the assets total €33,700.00, and the equity and liabilities €33,800.00.`:

| Finding | When |
|---|---|
| An account `needs a position` | It has a balance and neither a mapping of its own nor a statement position the adapter maps |
| The balance sheet `does not balance` | `bs.ass` and `bs.eqLiab` differ, such as by an account without a position |
| A position `needs to equal the sum of the positions below it` | A position states another amount than those it sums |
| `bs.eqLiab.equity.netIncome` `needs to equal the result of the income statement` | An account mapped to a position of its own moves part of the result outside the appropriation of profits |
| `bs.eqLiab.equity.profitLoss` `needs to equal the balance sheet profit the appropriation of profits ends with` | An account of the balance sheet profit is mapped to a position of its own the appropriation does not count |
| `BVV.profitLoss` `needs to equal the result of the income statement` | The result of the comparison of business assets differs from `is.netIncome` or `ismi.netIncome`, such as by an account of the result outside the equity |
| A total `needs to equal` a position of the statements archived at the closing | The mapping states another total than the statements of the books, such as an account mapped since |
| The statement of changes in fixed assets `needs its acquisition costs at the start of the year` | A position of the fixed assets with accounts that had an opening balance, and no figures for it |
| A row of the statement of changes in fixed assets `ends with a book value` that `needs to equal` the balance sheet | The books credit an account of the position with a depreciation or a disposal of the year that `fixedAssets` does not name, such as in `accDepr.DeprPeriod.regular`. A row of a position above it names the same, for the rows below it |
| A column of the statement of changes in fixed assets `needs to equal the sum of the columns it adds up` | `fixedAssets` names a figure for a column summing others, such as `gross`, that is not the sum of theirs |
| The E-Bilanz `needs the company it states` | The bookkeeping settings hold no company, or one entered before the German company was registered |

> [!NOTE]
> The account level detail (Kontennachweis) is mandatory for the fiscal years starting after 2024-12-31, § 5b (1) EStG. Every position with an amount and no position below it lists its accounts with their numbers, names and balances, the result of the year each account the closing books part of it to.

## Appropriating the result
A UG puts a quarter of its net income into its legal reserve, § 5a (3) GmbHG, which the [UG conformance](./bookkeeping-plugin.md#the-legal-reserve-of-a-ug) proposes on the allocation account of the posting rules, an equity account in `equity-and-liabilities.A.V`. Its balance sheet is then drawn up after the partial appropriation of the result, § 268 (1) HGB, and the E-Bilanz states it so for you, whenever an account without a mapping of its own has a balance in `equity-and-liabilities.A.V`:

| Position | What it states |
|---|---|
| `bs.eqLiab.equity.profitLoss` | The balance sheet profit or loss (Bilanzgewinn / Bilanzverlust): the accounts of `equity-and-liabilities.A.IV` and `.A.V` and the result of the year. `bs.eqLiab.equity.netIncome` and `bs.eqLiab.equity.retainedEarnings` are NIL |
| `incomeUse.gainLoss.netIncome` | The result of the year |
| `incomeUse.gainLoss.retainedEarningsPrevYear`, `incomeUse.gainLoss.accumLossPrevYear` | Each account of `equity-and-liabilities.A.IV`, by whether it carries a profit or a loss forward |
| `incomeUse.gainLoss.additionRevenReserves.legalRes` | The `reserveAllocationAccountId` of the posting rules valid at the end of the year |
| `incomeUse.gainLoss.additionOtherRes`, `incomeUse.gainLoss.releaseOtherRes` | Each other account of `equity-and-liabilities.A.V`, by whether it puts into or takes from the reserves |
| `incomeUse.gainLoss` | The balance sheet profit or loss the appropriation ends with, which needs to equal `bs.eqLiab.equity.profitLoss` |

The GCD module says the balance sheet states the balance sheet profit, and that the E-Bilanz holds the appropriation of profits. A year that carries its whole result forward states the net income for the year and no appropriation of profits. An account mapped to a position of its own is stated there instead.

## Comparing the business assets
The steuerlicher Betriebsvermögensvergleich (BVV) states the result of the year a second time: the equity at the end of the year, less that at the end of the year before, plus the distributions and less the contributions of the year. The tax administration asks for it with every income statement, whatever the legal form. The E-Bilanz states it from the books for you, and the GCD module names it among the parts of the report (`BVV`).

The equity it compares is that of each account whose position, by its mapping or its statement position, is in `bs.eqLiab.equity` or `bs.ass.deficitNotCoveredByCapital`, an account without a balance at the end of the year included:

| Position | What it states |
|---|---|
| `BVV.profitLoss` | The result of the year: the sum of the positions below it, which needs to equal `is.netIncome`, or `ismi.netIncome` for the income statement of a micro corporation |
| `BVV.profitLoss.assetsCurrentYear` | The equity at the end of the year: `bs.eqLiab.equity` less `bs.ass.deficitNotCoveredByCapital` |
| `BVV.profitLoss.assetsPreviousYear` | `assets` plus `capAdjustments` |
| `BVV.profitLoss.assetsPreviousYear.assets` | The equity at the end of the year before, as the opening entry of the year and the balances carried over against a carry-forward account state it. 0 in a year with neither, such as a first fiscal year |
| `BVV.profitLoss.assetsPreviousYear.capAdjustments` | 0 |
| `BVV.profitLoss.withdrawalDistrib` | The distributions of the year: each entry whose lines on the equity add up to a debit, with that debit |
| `BVV.profitLoss.contribution` | The contributions of the year: each entry whose lines on the equity add up to a credit, with that credit |

Each entry of the year counts but the opening and the closing entry. An entry within the equity, such as the allocation to the legal reserve or the result carried forward, adds up to 0 and counts as neither. The capital paid in during a first fiscal year is a contribution of it. A distribution from the profit carried forward, the profit carried forward debited and the bank or a liability to the shareholders credited, is a distribution.

The balances of books kept elsewhere before are [carried over by hand](./bookkeeping-plugin.md#carrying-balances-over-by-hand) against a carry-forward account, such as `9000` to `9090` of the SKR 03 and SKR 04: an equity account in no position. An entry with a line on such an account carries the balances before the year in, as an opening entry does: what its lines on the equity add up to is part of `assets`, and neither a contribution nor a distribution. The statement of changes in fixed assets reads what an account of the fixed assets holds at the start of the year the same way, so an asset carried over is not an addition of the year.

```json
{
    "positions": [
        { "name": "BVV.profitLoss", "statement": "businessAssetComparison", "parent": null, "amount": "1500.00" },
        { "name": "BVV.profitLoss.assetsCurrentYear", "statement": "businessAssetComparison", "parent": "BVV.profitLoss", "amount": "30300.00" },
        { "name": "BVV.profitLoss.assetsPreviousYear", "statement": "businessAssetComparison", "parent": "BVV.profitLoss", "amount": "33800.00" },
        { "name": "BVV.profitLoss.assetsPreviousYear.assets", "statement": "businessAssetComparison", "parent": "BVV.profitLoss.assetsPreviousYear", "amount": "33800.00" },
        { "name": "BVV.profitLoss.assetsPreviousYear.capAdjustments", "statement": "businessAssetComparison", "parent": "BVV.profitLoss.assetsPreviousYear", "amount": "0.00" },
        { "name": "BVV.profitLoss.withdrawalDistrib", "statement": "businessAssetComparison", "parent": "BVV.profitLoss", "amount": "5000.00" },
        { "name": "BVV.profitLoss.contribution", "statement": "businessAssetComparison", "parent": "BVV.profitLoss", "amount": "0.00" }
    ]
}
```

Each position also has its `label`, its `requirement`, and its `accounts`, which are empty for the BVV. This is the second year of a GmbH that distributed 5,000.00 of the profit of its first year and made 1,500.00.

## Exporting and filing by hand
An exporter writes the latest preparation as a file of one format, which a person files with another program. `GET /fiscal-years/:id/export?exporter=<name>` downloads it, refused with a `409` while the books state the E-Bilanz otherwise than it was prepared. Provide each exporter with `E_BILANZ_EXPORTER_DI_VARIANT`:

```ts
// src/e-bilanz/json.e-bilanz-exporter.ts
import { EBilanzContent, EBilanzExporterInterface, MimeType } from 'zibri';

export class JsonEBilanzExporter implements EBilanzExporterInterface {
    readonly name: string = 'json';
    readonly mimeType: MimeType = MimeType.JSON;
    readonly fileExtension: string = 'json';

    resolveFile(eBilanz: EBilanzContent): Buffer {
        return Buffer.from(JSON.stringify(eBilanz));
    }
}
```

```ts
// src/e-bilanz-exporter.provider.ts
import { DiProvider, E_BILANZ_EXPORTER_DI_VARIANT, InjectionToken } from 'zibri';

import { JsonEBilanzExporter } from './e-bilanz/json.e-bilanz-exporter';

export const eBilanzExporter: DiProvider<JsonEBilanzExporter> = {
    token: new InjectionToken<JsonEBilanzExporter>('app.e_bilanz.json_exporter'),
    useFactory: () => new JsonEBilanzExporter(),
    variants: [E_BILANZ_EXPORTER_DI_VARIANT]
};
```

### Downloading the XBRL
XBRL is the format the tax administration takes the E-Bilanz in: an instance document stating each value as a fact of a concept of the taxonomy, for a period (its context) and in a unit. `XbrlEBilanzExporter` writes it for the version the E-Bilanz is stated in. Register it with `E_BILANZ_EXPORTER_DI_VARIANT`:

```ts
// src/xbrl-e-bilanz-exporter.provider.ts
import { DiProvider, E_BILANZ_EXPORTER_DI_VARIANT, InjectionToken, XbrlEBilanzExporter } from 'zibri';

export const xbrlEBilanzExporter: DiProvider<XbrlEBilanzExporter> = {
    token: new InjectionToken<XbrlEBilanzExporter>('app.e_bilanz.xbrl_exporter'),
    useFactory: () => new XbrlEBilanzExporter(),
    variants: [E_BILANZ_EXPORTER_DI_VARIANT]
};
```

`GET /fiscal-years/:id/export?exporter=xbrl` downloads it as `application/xml`, named after the fiscal year, such as `e-bilanz-2026-01-01-2026-12-31.xbrl`. It references the entry points of a tax filing of its version, such as `de-gaap-ci-2025-04-01-shell-fiscal.xsd`, or `de-gaap-ci-2025-04-01-shell-fiscal-microbilg.xsd` for the income statement of a micro corporation, and `de-gcd-2025-04-01-shell.xsd`. Each context names the company by its tax number. The document states:

| Part | As |
|---|---|
| The GCD module | Each field, a field the taxonomy offers a choice for as the item chosen, the tax numbers and each shareholder in a tuple, and NIL for a field without a value |
| The positions | The balance sheet on its last day, the income statement, the appropriation of profits and the comparison of business assets for the fiscal year, each amount in euro to two decimals, and NIL as nil |
| The account level detail | A `detailedInformation.accountBalances` tuple for each account of a position, with the position, the number, the name and the balance of the account. From 6.10 on, a position of the balance sheet or the income statement with an amount and neither an account nor a position below it, such as the result of a closing that names no account, gets one tuple with `notPossible` true and the number and name NIL. The appropriation of profits and the comparison of business assets get none |
| The statement of changes in fixed assets | The tax balance sheet values of each row, the positions above those with accounts included, with the sums at the end of the year and the book value, and NIL for each column the tax administration asks for without a figure |

The exporter writes the versions whose adapter is `hgb-6`, and refuses the E-Bilanz of another version.

> [!NOTE]
> The document is well formed, names only concepts of its version, and declares each context and unit it references. Whether the tax administration takes it is decided by ERiC, which checks rules of its own, such as the check digit of the tax number and the accounts of each position. The program you file it with runs those checks, and a test transmission does.

Once filed, `POST /fiscal-years/:id/manual-filing` records it, with the transmission protocol as the `protocol` part of a multipart body, which is archived with the record:

```bash
curl https://api.example.com/e-bilanz/fiscal-years/1e7d5c4b-3a21-4f20-9b6a-8d4e3c1f7a52/manual-filing \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -F 'protocol=@transmission-protocol-2026.pdf'
```

## Sending the E-Bilanz
A transmitter sends the E-Bilanz to the tax administration, such as through ERiC with a manufacturer id of your own. None is registered for you: provide one `EBilanzTransmitterInterface` with `E_BILANZ_TRANSMITTER_DI_VARIANT`. It gets the content prepared and the ELSTER certificate of the tenant, and answers whether the transmission was accepted, the id ERiC gave it (its TransferTicket), its protocol and the messages of the tax administration:

```ts
// src/e-bilanz/office.e-bilanz-transmitter.ts
import { EBilanzContent, EBilanzNotSentError, EBilanzTransmission, EBilanzTransmissionOptions, EBilanzTransmitterInterface } from 'zibri';

export class OfficeEBilanzTransmitter implements EBilanzTransmitterInterface {
    readonly name: string = 'office';

    async transmit(eBilanz: EBilanzContent, options: EBilanzTransmissionOptions): Promise<EBilanzTransmission> {
        if (!options.certificate.file.length) {
            throw new EBilanzNotSentError('The certificate is empty.');
        }
        // your own transmission, signed with options.certificate and stopped once options.signal aborts
        const ticket: string = `${eBilanz.fiscalYearId}-${options.test ? 'test' : 'real'}`;
        return await Promise.resolve({ succeeded: true, ticket, protocol: null, messages: [] });
    }
}
```

```ts
// src/e-bilanz-transmitter.provider.ts
import { DiProvider, E_BILANZ_TRANSMITTER_DI_VARIANT, InjectionToken } from 'zibri';

import { OfficeEBilanzTransmitter } from './e-bilanz/office.e-bilanz-transmitter';

export const eBilanzTransmitter: DiProvider<OfficeEBilanzTransmitter> = {
    token: new InjectionToken<OfficeEBilanzTransmitter>('app.e_bilanz.transmitter'),
    useFactory: () => new OfficeEBilanzTransmitter(),
    variants: [E_BILANZ_TRANSMITTER_DI_VARIANT]
};
```

A second transmitter keeps the application from starting. `PUT /settings/certificate` keeps the certificate of the tenant, the `.pfx` file as the `certificate` part of a multipart body and its `pin`, which is stored encrypted, see [encryption and hashing](../data/encryption-and-hashing.md). No route answers either.

| Route | What it does |
|---|---|
| `POST /fiscal-years/:id/test-transmission` | Sends the latest preparation as a test, which the tax administration does not keep |
| `POST /fiscal-years/:id/transmission` | Sends it for real, with a [second factor](../auth/two-factor.md) given again for the request |

Each route answers `202` with the record of the transmission started, whose `status` is `transmitting`, and calls the transmitter once in the background: a transmission can take minutes, far longer than a request may. The result is recorded as a record of its own, which names the first as its `transmissionId`, with who sent it, the id it was given, its messages and its protocol. A record answers its protocol as a `FileReference`, whose `url` downloads it from `GET /:id/files/protocol`.

A transmission is refused with a `409` without a transmitter or a certificate, while the books state the E-Bilanz otherwise than it was prepared, once it is filed as prepared, for real until a test of the same content was accepted, while another transmission or a filing by hand of the fiscal year runs, on any instance, and while one of the same kind has a result that is not known. Only these routes send: no cron job, observer or service of the framework calls the transmitter, and none sends a transmission again.

> [!WARNING]
> Whoever holds the certificate and its PIN signs for the company, and a renewal in Mein ELSTER makes every copy of the old file invalid. Upload a certificate of its own for the application, and a new one after each renewal.

### Waiting for the result
A frontend polls `GET /fiscal-years/:id` after sending, every few seconds, until the transmission in its `transmissions` with the `id` the route answered has a `status` other than `transmitting`. Each transmission has its `status`, whether it is a `test`, whether it `mayHaveBeenSent`, who started it and when, and the record of the `result` its status is from:

| `status` | What it means |
|---|---|
| `transmitting` | Started, without a result yet |
| `accepted` | The tax administration accepted it. One sent for real files the E-Bilanz |
| `refused` | The tax administration refused it, with its `messages` |
| `failed` | The transmitter threw, with the `error` of the record: its `name`, `message` and `paragraphs`. `mayHaveBeenSent` is false only for an `EBilanzNotSentError` |
| `unknown` | Not known: the transmitter took longer than `transmissionTimeoutInMs`, or the instance sending it stopped. It may have reached the tax administration |
| `not-received` | A person confirmed that it did not reach the tax administration |

A transmitter that answers after its timeout has its answer recorded all the same, and the transmission takes its status. A running transmission holds a [lease](../glossary.md#lease) on its fiscal year, which its instance renews. A transmission without a result whose instance stopped holds none, and is recorded as `unknown` the next time the records are read. One still running on another instance is left alone.

### Telling what was not sent
A transmitter throws `EBilanzNotSentError` when it knows nothing reached the tax administration, such as when the certificate could not be read or the program sending it never started. The transmission is `failed` with `mayHaveBeenSent` false, and can be sent again. Any other error records it as one that may have been sent. Pass what failed as the `cause` of the error: the record keeps its `paragraphs`, and those of each cause below it.

The `signal` of `EBilanzTransmissionOptions` aborts once the transmission took longer than `transmissionTimeoutInMs` of `ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.OPTIONS_INPUT`, 30 minutes by default. A transmitter stops what it runs there.

### Settling a transmission whose result is not known
A transmission that is `unknown`, or `failed` and may have been sent, keeps one of its kind from being sent, as the E-Bilanz may be filed already. Check it in ELSTER, then either record the E-Bilanz as filed by hand, see [exporting and filing by hand](#exporting-and-filing-by-hand), or confirm that it did not arrive:

```bash
curl -X POST https://api.example.com/e-bilanz/fiscal-years/1e7d5c4b-3a21-4f20-9b6a-8d4e3c1f7a52/transmission-not-received \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'x-authorization-otp: 123456'
```

It records each such transmission as `not-received`, takes a second factor given again like the transmission for real, and answers the records written. Without such a transmission it is refused with a `409`.

## Correcting a filed fiscal year
The books of a closed fiscal year are corrected by [reopening it](./bookkeeping-plugin.md#reopening-a-fiscal-year), which `EBilanzConformanceService` validates first. A fiscal year whose E-Bilanz is filed, by an accepted transmission or by hand, is reopened only with `forCorrection: true`, and one that is not filed only without it. A reopening is refused with a `409` while a transmission of the fiscal year runs, and while one has a result that is not known, see [settling a transmission whose result is not known](#settling-a-transmission-whose-result-is-not-known).

```bash
curl https://api.example.com/bookkeeping/fiscal-years/1e7d5c4b-3a21-4f20-9b6a-8d4e3c1f7a52/reopening \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'x-authorization-otp: 123456' \
    -H 'content-type: application/json' \
    -d '{ "reason": "Depreciation of the office equipment missing", "forCorrection": true }'
```

Once reopened, the fiscal year is open, and the books state the E-Bilanz otherwise than it was prepared: it is not sent or exported until the year is closed again and the E-Bilanz prepared again. Every record of before stays archived.

### Preparing the correction
A correction of a filed E-Bilanz (Berichtigung, § 153 AO) is a preparation of its own, whether the books were reopened or only what lies outside them changed, such as an account mapping or the company. It states in its `revisionStatus` how it corrects the E-Bilanz filed before, which the GCD module carries as `genInfo.report.id.revisionStatus`. A preparation of a filed fiscal year needs it, and one of a fiscal year not filed is refused with it, with a `409`:

| `revisionStatus` | When | In the XBRL |
|---|---|---|
| `original` | The first E-Bilanz of the fiscal year (erstmalig). The status while it is not filed, and by default | `E` |
| `corrected` | The balance sheet corrects an error, § 4 (2) sentence 1 EStG (berichtigt) | `B` |
| `changed` | The balance sheet changes a choice it made, § 4 (2) sentence 2 EStG (geändert) | `G` |
| `corrected-and-changed` | Both (berichtigt und geändert) | `BG` |
| `more-detail` | The same accounts with more detail, such as the account level detail added | `I` |
| `other-correction` | A correction outside the balance sheet and the income statement only (sonstige Korrektur) | `sK` |

```bash
curl https://api.example.com/e-bilanz/fiscal-years/1e7d5c4b-3a21-4f20-9b6a-8d4e3c1f7a52/preparation \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'content-type: application/json' \
    -d '{ "accountingStandard": "unified", "revisionStatus": "corrected" }'
```

The record of the preparation names the filing it corrects in `correctsFilingId`: the latest accepted transmission for real or filing by hand. The correction is a content of its own, so it is sent as a test first, and once it is filed it is not sent again, like the E-Bilanz it corrects.

## Reading the E-Bilanz of a fiscal year
`GET /fiscal-years/:id` answers an `EBilanzState`: the content of the latest preparation, what the E-Bilanz needs as the books state it now with what that preparation took, every record, each transmission with where it stands, whether the latest preparation is current, whether it is filed, its `deadline`, whether a transmitter and a certificate are there and, if not, `transmitterUnavailableReason` saying what enables them, and the exporters. A frontend disables sending with that reason.

## Knowing the deadline
`EBilanzConformanceService` applies to a `GmbH`, `UG`, `AG`, `KGaA` or `SE`, which keep balance sheets by their legal form. A fiscal year of another company keeping them names the conformance `e-bilanz` in its `conformances`. Once a fiscal year is closed, `GET /fiscal-years/:id/obligations` of the [bookkeeping controller](./bookkeeping-plugin.md#listing-the-books) answers its E-Bilanz with its `dueOn` and `fulfilledAt`, set once it is transmitted or recorded as filed by hand. The E-Bilanz is filed with the tax return of the calendar year the fiscal year ends in:

| Company | Deadline |
|---|---|
| Without a tax advisor | 31 July of the year after, § 149 (2) AO |
| With a tax advisor | The last day of February of the second year after, § 149 (3) AO |

The years 2022 to 2024 have the later deadlines of Art. 97 § 36 (3) EGAO, such as 30 April 2026 for 2024 with a tax advisor. A deadline on a Saturday or a Sunday ends on the Monday after it, § 108 (3) AO. `EBilanzDeadlineUtilities.resolveDeadline` answers it.

> [!NOTE]
> Public holidays differ by state and are not counted, so the day answered is never after the deadline. A tax office can ask for a return earlier, § 149 (4) AO.

## Adding a version of the taxonomy
`ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.TAXONOMIES` holds the versions, `E_BILANZ_TAXONOMIES` by default:

| Version | Fiscal years starting | Letter of the Federal Ministry of Finance |
|---|---|---|
| `HGB_TAXONOMY_6_9` | From 2026-01-01, allowed from 2025-01-01 | 10.06.2025 |
| `HGB_TAXONOMY_6_10` | From 2027-01-01, allowed from 2026-01-01 | 08.06.2026 |

A fiscal year is stated in the version mandatory for the fiscal years starting in the year it starts in, unless its preparation names one it allows. A fiscal year of a later year has no version until its own is added, and its preparation is refused with a `409`. Each version is data rebuilt from the official zip of XBRL Deutschland e.V. (de.xbrl.org) by the script `scripts/build-e-bilanz-taxonomy.mjs` of the package: the positions of the balance sheet, the income statement, the income statement of a micro corporation, the appropriation of profits and the comparison of business assets a corporation reports, with their German labels, parents, sides, sums and what the tax administration asks, the columns of the statement of changes in fixed assets with their sums, and the fields of the GCD module. A version published after your release of the framework is added as such data:

```ts
// src/e-bilanz-taxonomies.provider.ts
import { DiProvider, E_BILANZ_TAXONOMIES, EBilanzTaxonomy, EBilanzTaxonomyUtilities, HGB_TAXONOMY_6_10, ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS } from 'zibri';

// the file the script writes for a version, here stated by what it changes of 6.10
const HGB_TAXONOMY_6_11: EBilanzTaxonomy = EBilanzTaxonomyUtilities.resolveChanged(HGB_TAXONOMY_6_10, {
    ...HGB_TAXONOMY_6_10,
    version: '6.11',
    date: '2027-04-01',
    allowedFrom: new Date('2027-01-01T00:00:00.000Z'),
    mandatoryFrom: new Date('2028-01-01T00:00:00.000Z'),
    statements: {
        balanceSheet: { removed: [], rows: [] },
        incomeStatement: { removed: [], rows: [] },
        microIncomeStatement: { removed: [], rows: [] },
        appropriationOfProfits: { removed: [], rows: [] },
        businessAssetComparison: { removed: [], rows: [] }
    }
});

export const eBilanzTaxonomies: DiProvider<readonly EBilanzTaxonomy[]> = {
    token: ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.TAXONOMIES,
    useFactory: () => [...E_BILANZ_TAXONOMIES, HGB_TAXONOMY_6_11]
};
```

Each version names the `adapter` mapping the books to its structure, `hgb-6` for the versions 6.x. A version of another structure comes with an `EBilanzTaxonomyAdapterInterface` of its own in `ZIBRI_E_BILANZ_PLUGIN_DI_TOKENS.TAXONOMY_ADAPTERS`. The versions are checked as the application starts: each once, with its adapter, and every parent, sum and position of the adapter one of the version.

The data of the taxonomy is © XBRL Deutschland e.V., which lets it be copied, shortened and passed on as long as its notice stays and a changed copy says so: every version keeps the notice in its `notice`, and says it is shortened.

## Listing the routes
| Route | What it does | Permission |
|---|---|---|
| `GET /fiscal-years/:id` | The E-Bilanz of a fiscal year, see [reading the E-Bilanz of a fiscal year](#reading-the-e-bilanz-of-a-fiscal-year) | `bookkeeping.e-bilanz.read` |
| `POST /fiscal-years/:id/preview` | The E-Bilanz as the books state it, with its findings, keeping nothing | `bookkeeping.e-bilanz.read` |
| `POST /fiscal-years/:id/preparation` | Prepares it, see [preparing the E-Bilanz](#preparing-the-e-bilanz) | `bookkeeping.e-bilanz.prepare` |
| `GET /fiscal-years/:id/export` | Downloads the latest preparation with the exporter `exporter` names | `bookkeeping.e-bilanz.prepare` |
| `POST /fiscal-years/:id/test-transmission` | Sends it as a test | `bookkeeping.e-bilanz.transmit` |
| `POST /fiscal-years/:id/transmission` | Sends it for real, with a second factor | `bookkeeping.e-bilanz.transmit` |
| `POST /fiscal-years/:id/transmission-not-received` | Confirms that each transmission whose result is not known did not arrive, with a second factor, see [settling a transmission whose result is not known](#settling-a-transmission-whose-result-is-not-known) | `bookkeeping.e-bilanz.transmit` |
| `POST /fiscal-years/:id/manual-filing` | Records it as filed by hand, with its protocol | `bookkeeping.e-bilanz.transmit` |
| `GET /:id/files/protocol` | Downloads the protocol of a record, the `url` of its `protocol` | `bookkeeping.e-bilanz.read` |
| `GET /settings` | When the certificate was uploaded, and by whom | `bookkeeping.e-bilanz.read` |
| `PUT /settings/certificate` | Replaces the certificate and its PIN | `bookkeeping.e-bilanz.manage` |
| `GET /account-mappings` | The accounts mapped to a position of their own | `bookkeeping.e-bilanz.read` |
| `PUT /account-mappings/:accountId` | Maps an account to a position of its own | `bookkeeping.e-bilanz.manage` |
| `DELETE /account-mappings/:accountId` | Removes the mapping of an account | `bookkeeping.e-bilanz.manage` |

Each route takes the permission of `ZIBRI_E_BILANZ_PLATFORM_PERMISSIONS` beside it in a request naming no tenant, as the [bookkeeping routes](./bookkeeping-plugin.md#reaching-the-books-of-every-tenant) do: a route naming a fiscal year acts in its tenant, and every other one takes the `tenantId`.

## Requirements
Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `EBilanzSettings`, `EBilanzAccountMapping`, `EBilanzFiling` | The plugin is registered, in the data source of the books |
| `FileRecord`, `ChainGap`, `ChainAnchor` | The plugin is registered, for the archived records and their files |

## See also
- [Keeping the books](./bookkeeping-plugin.md) — the books, the statements and the conformances the E-Bilanz is stated from
- [Archiving documents](../data/archive.md) — how the records and their protocols are kept and pruned
- [Files](../data/files.md) — the file store of the certificates and protocols
- [Two factor](../auth/two-factor.md) — the second factor the transmission asks for
