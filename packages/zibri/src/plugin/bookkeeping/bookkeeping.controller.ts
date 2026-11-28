import { Readable } from 'node:stream';
import { buffer } from 'node:stream/consumers';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AnyLevelPermissions } from '../../auth/models/any-level-permissions.model';
import { type PlatformPermission } from '../../auth/roles/platform-permission.type';
import { PaginationResult } from '../../data-source/models/pagination-result.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { ForbiddenError } from '../../error-handling/errors/forbidden.error';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { HttpStatus } from '../../http/http-status.enum';
import { MimeType } from '../../http/mime-type.enum';
import { $ts } from '../../localization/translate.function';
import { Response } from '../../open-api/decorators/response.decorator';
import { FileResponse } from '../../parsing/form-data/file-response.model';
import { FormData } from '../../parsing/form-data/form-data.model';
import { Body } from '../../routing/decorators/body.decorator';
import { Delete } from '../../routing/decorators/delete.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Param } from '../../routing/decorators/param.decorator';
import { Patch } from '../../routing/decorators/patch.decorator';
import { Post } from '../../routing/decorators/post.decorator';
import { Put } from '../../routing/decorators/put.decorator';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { FsUtilities } from '../../utilities/fs.utilities';
import { normalizeIban } from '../bank/normalize-iban.function';
import { BookkeepingDayUtilities } from './bookkeeping-day.utilities';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from './bookkeeping.tokens';
import { AccountMatchRule, AccountMatchRuleCreateData } from './models/account-match-rule.model';
import { BookkeepingAccount, BookkeepingAccountCreateData } from './models/bookkeeping-account.model';
import { BookkeepingClosingProposal } from './models/bookkeeping-closing-proposal.model';
import { type BookkeepingExportArchive } from './models/bookkeeping-export-archive.model';
import { BookkeepingJournalReport } from './models/bookkeeping-journal-report.model';
import { BookkeepingLedgerReport } from './models/bookkeeping-ledger-report.model';
import { BookkeepingObligation } from './models/bookkeeping-obligation.model';
import { BookkeepingRevenueReport } from './models/bookkeeping-revenue-report.model';
import { BookkeepingStatementFormChoices } from './models/bookkeeping-statement-form-choices.model';
import { BookkeepingStatement } from './models/bookkeeping-statement.model';
import { BookkeepingTrialBalance } from './models/bookkeeping-trial-balance.model';
import { BookkeepingSettingsChange } from './models/bookkeeping-settings-change.model';
import { BookkeepingSettings } from './models/bookkeeping-settings.model';
import { BookkeepingVerification } from './models/bookkeeping-verification.model';
import { ExpenseData } from './models/expense-data.model';
import { ExpenseReceiptUpload } from './models/expense-receipt-upload.model';
import { ExpenseReceipt } from './models/expense-receipt.model';
import { Expense } from './models/expense.model';
import { FiscalYearChange } from './models/fiscal-year-change.model';
import { FiscalYearClosingResult } from './models/fiscal-year-closing-result.model';
import { FiscalYearClosing } from './models/fiscal-year-closing.model';
import { FiscalYearReopeningResult } from './models/fiscal-year-reopening-result.model';
import { FiscalYearReopening } from './models/fiscal-year-reopening.model';
import { FiscalYear } from './models/fiscal-year.model';
import { JournalEntryDetails } from './models/journal-entry-details.model';
import { JournalEntryPage } from './models/journal-entry-page.model';
import { JournalEntryReversal } from './models/journal-entry-reversal.model';
import { JournalEntry } from './models/journal-entry.model';
import { NewAccountMatchRule } from './models/new-account-match-rule.model';
import { NewBookkeepingAccount } from './models/new-bookkeeping-account.model';
import { NewBookkeepingSettings } from './models/new-bookkeeping-settings.model';
import { NewFiscalYear } from './models/new-fiscal-year.model';
import { NewJournalEntry } from './models/new-journal-entry.model';
import { NewPostingRuleSet } from './models/new-posting-rule-set.model';
import { PostingRuleSet } from './models/posting-rule-set.model';
import { PostingRules } from './models/posting-rules.model';
import { ZibriBookkeepingPermissions, ZibriBookkeepingPlatformPermissions } from './models/zibri-bookkeeping-permissions.model';
import { type BookkeepingReportPdfServiceInterface } from './services/bookkeeping-report-pdf-service.interface';
import { type BookkeepingReportServiceInterface } from './services/bookkeeping-report-service.interface';
import { type ExpenseServiceInterface } from './services/expense-service.interface';
import { type BookkeepingExportServiceInterface } from './services/export/bookkeeping-export-service.interface';
import { type JournalServiceInterface } from './services/journal-service.interface';
import { type PostingRuleServiceInterface } from './services/posting-rule-service.interface';

