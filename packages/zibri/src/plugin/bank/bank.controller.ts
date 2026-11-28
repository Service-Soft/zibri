import { buffer } from 'node:stream/consumers';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { PaginationResult } from '../../data-source/models/pagination-result.model';
import { Where } from '../../data-source/models/where/where-filter.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { MimeType } from '../../http/mime-type.enum';
import { Response } from '../../open-api/decorators/response.decorator';
import { FormData } from '../../parsing/form-data/form-data.model';
import { Body } from '../../routing/decorators/body.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Param } from '../../routing/decorators/param.decorator';
import { Post } from '../../routing/decorators/post.decorator';
import { FsUtilities } from '../../utilities/fs.utilities';
import { ApprovalRequestDetails } from '../approval/models/approval-request-details.model';
import { ZIBRI_BANK_PLUGIN_DI_TOKENS } from './bank.tokens';
import { BankAccount, BankAccountCreateData } from './models/bank-account.model';
import { BankMatch } from './models/bank-match.model';
import { BankStatementImport } from './models/bank-statement-import.model';
import { BankStatementUpload } from './models/bank-statement-upload.model';
import { BankStatement } from './models/bank-statement.model';
import { BankTransactionDetails } from './models/bank-transaction-details.model';
import { BankTransactionStatus } from './models/bank-transaction-status.enum';
import { BankTransactionSuggestion } from './models/bank-transaction-suggestion.model';
import { NewBankAccount } from './models/new-bank-account.model';
import { ZibriBankPermissions } from './models/zibri-bank-permissions.model';
import { normalizeIban } from './normalize-iban.function';
import { type BankMatchServiceInterface } from './services/bank-match-service.interface';
import { type BankStatementServiceInterface } from './services/bank-statement-service.interface';

/**
 * The most rows a page of the list routes holds.
 */
const MAX_LIMIT: number = 100;

/**
 * The routes of the bank accounts of the tenant of the request, below the path of the controller that extends it:
 * adding and listing the accounts, importing a CAMT.053 file, listing the statements and the transactions with what of
 * each is open, the pending suggestions of a transaction, and listing the matches of transactions with invoices and
 * suggesting them again. Each is behind a permission of `ZIBRI_BANK_PERMISSIONS`.
 */
// no @Controller of its own, for the reason MailingListController has none: the application's class extending this
// one says where the routes are. Every decorator is on a route rather than the class, which the application's class
// would not inherit
export class BankController {
    // read when used rather than injected, for the reason MailingListController reads its repository so
    private get accountRepository(): Repository<BankAccount, BankAccountCreateData> {
        return inject(repositoryTokenFor(BankAccount));
    }

    private get statementRepository(): Repository<BankStatement> {
        return inject(repositoryTokenFor(BankStatement));
    }

