import { ArchiveUtilities } from '../../../archive/archive.utilities';
import { Where } from '../../../data-source/models/where/where-filter.model';
import { Repository } from '../../../data-source/repository/repository';
import { Transaction } from '../../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { ConflictError } from '../../../error-handling/errors/conflict.error';
import { InternalError } from '../../../error-handling/internal-error.model';
import { FileRecord } from '../../../file/file-record.model';
import { MimeType } from '../../../http/mime-type.enum';
import { $ts } from '../../../localization/translate.function';
import { OmitStrict } from '../../../types/omit-strict.type';
import { Ms } from '../../../utilities/ms';
import { BigNumber, NumberUtilities } from '../../../utilities/number.utilities';
import { ZIBRI_BANK_PLUGIN_DI_TOKENS } from '../bank.tokens';
import { CamtStatementData } from '../camt/camt-statement-data.model';
import { CamtTransactionData } from '../camt/camt-transaction-data.model';
import { Camt053Utilities } from '../camt/camt053.utilities';
import { BankAccount } from '../models/bank-account.model';
import { type BankPluginOptions } from '../models/bank-plugin-options.model';
import { BankStatementFile } from '../models/bank-statement-file.model';
import { BankStatementImport } from '../models/bank-statement-import.model';
import { BankStatement } from '../models/bank-statement.model';
import { BankTransaction } from '../models/bank-transaction.model';
import { BankStatementServiceInterface } from './bank-statement-service.interface';

/**
 * What a statement is created with: everything but what the repository and the chain fill in.
 */
type BankStatementCreateData = OmitStrict<BankStatement, 'id' | 'tenantId' | 'chainSequence' | 'chainHash' | 'archivedFiles'>;

/**
 * What a transaction is created with.
 */
type BankTransactionCreateData = OmitStrict<BankTransaction, 'id' | 'tenantId'>;

/**
 * Where the import of a file stands for one account: the statement the next one continues, and the transactions
 * stored by the statements of the file before.
 */
type AccountImport = {
    /**
     * The statement imported last, undefined before the first.
     */
    previous: BankStatement | undefined,
    /**
     * The keys of the transactions the file stored so far.
     */
    storedKeys: Set<string>
};

/**
 * How many keys one read looks for, so that a file of a year of bookings is read in pages.
 */
const KEYS_PER_READ: number = 500;

/**
 * Default implementation of the bank statement service.
 */
@Injectable({ register: 'onUse' })
export class BankStatementService implements BankStatementServiceInterface {
    // read when used, like the repositories of the invoicing services: ZibriBankPlugin.validate names a missing
    // entity rather than a failed build of this
    private get accountRepository(): Repository<BankAccount> {
        return inject(repositoryTokenFor(BankAccount));
    }

    private get statementRepository(): Repository<BankStatement, BankStatementCreateData> {
        return inject(repositoryTokenFor(BankStatement));
    }

    private get transactionRepository(): Repository<BankTransaction, BankTransactionCreateData> {
        return inject(repositoryTokenFor(BankTransaction));
    }