/**
 * The most rows a page of the entries or the expenses holds.
 */
const MAX_LIMIT: number = 100;

const READ: AnyLevelPermissions = {
    permission: ZibriBookkeepingPermissions.BOOKKEEPING_READ,
    platformPermission: ZibriBookkeepingPlatformPermissions.BOOKKEEPING_READ_ALL
};
const POST: AnyLevelPermissions = {
    permission: ZibriBookkeepingPermissions.BOOKKEEPING_POST,
    platformPermission: ZibriBookkeepingPlatformPermissions.BOOKKEEPING_POST_ALL
};
const CLOSE: AnyLevelPermissions = {
    permission: ZibriBookkeepingPermissions.BOOKKEEPING_CLOSE_FISCAL_YEAR,
    platformPermission: ZibriBookkeepingPlatformPermissions.BOOKKEEPING_CLOSE_FISCAL_YEAR_ALL
};
const REOPEN: AnyLevelPermissions = {
    permission: ZibriBookkeepingPermissions.BOOKKEEPING_REOPEN_FISCAL_YEAR,
    platformPermission: ZibriBookkeepingPlatformPermissions.BOOKKEEPING_REOPEN_FISCAL_YEAR_ALL
};
const MANAGE: AnyLevelPermissions = {
    permission: ZibriBookkeepingPermissions.BOOKKEEPING_MANAGE,
    platformPermission: ZibriBookkeepingPlatformPermissions.BOOKKEEPING_MANAGE_ALL
};
const EXPENSES: AnyLevelPermissions = {
    permission: ZibriBookkeepingPermissions.BOOKKEEPING_EXPENSES_MANAGE,
    platformPermission: ZibriBookkeepingPlatformPermissions.BOOKKEEPING_EXPENSES_MANAGE_ALL
};
const EXPORT: AnyLevelPermissions = {
    permission: ZibriBookkeepingPermissions.BOOKKEEPING_EXPORT,
    platformPermission: ZibriBookkeepingPlatformPermissions.BOOKKEEPING_EXPORT_ALL
};

/**
 * The routes of the books of the tenant of the request, below the path of the controller that extends it: their
 * settings, accounts, fiscal years, posting rules and journal entries, posting, reversing, closing a fiscal year,
 * checking the books, the expenses with their receipts, the reports, as JSON and as pdfs, and the export of a fiscal
 * year for a tax audit. Each is behind a permission of
 * `ZIBRI_BOOKKEEPING_PERMISSIONS`, or the one of `ZIBRI_BOOKKEEPING_PLATFORM_PERMISSIONS` beside it, which reaches the
 * books of every tenant in a request naming no tenant: a route naming a row reaches the books of its tenant, and every
 * other one takes the `tenantId` of the books.
 */
// no @Controller of its own, for the reason MailingListController has none: the application's class extending this
// one says where the routes are. Every decorator is on a route rather than the class, which the application's class
// would not inherit
export class BookkeepingController {
    // read when used rather than injected, for the reason MailingListController reads its repository so
    private get accountRepository(): Repository<BookkeepingAccount, BookkeepingAccountCreateData> {
        return inject(repositoryTokenFor(BookkeepingAccount));
    }

    private get fiscalYearRepository(): Repository<FiscalYear> {
        return inject(repositoryTokenFor(FiscalYear));
    }

    private get entryRepository(): Repository<JournalEntry> {
        return inject(repositoryTokenFor(JournalEntry));
    }

    private get ruleSetRepository(): Repository<PostingRuleSet> {
        return inject(repositoryTokenFor(PostingRuleSet));
    }

    private get matchRuleRepository(): Repository<AccountMatchRule, AccountMatchRuleCreateData> {
        return inject(repositoryTokenFor(AccountMatchRule));
    }

    private get expenseRepository(): Repository<Expense> {
        return inject(repositoryTokenFor(Expense));
    }