    private get bankStatementService(): BankStatementServiceInterface {
        return inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.BANK_STATEMENT_SERVICE);
    }

    private get bankMatchService(): BankMatchServiceInterface {
        return inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.BANK_MATCH_SERVICE);
    }

    @Auth.hasPermission(ZibriBankPermissions.BANK_ACCOUNTS_MANAGE)
    @Response.object(BankAccount)
    @Post('/accounts')
    async createAccount(
        @Body(NewBankAccount)
        account: NewBankAccount
    ): Promise<BankAccount> {
        return await this.accountRepository.create({ ...account, iban: normalizeIban(account.iban) });
    }

    @Auth.hasPermission(ZibriBankPermissions.BANK_TRANSACTIONS_READ)
    @Response.array(BankAccount)
    @Get('/accounts')
    async findAccounts(): Promise<BankAccount[]> {
        return await this.accountRepository.findAll({ order: { name: 'ASC' }, limit: 'all' });
    }

    @Auth.hasPermission(ZibriBankPermissions.BANK_STATEMENTS_IMPORT)
    @Response.object(BankStatementImport)
    @Post('/statements')
    async importStatements(
        @Body(BankStatementUpload, { type: MimeType.FORM_DATA })
        form: FormData<BankStatementUpload>
    ): Promise<BankStatementImport> {
        try {
            const data: Buffer = await buffer(FsUtilities.createReadStream(form.value.file.path));
            return await this.bankStatementService.importStatements({ name: form.value.file.originalname, data });
        }
        finally {
            await form.cleanup();
        }
    }

    @Auth.hasPermission(ZibriBankPermissions.BANK_TRANSACTIONS_READ)
    @Response.paginated(BankStatement)
    @Get('/statements')
    async findStatements(
        @Param.query('page', { type: 'number', format: 'integer', min: 1 })
        page: number,
        @Param.query('limit', { type: 'number', format: 'integer', min: 1, max: MAX_LIMIT })
        limit: number,
        @Param.query('accountId', { type: 'string', format: 'uuid', required: false })
        accountId: string | undefined
    ): Promise<PaginationResult<BankStatement>> {
        const where: Where<BankStatement> = accountId == undefined ? {} : { accountId };
        return await this.statementRepository.findAllPaginated(page, limit, { where, order: { periodEnd: 'DESC' } });
    }

    @Auth.hasPermission(ZibriBankPermissions.BANK_TRANSACTIONS_READ)
    @Response.paginated(BankTransactionDetails)
    @Get('/transactions')
    async findTransactions(
        @Param.query('page', { type: 'number', format: 'integer', min: 1 })
        page: number,
        @Param.query('limit', { type: 'number', format: 'integer', min: 1, max: MAX_LIMIT })
        limit: number,
        @Param.query('accountId', { type: 'string', format: 'uuid', required: false })
        accountId: string | undefined,
        @Param.query('statementId', { type: 'string', format: 'uuid', required: false })
        statementId: string | undefined,
        @Param.query('from', { type: 'date', required: false })
        from: Date | undefined,
        @Param.query('until', { type: 'date', required: false })
        until: Date | undefined,
        @Param.query('status', { type: 'string', enum: BankTransactionStatus, required: false })
        status: BankTransactionStatus | undefined
    ): Promise<PaginationResult<BankTransactionDetails>> {
        return await this.bankMatchService.findTransactionDetails(page, limit, { accountId, statementId, from, until, status });
    }

    @Auth.hasPermission(ZibriBankPermissions.BANK_TRANSACTIONS_READ)
    @Response.array(BankTransactionSuggestion)
    @Get('/transactions/:id/suggestions')
    async findSuggestions(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string
    ): Promise<BankTransactionSuggestion[]> {
        return await this.bankMatchService.findSuggestions(id);
    }

    @Auth.hasPermission(ZibriBankPermissions.BANK_MATCHES_READ)
    @Response.paginated(BankMatch)
    @Get('/matches')
    async findMatches(
        @Param.query('page', { type: 'number', format: 'integer', min: 1 })
        page: number,
        @Param.query('limit', { type: 'number', format: 'integer', min: 1, max: MAX_LIMIT })
        limit: number,
        @Param.query('transactionId', { type: 'string', format: 'uuid', required: false })
        transactionId: string | undefined,
        @Param.query('invoiceId', { type: 'string', format: 'uuid', required: false })
        invoiceId: string | undefined
    ): Promise<PaginationResult<BankMatch>> {
        return await this.bankMatchService.findMatches(page, limit, { transactionId, invoiceId });
    }

    @Auth.hasPermission(ZibriBankPermissions.BANK_MATCHES_SUGGEST)
    @Response.array(ApprovalRequestDetails)
    @Post('/matches/suggestions')
    async suggestMatches(): Promise<ApprovalRequestDetails[]> {
        return await this.bankMatchService.suggestMatches();
    }

    @Auth.hasPermission(ZibriBankPermissions.BANK_MATCHES_CONFIRM)
    @Response.object(BankMatch)
    @Post('/matches/:id/reversal')
    async reverseMatch(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @CurrentUser()
        user: CurrentUser
    ): Promise<BankMatch> {
        return await this.bankMatchService.reverseMatch(id, user.id);
    }
}