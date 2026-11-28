import { ZibriApplication } from '../../application/application';
import { ArchiveUtilities } from '../../archive/archive.utilities';
import { KEPT_ROW_CHECK_DI_VARIANT } from '../../backup/kept-row-check.interface';
import { CronJob } from '../../cron/cron-job.model';
import { DataSourceInterface } from '../../data-source/data-sources/data-source.interface';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { NoProviderError } from '../../di/errors/no-provider.error';
import { inject } from '../../di/inject.function';
import { DiProvider } from '../../di/models/di-provider.model';
import { DiTokenProviderRecord, providersFromTokenRecord } from '../../di/models/di-token.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { type BaseTenantDefinition } from '../../tenancy/tenant-definition/base-tenant-definition.model';
import { Newable } from '../../types/newable.type';
import { validateEntitiesRegistered } from '../../utilities/validate-entities-registered.function';
import { validateTokensRegistered } from '../../utilities/validate-tokens-registered.function';
import { BANK_MATCH_POSTING_DI_VARIANT, BANK_MATCHER_DI_VARIANT } from '../bank/bank.tokens';
import { BankMatch } from '../bank/models/bank-match.model';
import { INVOICE_POSTING_DI_VARIANT } from '../invoicing/invoicing.tokens';
import { Invoice } from '../invoicing/models/invoice.model';
import { ZibriPlugin } from '../plugin.model';
import { AccountBankMatcher } from './account.bank-matcher';
import { BookkeepingAccountWriteObserver } from './bookkeeping-account.write-observer';
import { BookkeepingStatementUtilities } from './bookkeeping-statement.utilities';
import { BookkeepingVerificationCronJob } from './bookkeeping-verification.cron-job';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from './bookkeeping.tokens';
import { ExpenseBankMatcher } from './expense.bank-matcher';
import { ExpenseWriteObserver } from './expense.write-observer';
import { AccountMatchRule } from './models/account-match-rule.model';
import { BookkeepingAccount } from './models/bookkeeping-account.model';
import { BookkeepingCompany } from './models/bookkeeping-company.model';
import { BookkeepingPluginOptionsInput } from './models/bookkeeping-plugin-options-input.model';
import { BookkeepingPluginOptions } from './models/bookkeeping-plugin-options.model';
import { BookkeepingSettings } from './models/bookkeeping-settings.model';
import { EXPENSE_RECEIPT_FILE_STORE_NAME } from './models/expense-receipt-file-store-name.model';
import { ExpenseReceipt } from './models/expense-receipt.model';
import { Expense } from './models/expense.model';
import { FiscalYearStatement } from './models/fiscal-year-statement.model';
import { FiscalYear } from './models/fiscal-year.model';
import { JournalEntryLine } from './models/journal-entry-line.model';
import { JournalEntry } from './models/journal-entry.model';
import { PostingRuleSet } from './models/posting-rule-set.model';
import { BookkeepingReportPdfService } from './services/bookkeeping-report-pdf.service';
import { BookkeepingReportService } from './services/bookkeeping-report.service';
import { HgbCorporationConformanceService } from './services/conformance/hgb/hgb-corporation-conformance.service';
import { UgConformanceService } from './services/conformance/ug/ug-conformance.service';
import { ExpenseService } from './services/expense.service';
import { BookkeepingExportService } from './services/export/bookkeeping-export.service';
import { GdpduBookkeepingExporter } from './services/export/gdpdu/gdpdu.bookkeeping-exporter';
import { JournalService } from './services/journal.service';
import { PostingRuleService } from './services/posting-rule.service';
import { PostingService } from './services/posting.service';
import { HGB_STATEMENT_STRUCTURES } from './statements/hgb-statement-structures.model';
import { TenantBooksWriteObserver } from './tenant-books.write-observer';
import { TenantsWithoutBooksValidator } from './tenants-without-books.validator';

/**
 * The entities the bookkeeping plugin keeps, which an entry is posted across in one transaction.
 */
const BOOKKEEPING_ENTITIES: Newable<BaseEntity>[] = [
    BookkeepingSettings,
    BookkeepingAccount,
    FiscalYear,
    JournalEntry,
    JournalEntryLine,
    PostingRuleSet,
    Expense,
    ExpenseReceipt,
    FiscalYearStatement
];

/**
 * Plugin that keeps the books of a tenant by double-entry bookkeeping: accounts, a journal whose entries are never
 * changed and only reversed, and fiscal years that are closed into the next one. The journal is chained, archived and
 * checked once a day. It posts the invoices and credit notes of the invoicing plugin once they are issued, the
 * expenses once they are recorded, and the matches of the bank plugin once they are confirmed, by posting rules of
 * each fiscal year. Its reports answer the journal, the ledger, the trial balance, the statements of a fiscal year in
 * the forms of the HGB and the revenue of a year, as data and as pdfs. It exports a fiscal year for a tax audit, in the
 * description standard of the German tax administration by default.
 */