    private get journalService(): JournalServiceInterface {
        return inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.JOURNAL_SERVICE);
    }

    private get postingRuleService(): PostingRuleServiceInterface {
        return inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_RULE_SERVICE);
    }

    private get expenseService(): ExpenseServiceInterface {
        return inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.EXPENSE_SERVICE);
    }

    private get reportService(): BookkeepingReportServiceInterface {
        return inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.REPORT_SERVICE);
    }

    private get reportPdfService(): BookkeepingReportPdfServiceInterface {
        return inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.REPORT_PDF_SERVICE);
    }

    private get exportService(): BookkeepingExportServiceInterface {
        return inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.EXPORT_SERVICE);
    }

    private get tenantService(): TenantServiceInterface {
        return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.object(BookkeepingSettings)
    @Get('/settings')
    async findSettings(
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<BookkeepingSettings> {
        return await this.runInTenant(user, READ, tenantId, async () => {
            const settings: BookkeepingSettings | undefined = await this.journalService.findSettings();
            if (settings == undefined) {
                throw new NotFoundError($ts`The tenant keeps no books, as it has no bookkeeping settings.`);
            }
            return settings;
        });
    }

    @Auth.hasAnyLevelPermission(MANAGE)
    @Response.object(BookkeepingSettings)
    @Post('/settings')
    async createSettings(
        @Body(NewBookkeepingSettings)
        settings: NewBookkeepingSettings,
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<BookkeepingSettings> {
        return await this.runInTenant(user, MANAGE, tenantId, async () => await this.journalService.createSettings(settings));
    }

    @Auth.hasAnyLevelPermission(MANAGE)
    @Response.object(BookkeepingSettings)
    @Patch('/settings')
    async updateSettings(
        @Body(BookkeepingSettingsChange)
        change: BookkeepingSettingsChange,
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<BookkeepingSettings> {
        return await this.runInTenant(user, MANAGE, tenantId, async () => await this.journalService.updateSettings(change));
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.array(BookkeepingAccount)
    @Get('/accounts')
    async findAccounts(
        @Param.query('search', { type: 'string', required: false })
        search: string | undefined,
        @Param.query('open', { type: 'boolean', required: false })
        open: boolean | undefined,
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<BookkeepingAccount[]> {
        return await this.runInTenant(user, READ, tenantId, async () => await this.journalService.findAccounts({ search, open }));
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.object(BookkeepingAccount)
    @Get('/accounts/:id')
    async findAccount(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @CurrentUser()
        user: CurrentUser
    ): Promise<BookkeepingAccount> {
        return await this.runInTenantOf(
            user,
            READ,
            async () => (await this.accountRepository.findById(id, { acrossTenants: true })).tenantId,
            async () => await this.accountRepository.findById(id)
        );
    }

    @Auth.hasAnyLevelPermission(MANAGE)
    @Response.object(BookkeepingAccount)
    @Post('/accounts')
    async createAccount(
        @Body(NewBookkeepingAccount)
        account: NewBookkeepingAccount,
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<BookkeepingAccount> {
        return await this.runInTenant(user, MANAGE, tenantId, async () => await this.accountRepository.create({
            number: account.number,
            name: account.name,
            type: account.type,
            statementPosition: account.statementPosition ?? null,
            creditStatementPosition: account.creditStatementPosition ?? null
        }));
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.array(FiscalYear)
    @Get('/fiscal-years')
    async findFiscalYears(
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<FiscalYear[]> {
        return await this.runInTenant(
            user,
            READ,
            tenantId,
            async () => await this.fiscalYearRepository.findAll({ order: { start: 'ASC' }, limit: 'all' })
        );
    }

    @Auth.hasAnyLevelPermission(MANAGE)
    @Response.object(FiscalYear)
    @Post('/fiscal-years')
    async createFiscalYear(
        @Body(NewFiscalYear)
        fiscalYear: NewFiscalYear,
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<FiscalYear> {
        return await this.runInTenant(user, MANAGE, tenantId, async () => await this.journalService.createFiscalYear(fiscalYear));
    }

    @Auth.hasAnyLevelPermission(MANAGE)
    @Response.object(FiscalYear)
    @Patch('/fiscal-years/:id')
    async updateFiscalYear(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @Body(FiscalYearChange)
        change: FiscalYearChange,
        @CurrentUser()
        user: CurrentUser
    ): Promise<FiscalYear> {
        return await this.runInTenantOfFiscalYear(user, MANAGE, id, async () => await this.journalService.updateFiscalYear(id, change));
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.object(BookkeepingJournalReport)
    @Get('/reports/journal')
    async resolveJournal(
        @Param.query('from', { type: 'date' })
        from: Date,
        @Param.query('until', { type: 'date' })
        until: Date,
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<BookkeepingJournalReport> {
        return await this.runInTenant(user, READ, tenantId, async () => await this.reportService.resolveJournal(from, until));
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.file()
    @Get('/reports/journal.pdf')
    async resolveJournalPdf(
        @Param.query('from', { type: 'date' })
        from: Date,
        @Param.query('until', { type: 'date' })
        until: Date,
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<FileResponse> {
        return await this.runInTenant(user, READ, tenantId, async () => this.resolvePdfResponse(
            await this.reportPdfService.resolveJournalPdf(from, until),
            `journal-${BookkeepingDayUtilities.formatDay(from)}-${BookkeepingDayUtilities.formatDay(until)}.pdf`
        ));
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.object(BookkeepingLedgerReport)
    @Get('/reports/ledger')
    async resolveLedger(
        @Param.query('accountId', { type: 'string', format: 'uuid' })
        accountId: string,
        @Param.query('from', { type: 'date' })
        from: Date,
        @Param.query('until', { type: 'date' })
        until: Date,
        @CurrentUser()
        user: CurrentUser
    ): Promise<BookkeepingLedgerReport> {
        return await this.runInTenantOf(
            user,
            READ,
            async () => (await this.accountRepository.findById(accountId, { acrossTenants: true })).tenantId,
            async () => await this.reportService.resolveLedger(accountId, from, until)
        );
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.file()
    @Get('/reports/ledger.pdf')
    async resolveLedgerPdf(
        @Param.query('accountId', { type: 'string', format: 'uuid' })
        accountId: string,
        @Param.query('from', { type: 'date' })
        from: Date,
        @Param.query('until', { type: 'date' })
        until: Date,
        @CurrentUser()
        user: CurrentUser
    ): Promise<FileResponse> {
        return await this.runInTenantOf(
            user,
            READ,
            async () => (await this.accountRepository.findById(accountId, { acrossTenants: true })).tenantId,
            async () => {
                const account: BookkeepingAccount = await this.accountRepository.findById(accountId);
                return this.resolvePdfResponse(
                    await this.reportPdfService.resolveLedgerPdf(accountId, from, until),
                    `ledger-${account.number}-${BookkeepingDayUtilities.formatDay(from)}-${BookkeepingDayUtilities.formatDay(until)}.pdf`
                );
            }
        );
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.object(BookkeepingTrialBalance)
    @Get('/reports/trial-balance')
    async resolveTrialBalance(
        @Param.query('fiscalYearId', { type: 'string', format: 'uuid' })
        fiscalYearId: string,
        @Param.query('until', { type: 'date', required: false })
        until: Date | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<BookkeepingTrialBalance> {
        return await this.runInTenantOfFiscalYear(user, READ, fiscalYearId, async () => await this.reportService.resolveTrialBalance(fiscalYearId, until));
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.file()
    @Get('/reports/trial-balance.pdf')
    async resolveTrialBalancePdf(
        @Param.query('fiscalYearId', { type: 'string', format: 'uuid' })
        fiscalYearId: string,
        @Param.query('until', { type: 'date', required: false })
        until: Date | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<FileResponse> {
        return await this.runInTenantOfFiscalYear(user, READ, fiscalYearId, async () => this.resolvePdfResponse(
            await this.reportPdfService.resolveTrialBalancePdf(fiscalYearId, until),
            `trial-balance-${await this.resolveFiscalYearName(fiscalYearId)}.pdf`
        ));
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.object(BookkeepingStatement)
    @Get('/reports/balance-sheet')
    async resolveBalanceSheet(
        @Param.query('fiscalYearId', { type: 'string', format: 'uuid' })
        fiscalYearId: string,
        @Param.query('form', { type: 'string', required: false })
        form: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<BookkeepingStatement> {
        return await this.runInTenantOfFiscalYear(user, READ, fiscalYearId, async () => await this.reportService.resolveBalanceSheet(fiscalYearId, form));
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.file()
    @Get('/reports/balance-sheet.pdf')
    async resolveBalanceSheetPdf(
        @Param.query('fiscalYearId', { type: 'string', format: 'uuid' })
        fiscalYearId: string,
        @Param.query('form', { type: 'string', required: false })
        form: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<FileResponse> {
        return await this.runInTenantOfFiscalYear(user, READ, fiscalYearId, async () => this.resolvePdfResponse(
            await this.reportPdfService.resolveBalanceSheetPdf(fiscalYearId, form),
            `balance-sheet-${await this.resolveFiscalYearName(fiscalYearId)}.pdf`
        ));
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.object(BookkeepingStatement)
    @Get('/reports/income-statement')
    async resolveIncomeStatement(
        @Param.query('fiscalYearId', { type: 'string', format: 'uuid' })
        fiscalYearId: string,
        @Param.query('form', { type: 'string', required: false })
        form: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<BookkeepingStatement> {
        return await this.runInTenantOfFiscalYear(user, READ, fiscalYearId, async () => await this.reportService.resolveIncomeStatement(fiscalYearId, form));
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.file()
    @Get('/reports/income-statement.pdf')
    async resolveIncomeStatementPdf(
        @Param.query('fiscalYearId', { type: 'string', format: 'uuid' })
        fiscalYearId: string,
        @Param.query('form', { type: 'string', required: false })
        form: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<FileResponse> {
        return await this.runInTenantOfFiscalYear(user, READ, fiscalYearId, async () => this.resolvePdfResponse(
            await this.reportPdfService.resolveIncomeStatementPdf(fiscalYearId, form),
            `income-statement-${await this.resolveFiscalYearName(fiscalYearId)}.pdf`
        ));
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.object(BookkeepingRevenueReport)
    @Get('/reports/revenue')
    async resolveRevenue(
        @Param.query('year', { type: 'number', format: 'integer', min: 1 })
        year: number,
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<BookkeepingRevenueReport> {
        return await this.runInTenant(user, READ, tenantId, async () => await this.reportService.resolveRevenue(year));
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.file()
    @Get('/reports/revenue.pdf')
    async resolveRevenuePdf(
        @Param.query('year', { type: 'number', format: 'integer', min: 1 })
        year: number,
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<FileResponse> {
        return await this.runInTenant(user, READ, tenantId, async () => this.resolvePdfResponse(
            await this.reportPdfService.resolveRevenuePdf(year),
            `revenue-${year}.pdf`
        ));
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.object(JournalEntryPage)
    @Get('/entries')
    async findEntries(
        @Param.query('page', { type: 'number', format: 'integer', min: 1 })
        page: number,
        @Param.query('limit', { type: 'number', format: 'integer', min: 1, max: MAX_LIMIT })
        limit: number,
        @Param.query('fiscalYearId', { type: 'string', format: 'uuid', required: false })
        fiscalYearId: string | undefined,
        @Param.query('from', { type: 'date', required: false })
        from: Date | undefined,
        @Param.query('until', { type: 'date', required: false })
        until: Date | undefined,
        @Param.query('accountId', { type: 'string', format: 'uuid', required: false })
        accountId: string | undefined,
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<JournalEntryPage> {
        return await this.runInTenant(
            user,
            READ,
            tenantId,
            async () => await this.journalService.findEntries(page, limit, { fiscalYearId, from, until, accountId })
        );
    }

    @Auth.hasAnyLevelPermission(POST)
    @Response.object(JournalEntryDetails)
    @Post('/entries')
    async postEntry(
        @Body(NewJournalEntry)
        entry: NewJournalEntry,
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<JournalEntryDetails> {
        return await this.runInTenant(user, POST, tenantId, async () => await this.journalService.post({ ...entry, createdBy: user.id }));
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.object(JournalEntryDetails)
    @Get('/entries/:id')
    async findEntry(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @CurrentUser()
        user: CurrentUser
    ): Promise<JournalEntryDetails> {
        return await this.runInTenantOf(
            user,
            READ,
            async () => (await this.entryRepository.findById(id, { acrossTenants: true })).tenantId,
            async () => await this.journalService.findEntry(id)
        );
    }

    @Auth.hasAnyLevelPermission(POST)
    @Response.object(JournalEntryDetails)
    @Post('/entries/:id/reversal')
    async reverseEntry(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @Body(JournalEntryReversal)
        reversal: JournalEntryReversal,
        @CurrentUser()
        user: CurrentUser
    ): Promise<JournalEntryDetails> {
        return await this.runInTenantOf(
            user,
            POST,
            async () => (await this.entryRepository.findById(id, { acrossTenants: true })).tenantId,
            async () => await this.journalService.reverse(id, { ...reversal, createdBy: user.id })
        );
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.object(BookkeepingStatementFormChoices)
    @Get('/fiscal-years/:id/statement-forms')
    async resolveStatementFormChoices(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @CurrentUser()
        user: CurrentUser
    ): Promise<BookkeepingStatementFormChoices> {
        return await this.runInTenantOfFiscalYear(user, READ, id, async () => await this.reportService.resolveStatementFormChoices(id));
    }

    @Auth.hasAnyLevelPermission(CLOSE)
    @Response.array(BookkeepingClosingProposal)
    @Get('/fiscal-years/:id/closing-proposals')
    async resolveClosingProposals(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @CurrentUser()
        user: CurrentUser
    ): Promise<BookkeepingClosingProposal[]> {
        return await this.runInTenantOf(
            user,
            CLOSE,
            async () => (await this.fiscalYearRepository.findById(id, { acrossTenants: true })).tenantId,
            async () => await this.journalService.resolveClosingProposals(id)
        );
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.array(BookkeepingObligation)
    @Get('/fiscal-years/:id/obligations')
    async resolveObligations(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @CurrentUser()
        user: CurrentUser
    ): Promise<BookkeepingObligation[]> {
        return await this.runInTenantOfFiscalYear(user, READ, id, async () => await this.journalService.resolveObligations(id));
    }

    @Auth.hasAnyLevelPermission(CLOSE)
    @Response.object(FiscalYearClosingResult)
    @Post('/fiscal-years/:id/closing')
    async closeFiscalYear(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @Body(FiscalYearClosing)
        closing: FiscalYearClosing,
        @CurrentUser()
        user: CurrentUser
    ): Promise<FiscalYearClosingResult> {
        return await this.runInTenantOf(
            user,
            CLOSE,
            async () => (await this.fiscalYearRepository.findById(id, { acrossTenants: true })).tenantId,
            async () => await this.journalService.closeFiscalYear(id, closing)
        );
    }

    @Auth.hasAnyLevelPermission(REOPEN)
    // it undoes a closing, which a stolen session is not to reach
    @Auth.require2fa({ reauth: true })
    @Response.object(FiscalYearReopeningResult)
    @Post('/fiscal-years/:id/reopening')
    async reopenFiscalYear(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @Body(FiscalYearReopening)
        reopening: FiscalYearReopening,
        @CurrentUser()
        user: CurrentUser
    ): Promise<FiscalYearReopeningResult> {
        return await this.runInTenantOf(
            user,
            REOPEN,
            async () => (await this.fiscalYearRepository.findById(id, { acrossTenants: true })).tenantId,
            async () => await this.journalService.reopenFiscalYear(id, { ...reopening, createdBy: user.id })
        );
    }

    @Auth.hasAnyLevelPermission(EXPORT)
    @Response.file()
    @Get('/fiscal-years/:id/export')
    async exportFiscalYear(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @Param.query('documents', { type: 'boolean', required: false })
        documents: boolean | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<FileResponse> {
        return await this.runInTenantOfFiscalYear(user, EXPORT, id, async () => {
            const archive: BookkeepingExportArchive = await this.exportService.exportFiscalYear(id, { documents });
            // streamed as it is written: the documents of a year do not fit in memory
            return FileResponse.fromStream({ stream: Readable.from(archive.content), filename: archive.fileName, mimeType: archive.mimeType });
        });
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.object(BookkeepingVerification)
    @Get('/verification')
    async resolveVerification(
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<BookkeepingVerification> {
        return await this.runInTenant(user, READ, tenantId, async () => await this.journalService.resolveVerification());
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.array(PostingRuleSet)
    @Get('/posting-rule-sets')
    async findPostingRuleSets(
        @Param.query('fiscalYearId', { type: 'string', format: 'uuid', required: false })
        fiscalYearId: string | undefined,
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<PostingRuleSet[]> {
        return await this.runInTenant(user, READ, tenantId, async () => await this.postingRuleService.findRuleSets(fiscalYearId));
    }

    @Auth.hasAnyLevelPermission(MANAGE)
    @Response.object(PostingRuleSet)
    @Post('/posting-rule-sets')
    async createPostingRuleSet(
        @Body(NewPostingRuleSet)
        ruleSet: NewPostingRuleSet,
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<PostingRuleSet> {
        return await this.runInTenant(user, MANAGE, tenantId, async () => await this.postingRuleService.createRuleSet(ruleSet));
    }

    @Auth.hasAnyLevelPermission(MANAGE)
    @Response.object(PostingRuleSet)
    @Put('/posting-rule-sets/:id')
    async updatePostingRuleSet(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @Body(PostingRules)
        rules: PostingRules,
        @CurrentUser()
        user: CurrentUser
    ): Promise<PostingRuleSet> {
        return await this.runInTenantOf(
            user,
            MANAGE,
            async () => (await this.ruleSetRepository.findById(id, { acrossTenants: true })).tenantId,
            async () => await this.postingRuleService.updateRuleSet(id, rules)
        );
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.array(AccountMatchRule)
    @Get('/account-match-rules')
    async findAccountMatchRules(
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<AccountMatchRule[]> {
        return await this.runInTenant(user, READ, tenantId, async () => await this.matchRuleRepository.findAll({ limit: 'all' }));
    }

    @Auth.hasAnyLevelPermission(MANAGE)
    @Response.object(AccountMatchRule)
    @Post('/account-match-rules')
    async createAccountMatchRule(
        @Body(NewAccountMatchRule)
        rule: NewAccountMatchRule,
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<AccountMatchRule> {
        return await this.runInTenant(user, MANAGE, tenantId, async () => {
            if (rule.counterpartyIban == undefined && rule.text == undefined) {
                throw new BadRequestError($ts`An account match rule needs to name a counterpartyIban, a text, or both.`);
            }
            // read first, as a rule names its account by its id alone, which no relation checks
            await this.accountRepository.findById(rule.accountId);
            return await this.matchRuleRepository.create({
                accountId: rule.accountId,
                counterpartyIban: rule.counterpartyIban == undefined ? null : normalizeIban(rule.counterpartyIban),
                text: rule.text ?? null
            });
        });
    }

    @Auth.hasAnyLevelPermission(MANAGE)
    @Response.error(HttpStatus.NOT_FOUND)
    @Response.empty()
    @Delete('/account-match-rules/:id')
    async deleteAccountMatchRule(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @CurrentUser()
        user: CurrentUser
    ): Promise<void> {
        await this.runInTenantOf(
            user,
            MANAGE,
            async () => (await this.matchRuleRepository.findById(id, { acrossTenants: true })).tenantId,
            async () => await this.matchRuleRepository.deleteById(id)
        );
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.paginated(Expense)
    @Get('/expenses')
    async findExpenses(
        @Param.query('page', { type: 'number', format: 'integer', min: 1 })
        page: number,
        @Param.query('limit', { type: 'number', format: 'integer', min: 1, max: MAX_LIMIT })
        limit: number,
        @Param.query('search', { type: 'string', required: false })
        search: string | undefined,
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<PaginationResult<Expense>> {
        return await this.runInTenant(user, READ, tenantId, async () => await this.expenseService.findExpenses(page, limit, { search }));
    }

    @Auth.hasAnyLevelPermission(READ)
    @Response.object(Expense)
    @Get('/expenses/:id')
    async findExpense(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @CurrentUser()
        user: CurrentUser
    ): Promise<Expense> {
        return await this.runInTenantOfExpense(user, READ, id, async () => await this.expenseRepository.findById(id));
    }

    @Auth.hasAnyLevelPermission(EXPENSES)
    @Response.object(Expense)
    @Post('/expenses')
    async createExpense(
        @Body(ExpenseData)
        expense: ExpenseData,
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<Expense> {
        return await this.runInTenant(user, EXPENSES, tenantId, async () => await this.expenseService.createExpense(expense));
    }

    @Auth.hasAnyLevelPermission(EXPENSES)
    @Response.object(Expense)
    @Put('/expenses/:id')
    async updateExpense(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @Body(ExpenseData)
        expense: ExpenseData,
        @CurrentUser()
        user: CurrentUser
    ): Promise<Expense> {
        return await this.runInTenantOfExpense(user, EXPENSES, id, async () => await this.expenseService.updateExpense(id, expense));
    }

    @Auth.hasAnyLevelPermission(EXPENSES)
    @Response.error(HttpStatus.NOT_FOUND)
    @Response.empty()
    @Delete('/expenses/:id')
    async deleteExpense(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @CurrentUser()
        user: CurrentUser
    ): Promise<void> {
        // a recorded expense is refused by its write observer
        await this.runInTenantOfExpense(user, EXPENSES, id, async () => await this.expenseRepository.deleteById(id));
    }

    @Auth.hasAnyLevelPermission(EXPENSES)
    @Response.object(Expense)
    @Post('/expenses/:id/recording')
    async recordExpense(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @CurrentUser()
        user: CurrentUser
    ): Promise<Expense> {
        return await this.runInTenantOfExpense(user, EXPENSES, id, async () => await this.expenseService.recordExpense(id));
    }

    @Auth.hasAnyLevelPermission(EXPENSES)
    @Response.object(Expense)
    @Post('/expenses/:id/correction')
    async correctExpense(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @Body(ExpenseData)
        expense: ExpenseData,
        @CurrentUser()
        user: CurrentUser
    ): Promise<Expense> {
        return await this.runInTenantOfExpense(user, EXPENSES, id, async () => await this.expenseService.correctExpense(id, expense));
    }

    @Auth.hasAnyLevelPermission(EXPENSES)
    @Response.object(ExpenseReceipt)
    @Post('/expense-receipts')
    async createReceipt(
        @Body(ExpenseReceiptUpload, { type: MimeType.FORM_DATA })
        form: FormData<ExpenseReceiptUpload>,
        @Param.query('tenantId', { type: 'string', format: 'uuid', required: false })
        tenantId: string | undefined,
        @CurrentUser()
        user: CurrentUser
    ): Promise<ExpenseReceipt> {
        try {
            const data: Buffer = await buffer(FsUtilities.createReadStream(form.value.file.path));
            return await this.runInTenant(user, EXPENSES, tenantId, async () => await this.expenseService.createReceipt({
                name: form.value.file.originalname,
                mimeType: form.value.file.mimetype,
                data,
                uploadedBy: user.id
            }));
        }
        finally {
            await form.cleanup();
        }
    }

    /**
     * Runs work in the tenant of the request, or, for a request naming none, in the tenant it names by `tenantId`,
     * which only the platform permission reaches.
     * @param user - The caller.
     * @param permissions - The permissions of the route.
     * @param tenantId - The tenant a request naming none names.
     * @param work - The work.
     * @returns What the work returns.
     * @throws A BadRequestError for a request naming no tenant and no `tenantId`.
     */
    private async runInTenant<T>(
        user: CurrentUser,
        permissions: AnyLevelPermissions,
        tenantId: string | undefined,
        work: () => Promise<T>
    ): Promise<T> {
        return await this.runInTenantOf(
            user,
            permissions,
            // eslint-disable-next-line typescript/require-await
            async () => {
                if (tenantId == undefined) {
                    throw new BadRequestError($ts`A request naming no tenant needs to name the tenantId of the books.`);
                }
                return tenantId;
            },
            work
        );
    }

    /**
     * Answers a pdf as a download.
     * @param pdf - The pdf.
     * @param filename - The name of the file.
     * @returns The answer.
     */
    private resolvePdfResponse(pdf: Readable, filename: `${string}.pdf`): FileResponse {
        return FileResponse.fromStream({ stream: pdf, filename, mimeType: MimeType.PDF });
    }

    /**
     * Resolves how the file of a report of a fiscal year is named: by its first and its last day.
     * @param fiscalYearId - The id of the fiscal year.
     * @returns The name, such as `2026-01-01-2026-12-31`.
     */
    private async resolveFiscalYearName(fiscalYearId: string): Promise<string> {
        const fiscalYear: FiscalYear = await this.fiscalYearRepository.findById(fiscalYearId);
        return `${BookkeepingDayUtilities.formatDay(fiscalYear.start)}-${BookkeepingDayUtilities.formatDay(fiscalYear.end)}`;
    }

    /**
     * Runs work in the tenant of a fiscal year: the tenant of the request, or, for a request naming none, the tenant
     * the fiscal year belongs to, which only the platform permission reaches.
     * @param user - The caller.
     * @param permissions - The permissions of the route.
     * @param fiscalYearId - The id of the fiscal year.
     * @param work - The work.
     * @returns What the work returns.
     */
    private async runInTenantOfFiscalYear<T>(
        user: CurrentUser,
        permissions: AnyLevelPermissions,
        fiscalYearId: string,
        work: () => Promise<T>
    ): Promise<T> {
        return await this.runInTenantOf(
            user,
            permissions,
            async () => (await this.fiscalYearRepository.findById(fiscalYearId, { acrossTenants: true })).tenantId,
            work
        );
    }

    /**
     * Runs work in the tenant of an expense: the tenant of the request, or, for a request naming none, the tenant the
     * expense belongs to, which only the platform permission reaches.
     * @param user - The caller.
     * @param permissions - The permissions of the route.
     * @param expenseId - The id of the expense.
     * @param work - The work.
     * @returns What the work returns.
     */
    private async runInTenantOfExpense<T>(
        user: CurrentUser,
        permissions: AnyLevelPermissions,
        expenseId: string,
        work: () => Promise<T>
    ): Promise<T> {
        return await this.runInTenantOf(
            user,
            permissions,
            async () => (await this.expenseRepository.findById(expenseId, { acrossTenants: true })).tenantId,
            work
        );
    }

    /**
     * Runs work in the tenant of the request, or, for a request naming none, in the tenant of what the route names,
     * which only the platform permission reaches.
     * @param user - The caller.
     * @param permissions - The permissions of the route.
     * @param resolveTenantId - Resolves the tenant of what the route names.
     * @param work - The work.
     * @returns What the work returns.
     * @throws A ForbiddenError for a request naming no tenant of a caller without the platform permission.
     */
    private async runInTenantOf<T>(
        user: CurrentUser,
        permissions: AnyLevelPermissions,
        resolveTenantId: () => Promise<string>,
        work: () => Promise<T>
    ): Promise<T> {
        if (this.tenantService.getActiveTenantId() != undefined) {
            return await work();
        }
        this.validatePlatformPermission(user, permissions.platformPermission);
        return await this.tenantService.runAs(await resolveTenantId(), work);
    }

    /**
     * Validates that a caller holds a platform permission.
     * @param user - The caller.
     * @param platformPermission - The platform permission of the route.
     * @throws A ForbiddenError when they do not.
     */
    private validatePlatformPermission(user: CurrentUser, platformPermission: PlatformPermission): void {
        // @Auth.hasAnyLevelPermission lets a request naming no tenant through by the platform permission alone. Asked
        // again here, as the tenant permission reaching the books of every tenant is the one thing these routes may
        // never do
        if (!user.platformPermissions.includes(platformPermission)) {
            throw new ForbiddenError($ts`You do not have permission to access this route.`);
        }
    }
}