    constructor(
        @Inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.OPTIONS)
        protected readonly options: BankPluginOptions
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async importStatements(file: BankStatementFile, transaction?: Transaction): Promise<BankStatementImport> {
        // read before the lease, which a file that cannot be read never waits for
        const statements: CamtStatementData[] = this.sortStatements(await Camt053Utilities.resolveStatements(file.data.toString('utf8')));
        const tenantId: string | undefined = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).getActiveTenantId();
        // one import of a tenant at a time: each reads the statement the next one continues, which another import
        // running at once would not see yet
        const res: BankStatementImport | undefined = await inject(ZIBRI_DI_TOKENS.LEASE_SERVICE).withLease(
            {
                key: `zibri.bank:${tenantId ?? ''}`,
                mode: 'wait',
                leaseInMs: Ms.MINUTE,
                acquireTimeoutInMs: Ms.MINUTE * 5,
                heldUntil: transaction
            },
            async () => transaction == undefined
                ? await this.statementRepository.dataSource.runInTransaction(
                    async started => await this.importInTransaction(file, statements, started),
                    { maxAttempts: 3 }
                )
                : await this.importInTransaction(file, statements, transaction)
        );
        if (res == undefined) {
            throw new InternalError('Could not take the lease to import the bank statements.');
        }
        return res;
    }

    /**
     * Sorts the statements of a file the order they follow each other in: by account, then by their opening date and
     * the number the bank counts them with.
     * @param statements - The statements, in the order of the file.
     * @returns The statements, sorted.
     */
    protected sortStatements(statements: CamtStatementData[]): CamtStatementData[] {
        return [...statements].sort((a, b) => a.iban.localeCompare(b.iban)
            || a.openingBalanceDate.getTime() - b.openingBalanceDate.getTime()
            || (a.electronicSequenceNumber ?? 0) - (b.electronicSequenceNumber ?? 0));
    }

    /**
     * Imports the statements of a file in a transaction.
     * @param file - The file.
     * @param statements - Its statements, sorted.
     * @param transaction - The transaction.
     * @returns What was stored, and what was skipped.
     */
    protected async importInTransaction(
        file: BankStatementFile,
        statements: CamtStatementData[],
        transaction: Transaction
    ): Promise<BankStatementImport> {
        const accounts: Map<string, BankAccount> = await this.resolveAccounts(statements, transaction);
        const imports: Map<string, AccountImport> = new Map();
        const res: BankStatementImport = { statements: [], skippedStatementCount: 0, transactionCount: 0, skippedTransactionCount: 0 };
        // the transactions of money received stored, which matching suggests invoices for
        const received: string[] = [];
        // one statement after the other, as the rows of one transaction are written over one connection
        for (const statement of statements) {
            const account: BankAccount | undefined = accounts.get(statement.iban);
            if (account == undefined) {
                throw new InternalError(`The account of ${statement.iban} was not resolved.`);
            }
            this.validateCurrency(statement, account);
            const current: AccountImport = imports.get(account.id)
                ?? { previous: await this.findLatestStatement(account, transaction), storedKeys: new Set() };
            imports.set(account.id, current);

            const where: Where<BankStatement> = { accountId: account.id, bankStatementId: statement.bankStatementId };
            if (await this.statementRepository.exists({ where, transaction })) {
                res.skippedStatementCount++;
                res.skippedTransactionCount += statement.transactions.length;
                continue;
            }
            const stored: Set<string> = await this.findStoredKeys(account, statement.transactions, current.storedKeys, transaction);
            const known: CamtTransactionData[] = statement.transactions.filter(t => stored.has(t.deduplicationKey));
            const fresh: CamtTransactionData[] = statement.transactions.filter(t => !stored.has(t.deduplicationKey));
            // a statement of bookings that are all stored already, such as one of a period another file covered, adds
            // nothing, and is not the statement the next one continues
            if (known.length && !fresh.length) {
                res.skippedStatementCount++;
                res.skippedTransactionCount += known.length;
                continue;
            }
            if (current.previous != undefined) {
                this.validateContinues(statement, known, current.previous);
            }

            const created: BankStatement = await this.createStatement(file, statement, account, transaction);
            const createdTransactions: BankTransaction[] = await this.transactionRepository.createAll(
                fresh.map(t => ({ ...t, accountId: account.id, statementId: created.id })),
                { transaction }
            );
            received.push(...createdTransactions.filter(t => t.amount.isGreaterThan(0)).map(t => t.id));
            current.previous = created;
            for (const t of fresh) {
                current.storedKeys.add(t.deduplicationKey);
            }
            res.statements.push(created);
            res.transactionCount += fresh.length;
            res.skippedTransactionCount += known.length;
        }
        if (this.options.matching != undefined && received.length) {
            this.suggestMatchesOnceCommitted(received, transaction);
        }
        return res;
    }

    /**
     * Suggests the invoices the transactions of an import pay, once the import is committed.
     * @param transactionIds - The transactions of money received the import stored.
     * @param transaction - The transaction of the import.
     */
    protected suggestMatchesOnceCommitted(transactionIds: string[], transaction: Transaction): void {
        // after the commit, so that a suggestion names transactions that are stored, and a policy approving one writes
        // its match in a transaction of its own
        transaction.afterCommit(async () => {
            try {
                await inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.BANK_MATCH_SERVICE).suggestMatches(transactionIds);
            }
            catch (error) {
                // the import is stored either way, and the route suggesting again covers what was not suggested
                inject(ZIBRI_DI_TOKENS.LOGGER).error(
                    new InternalError('Could not suggest matches for the imported bank transactions.', { cause: error })
                );
            }
        });
    }

    /**
     * Resolves the bank accounts of the current tenant the statements of a file are of.
     * @param statements - The statements.
     * @param transaction - The transaction.
     * @returns The accounts, by IBAN.
     * @throws A ConflictError naming the first IBAN the tenant has no account of.
     */
    protected async resolveAccounts(statements: CamtStatementData[], transaction: Transaction): Promise<Map<string, BankAccount>> {
        const ibans: string[] = [...new Set(statements.map(s => s.iban))];
        const accounts: BankAccount[] = await this.accountRepository.findAll({ where: { iban: { oneOf: ibans } }, transaction });
        const res: Map<string, BankAccount> = new Map(accounts.map(a => [a.iban, a]));
        const unknown: string | undefined = ibans.find(iban => !res.has(iban));
        if (unknown != undefined) {
            throw new ConflictError(
                // eslint-disable-next-line stylistic/max-len
                $ts`The file holds a statement of the IBAN ${unknown}, which needs to be added as a bank account before its statements are imported.`
            );
        }
        return res;
    }

    /**
     * Finds the keys of the transactions of a statement that are stored already.
     * @param account - The account of the statement.
     * @param transactions - The transactions of the statement.
     * @param storedByFile - The keys the statements of the file before it stored.
     * @param transaction - The transaction.
     * @returns The keys stored.
     */
    protected async findStoredKeys(
        account: BankAccount,
        transactions: CamtTransactionData[],
        storedByFile: Set<string>,
        transaction: Transaction
    ): Promise<Set<string>> {
        const res: Set<string> = new Set(transactions.map(t => t.deduplicationKey).filter(key => storedByFile.has(key)));
        const keys: string[] = transactions.map(t => t.deduplicationKey).filter(key => !res.has(key));
        // one page after the other, as the reads of one transaction run over one connection
        for (let start: number = 0; start < keys.length; start += KEYS_PER_READ) {
            const page: string[] = keys.slice(start, start + KEYS_PER_READ);
            const found: Pick<BankTransaction, 'deduplicationKey'>[] = await this.transactionRepository.findAll({
                where: { accountId: account.id, deduplicationKey: { oneOf: page } },
                select: { deduplicationKey: true },
                limit: page.length,
                transaction
            });
            for (const row of found) {
                res.add(row.deduplicationKey);
            }
        }
        return res;
    }

    /**
     * Finds the statement of an account imported last, which the next one continues.
     * @param account - The account.
     * @param transaction - The transaction.
     * @returns The statement, or undefined for an account without one.
     */
    protected async findLatestStatement(account: BankAccount, transaction: Transaction): Promise<BankStatement | undefined> {
        // the chain counts the statements of a tenant in the order they were imported, and every one imported after
        // the first continued the one before it
        const [latest] = await this.statementRepository.findAll({
            where: { accountId: account.id },
            order: { chainSequence: 'DESC' },
            limit: 1,
            transaction
        });
        return latest;
    }

    /**
     * Validates that a statement is in the currency of its account.
     * @param statement - The statement.
     * @param account - The account.
     * @throws A ConflictError when it is not.
     */
    protected validateCurrency(statement: CamtStatementData, account: BankAccount): void {
        if (statement.currency !== account.currency) {
            throw new ConflictError(
                // eslint-disable-next-line stylistic/max-len
                $ts`The statement "${statement.bankStatementId}" needs to be in ${account.currency}, the currency of the account ${account.iban}.`
            );
        }
    }

    /**
     * Validates that a statement continues the one imported before it: its opening balance, with the bookings it shares
     * with the statements imported before, is where that statement closed.
     * @param statement - The statement.
     * @param known - Its transactions that are stored already.
     * @param previous - The statement imported before it.
     * @throws A ConflictError when a statement between them is missing.
     */
    protected validateContinues(statement: CamtStatementData, known: CamtTransactionData[], previous: BankStatement): void {
        // a statement overlapping the one before opens before it closed, by the bookings both hold
        const continued: BigNumber = known.reduce((sum, t) => NumberUtilities.add(sum, t.amount), statement.openingBalance);
        if (NumberUtilities.compare(continued, previous.closingBalance) !== 0) {
            const opening: string = statement.openingBalance.toFixed();
            const closing: string = previous.closingBalance.toFixed();
            const closedOn: string = previous.closingBalanceDate.toISOString().slice(0, 10);
            throw new ConflictError([
                // eslint-disable-next-line stylistic/max-len
                $ts`The statement "${statement.bankStatementId}" of ${statement.iban} opens with ${opening}, and needs to continue the statement "${previous.bankStatementId}", which closed with ${closing} on ${closedOn}.`,
                $ts`Import the statements between them first.`
            ]);
        }
    }

    /**
     * Creates a statement with its original file, kept for the retention of the plugin.
     * @param file - The file.
     * @param statement - The statement.
     * @param account - Its account.
     * @param transaction - The transaction.
     * @returns The statement.
     */
    protected async createStatement(
        file: BankStatementFile,
        statement: CamtStatementData,
        account: BankAccount,
        transaction: Transaction
    ): Promise<BankStatement> {
        // a file of its own for each statement, whose bytes the file service keeps once: each is deleted with its
        // statement, once the retention of that one ended
        const record: FileRecord = await inject(ZIBRI_DI_TOKENS.FILE_SERVICE).store(
            {
                store: inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.STATEMENT_FILE_STORE),
                name: file.name,
                mimeType: MimeType.XML,
                data: file.data,
                createdBy: file.importedBy
            },
            transaction
        );
        return await this.statementRepository.create(
            {
                bankStatementId: statement.bankStatementId,
                electronicSequenceNumber: statement.electronicSequenceNumber,
                issuedAt: statement.issuedAt,
                periodStart: statement.periodStart,
                periodEnd: statement.periodEnd,
                openingBalance: statement.openingBalance,
                openingBalanceDate: statement.openingBalanceDate,
                closingBalance: statement.closingBalance,
                closingBalanceDate: statement.closingBalanceDate,
                currency: statement.currency,
                format: statement.format,
                accountId: account.id,
                file: record.id,
                importedAt: new Date(),
                importedBy: record.createdBy ?? null,
                retainUntil: ArchiveUtilities.resolveRetainUntil(
                    statement.issuedAt,
                    { retention: this.options.retention, from: 'endOfYear' },
                    inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS).defaultTimezone
                )
            },
            { transaction }
        );
    }
}