export class ZibriBookkeepingPlugin extends ZibriPlugin {
    private readonly defaultDiProviders: DiTokenProviderRecord<typeof ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS> = {
        // what a tenant without books does has several legitimate answers, which the application gives
        OPTIONS_INPUT: {
            useFactory: () => {
                throw new NoProviderError(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS_INPUT, []);
            }
        },
        OPTIONS: {
            useFactory: () => {
                const input: BookkeepingPluginOptionsInput = inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS_INPUT);
                // 10 years: § 147 AO keeps the books themselves that long, and the documents behind them, receipts
                // among them, 8 since the Bürokratieentlastungsgesetz IV of 2025
                const res: BookkeepingPluginOptions = {
                    retention: { years: 10 },
                    receiptStore: EXPENSE_RECEIPT_FILE_STORE_NAME,
                    receiptRetention: { years: 8 },
                    ...input
                };
                return res;
            }
        },
        JOURNAL_SERVICE: { useClass: JournalService },
        COMPANY_MODEL: { useValue: BookkeepingCompany },
        BOOKKEEPING_CONFORMANCE_SERVICES: {
            useFactory: () => [inject(HgbCorporationConformanceService), inject(UgConformanceService)]
        },
        STATEMENT_STRUCTURES: { useFactory: () => HGB_STATEMENT_STRUCTURES },
        REPORT_SERVICE: { useClass: BookkeepingReportService },
        REPORT_PDF_SERVICE: { useClass: BookkeepingReportPdfService },
        POSTING_SERVICE: { useClass: PostingService },
        POSTING_RULE_SERVICE: { useClass: PostingRuleService },
        EXPENSE_SERVICE: { useClass: ExpenseService },
        EXPORT_SERVICE: { useClass: BookkeepingExportService },
        EXPORTER: { useClass: GdpduBookkeepingExporter },
        RECEIPT_FILE_STORE: { useFactory: () => inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS).receiptStore },
        // registered whether or not the invoicing and the bank plugin are, as providers are: without them, nothing
        // hands them anything
        INVOICE_POSTING: {
            useFactory: () => inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_SERVICE),
            variants: [INVOICE_POSTING_DI_VARIANT]
        },
        BANK_MATCH_POSTING: {
            useFactory: () => inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_SERVICE),
            variants: [BANK_MATCH_POSTING_DI_VARIANT]
        },
        EXPENSE_BANK_MATCHER: { useClass: ExpenseBankMatcher, variants: [BANK_MATCHER_DI_VARIANT] },
        ACCOUNT_BANK_MATCHER: { useClass: AccountBankMatcher, variants: [BANK_MATCHER_DI_VARIANT] },
        KEPT_ROW_CHECK: {
            useFactory: () => inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_SERVICE),
            variants: [KEPT_ROW_CHECK_DI_VARIANT]
        }
    };

    override providers: DiProvider<unknown>[] = providersFromTokenRecord(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS, this.defaultDiProviders);

    override cronJobs: Newable<CronJob>[] = [BookkeepingVerificationCronJob];

    override additionalLifecycleServices: Newable<unknown>[] = [
        ExpenseWriteObserver,
        BookkeepingAccountWriteObserver,
        TenantBooksWriteObserver,
        TenantsWithoutBooksValidator
    ];

    // eslint-disable-next-line jsdoc/require-jsdoc
    validate(app: ZibriApplication): void {
        validateEntitiesRegistered(this.constructor.name, app, ...BOOKKEEPING_ENTITIES);
        validateTokensRegistered(this.constructor.name, ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS);
        const options: BookkeepingPluginOptions = inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS);
        const declared: Set<Newable<BaseEntity>> = new Set(app.options.dataSources.flatMap(d => inject(d).entities));
        // a match of an account is suggested by the rules of the books
        const matching: boolean = declared.has(BankMatch);
        if (matching) {
            validateEntitiesRegistered(this.constructor.name, app, AccountMatchRule);
        }
        // with never, every tenant is created with its settings, which takes the rows of the tenants
        const tenantEntity: Newable<BaseTenantDefinition> | undefined = options.tenantsWithoutBooks === 'never'
            ? inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).findTenantEntityClass?.()
            : undefined;
        if (options.tenantsWithoutBooks === 'never' && tenantEntity == undefined) {
            throw new InternalError(
                `${this.constructor.name} with tenantsWithoutBooks set to never needs an entity of the tenants, `
                + 'whose rows get their bookkeeping settings as they are created.'
            );
        }
        // an entry is posted in one transaction with the fiscal year its sequence is drawn from, and checked against
        // the accounts and the settings, which is a transaction of a single data source. So is an invoice issued, and
        // a match confirmed, which are posted in the transaction they are written in, and a tenant, whose settings
        // are created in the transaction it is created in
        const together: Newable<BaseEntity>[] = [
            ...BOOKKEEPING_ENTITIES,
            ...matching ? [AccountMatchRule, BankMatch] : [],
            ...declared.has(Invoice) ? [Invoice] : [],
            ...tenantEntity == undefined ? [] : [tenantEntity]
        ];
        const dataSources: Set<DataSourceInterface> = new Set(together.map(entity => {
            const repository: Repository<BaseEntity> = inject(repositoryTokenFor(entity));
            return repository.dataSource;
        }));
        if (dataSources.size > 1) {
            throw new InternalError(`${this.constructor.name} needs ${together.map(e => e.name).join(', ')} in the same data source.`);
        }
        ArchiveUtilities.validateRetention(options.retention);
        ArchiveUtilities.validateRetention(options.receiptRetention);
        BookkeepingStatementUtilities.validateStructures(inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.STATEMENT_STRUCTURES));
    }
}