import { ZibriApplication } from '../../application/application';
import { ArchiveUtilities } from '../../archive/archive.utilities';
import { KEPT_ROW_CHECK_DI_VARIANT } from '../../backup/kept-row-check.interface';
import { CronJob } from '../../cron/cron-job.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { DiProvider } from '../../di/models/di-provider.model';
import { DiTokenProviderRecord, providersFromTokenRecord } from '../../di/models/di-token.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { Newable } from '../../types/newable.type';
import { validateEntitiesRegistered } from '../../utilities/validate-entities-registered.function';
import { validateTokensRegistered } from '../../utilities/validate-tokens-registered.function';
import { APPROVAL_ACTION_DI_VARIANT, ZIBRI_APPROVAL_PLUGIN_DI_TOKENS } from '../approval/approval.tokens';
import { ApprovalRequest } from '../approval/models/approval-request.model';
import { INVOICE_PAYMENT_SOURCE_DI_VARIANT, ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../invoicing/invoicing.tokens';
import { Invoice } from '../invoicing/models/invoice.model';
import { ZibriPlugin } from '../plugin.model';
import { BankMatchApprovalAction } from './bank-match.approval-action';
import { BankMatchWriteObserver } from './bank-match.write-observer';
import { BankTransactionStateCronJob } from './bank-transaction-state.cron-job';
import { BankTransactionWriteObserver } from './bank-transaction.write-observer';
import { ZIBRI_BANK_PLUGIN_DI_TOKENS } from './bank.tokens';
import { BankAccount } from './models/bank-account.model';
import { BankMatch } from './models/bank-match.model';
import { BankPluginOptionsInput } from './models/bank-plugin-options-input.model';
import { BankPluginOptions } from './models/bank-plugin-options.model';
import { BANK_STATEMENT_FILE_STORE_NAME } from './models/bank-statement-file-store-name.model';
import { BankStatement } from './models/bank-statement.model';
import { BankTransactionState } from './models/bank-transaction-state.model';
import { BankTransaction } from './models/bank-transaction.model';
import { BankMatchService } from './services/bank-match.service';
import { BankStatementService } from './services/bank-statement.service';

/**
 * Plugin that imports the statements of bank accounts from CAMT.053 files, keeps each original file archived, and,
 * with `matching` of its options, matches the transactions received with the invoices they pay.
 */
export class ZibriBankPlugin extends ZibriPlugin {
    private readonly defaultDiProviders: DiTokenProviderRecord<typeof ZIBRI_BANK_PLUGIN_DI_TOKENS> = {
        OPTIONS_INPUT: { useFactory: () => ({}) },
        OPTIONS: {
            useFactory: () => {
                const input: BankPluginOptionsInput = inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.OPTIONS_INPUT);
                // 8 years from the end of the year: § 147 AO keeps the documents behind the books, bank statements
                // among them, that long since the Bürokratieentlastungsgesetz IV of 2025
                const res: BankPluginOptions = { store: BANK_STATEMENT_FILE_STORE_NAME, retention: { years: 8 }, ...input };
                return res;
            }
        },
        STATEMENT_FILE_STORE: { useFactory: () => inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.OPTIONS).store },
        BANK_STATEMENT_SERVICE: { useClass: BankStatementService },
        BANK_MATCH_SERVICE: { useClass: BankMatchService },
        // registered whether or not the bank plugin matches, as providers are: without matching it answers no payments
        INVOICE_PAYMENT_SOURCE: {
            useFactory: () => inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.BANK_MATCH_SERVICE),
            variants: [INVOICE_PAYMENT_SOURCE_DI_VARIANT]
        },
        BANK_MATCH_APPROVAL_ACTION: { useClass: BankMatchApprovalAction, variants: [APPROVAL_ACTION_DI_VARIANT] },
        KEPT_ROW_CHECK: { useFactory: () => inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.BANK_MATCH_SERVICE), variants: [KEPT_ROW_CHECK_DI_VARIANT] }
    };

    override providers: DiProvider<unknown>[] = providersFromTokenRecord(ZIBRI_BANK_PLUGIN_DI_TOKENS, this.defaultDiProviders);

    override cronJobs: Newable<CronJob>[] = [BankTransactionStateCronJob];

    override additionalLifecycleServices: Newable<unknown>[] = [BankTransactionWriteObserver, BankMatchWriteObserver];

    // eslint-disable-next-line jsdoc/require-jsdoc
    validate(app: ZibriApplication): void {
        validateEntitiesRegistered(this.constructor.name, app, BankAccount, BankStatement, BankTransaction, BankTransactionState);
        validateTokensRegistered(this.constructor.name, ZIBRI_BANK_PLUGIN_DI_TOKENS);
        // a state is created in the transaction of its transaction
        const transactions: Repository<BankTransaction> = inject(repositoryTokenFor(BankTransaction));
        if (inject<Repository<BankTransactionState>>(repositoryTokenFor(BankTransactionState)).dataSource !== transactions.dataSource) {
            throw new InternalError(`${this.constructor.name} needs BankTransactionState in the data source of BankTransaction.`);
        }
        const options: BankPluginOptions = inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.OPTIONS);
        ArchiveUtilities.validateRetention(options.retention);
        if (options.matching != undefined) {
            this.validateMatching(app, options);
        }
    }

    /**
     * Validates what matching transactions with invoices needs: the approval and the invoicing plugin, and the matches
     * in the data source of the approval requests.
     * @param app - The application.
     * @param options - The options of the plugin.
     * @throws When something is missing.
     */
    private validateMatching(app: ZibriApplication, options: BankPluginOptions): void {
        validateEntitiesRegistered(this.constructor.name, app, BankMatch, Invoice, ApprovalRequest);
        validateTokensRegistered(this.constructor.name, {
            APPROVAL_REQUEST_SERVICE: ZIBRI_APPROVAL_PLUGIN_DI_TOKENS.APPROVAL_REQUEST_SERVICE,
            INVOICE_PAYMENT_SERVICE: ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_PAYMENT_SERVICE
        });
        // a match is written in the transaction the approval of its request is recorded in
        const matches: Repository<BankMatch> = inject(repositoryTokenFor(BankMatch));
        const requests: Repository<ApprovalRequest> = inject(repositoryTokenFor(ApprovalRequest));
        if (matches.dataSource !== requests.dataSource) {
            throw new InternalError(`${this.constructor.name} needs BankMatch in the data source of ApprovalRequest.`);
        }
        // and the state of its transaction in the transaction of the match
        if (matches.dataSource !== inject<Repository<BankTransaction>>(repositoryTokenFor(BankTransaction)).dataSource) {
            throw new InternalError(`${this.constructor.name} needs BankMatch in the data source of BankTransaction.`);
        }
        const confidence: number | undefined = options.matching?.autoApproveConfidence;
        if (confidence != undefined && (confidence <= 0 || confidence > 1)) {
            throw new InternalError(`${this.constructor.name} needs an autoApproveConfidence above 0 and at most 1.`);
        }
        const tolerance: number | undefined = options.matching?.paymentDifferenceTolerance;
        if (tolerance == undefined || !Number.isFinite(tolerance) || tolerance < 0) {
            throw new InternalError(`${this.constructor.name} needs a paymentDifferenceTolerance of at least 0 in its matching options.`);
        }
    }
}