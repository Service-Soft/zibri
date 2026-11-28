import { ArchiveUtilities } from '../../../archive/archive.utilities';
import { type PaginationResult } from '../../../data-source/models/pagination-result.model';
import { type StringWhereFilter } from '../../../data-source/models/where/string-where-filter.model';
import { type Where } from '../../../data-source/models/where/where-filter.model';
import { Repository } from '../../../data-source/repository/repository';
import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { UniqueConstraintViolationError } from '../../../data-source/unique-constraint-violation.error';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error';
import { ConflictError } from '../../../error-handling/errors/conflict.error';
import { type FileRecord } from '../../../file/file-record.model';
import { $ts } from '../../../localization/translate.function';
import { FilterUtilities } from '../../../routing/filter/filter.utilities';
import { type OmitStrict } from '../../../types/omit-strict.type';
import { BigNumber, NumberUtilities } from '../../../utilities/number.utilities';
import { BookkeepingDayUtilities } from '../bookkeeping-day.utilities';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from '../bookkeeping.tokens';
import { BookkeepingAccount } from '../models/bookkeeping-account.model';
import { type BookkeepingPluginOptions } from '../models/bookkeeping-plugin-options.model';
import { type ExpenseData } from '../models/expense-data.model';
import { type ExpenseFilter } from '../models/expense-filter.model';
import { type ExpenseReceiptFile } from '../models/expense-receipt-file.model';
import { ExpenseReceipt } from '../models/expense-receipt.model';
import { Expense, type ExpenseCreateData } from '../models/expense.model';
import { type JournalEntryDetails } from '../models/journal-entry-details.model';
import { PostingSourceType } from '../models/posting-source-type.enum';
import { type ExpenseServiceInterface } from './expense-service.interface';

/**
 * What a receipt is created with: everything but what the repository and the chain fill in.
 */
type ExpenseReceiptCreateData = OmitStrict<ExpenseReceipt, 'id' | 'tenantId' | 'chainSequence' | 'chainHash' | 'archivedFiles'>;

/**
 * Default implementation of the expense service.
 */
@Injectable({ register: 'onUse' })
export class ExpenseService implements ExpenseServiceInterface {
    // read when used, like the repositories of the journal service: ZibriBookkeepingPlugin.validate names a missing
    // entity rather than a failed build of this
    private get expenseRepository(): Repository<Expense, ExpenseCreateData> {
        return inject(repositoryTokenFor(Expense));
    }

    private get receiptRepository(): Repository<ExpenseReceipt, ExpenseReceiptCreateData> {
        return inject(repositoryTokenFor(ExpenseReceipt));
    }

    private get accountRepository(): Repository<BookkeepingAccount> {
        return inject(repositoryTokenFor(BookkeepingAccount));
    }

    constructor(
        @Inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.OPTIONS)
        protected readonly options: BookkeepingPluginOptions
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findExpenses(page: number, limit: number, filter: ExpenseFilter): Promise<PaginationResult<Expense>> {
        const search: string | undefined = filter.search?.trim();
        const like: StringWhereFilter | undefined = search == undefined || search === ''
            ? undefined
            : { iLike: `%${FilterUtilities.escapeLike(search)}%` };
        const where: Where<Expense> | undefined = like == undefined
            ? undefined
            : [{ documentNumber: like }, { supplier: { where: { name: like } } }];
        return await this.expenseRepository.findAllPaginated(page, limit, { where, order: { documentDate: 'DESC' } });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createExpense(data: ExpenseData, transaction?: Transaction): Promise<Expense> {
        return await this.runInTransaction(transaction, async started => {
            await this.validateData(data, started);
            return await this.expenseRepository.create(
                { ...this.resolveData(data), recordedAt: null, postedEntryId: null, correctsExpenseId: null },
                { transaction: started }
            );
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateExpense(id: string, data: ExpenseData, transaction?: Transaction): Promise<Expense> {
        return await this.runInTransaction(transaction, async started => {
            const expense: Expense = await this.expenseRepository.findById(id, { transaction: started });
            this.validateDraft(expense);
            await this.validateData(data, started);
            return await this.expenseRepository.updateById(id, this.resolveData(data), { transaction: started });
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async recordExpense(id: string, transaction?: Transaction): Promise<Expense> {
        return await this.runInTransaction(transaction, async started => {
            const expense: Expense = await this.expenseRepository.findById(id, { transaction: started });
            if (expense.recordedAt != undefined) {
                throw new ConflictError($ts`The expense ${expense.documentNumber} is recorded already.`);
            }
            return await this.record(expense, started);
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async correctExpense(id: string, data: ExpenseData, transaction?: Transaction): Promise<Expense> {
        return await this.runInTransaction(transaction, async started => {
            const original: Expense = await this.expenseRepository.findById(id, { transaction: started });
            if (original.recordedAt == undefined) {
                throw new ConflictError($ts`The expense ${original.documentNumber} is a draft, which is changed rather than corrected.`);
            }
            if (await this.expenseRepository.exists({ where: { correctsExpenseId: id }, transaction: started })) {
                throw new ConflictError(
                    $ts`The expense ${original.documentNumber} is corrected already, and an expense is corrected once.`
                );
            }
            await this.validateData(data, started);
            let correction: Expense;
            try {
                correction = await this.expenseRepository.create(
                    { ...this.resolveData(data), recordedAt: null, postedEntryId: null, correctsExpenseId: original.id },
                    { transaction: started }
                );
            }
            catch (error) {
                // a correction of the same expense committed meanwhile, which the check above could not see yet
                if (error instanceof UniqueConstraintViolationError) {
                    throw new ConflictError(
                        $ts`The expense ${original.documentNumber} is corrected already, and an expense is corrected once.`,
                        { cause: error }
                    );
                }
                throw error;
            }
            if (original.postedEntryId != undefined) {
                await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.JOURNAL_SERVICE).reverse(
                    original.postedEntryId,
                    { postingDate: data.documentDate, text: $ts`Correction of the expense ${original.documentNumber}` },
                    started
                );
            }
            return await this.record(correction, started);
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createReceipt(file: ExpenseReceiptFile, transaction?: Transaction): Promise<ExpenseReceipt> {
        return await this.runInTransaction(transaction, async started => {
            const record: FileRecord = await inject(ZIBRI_DI_TOKENS.FILE_SERVICE).store(
                {
                    store: inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.RECEIPT_FILE_STORE),
                    name: file.name,
                    mimeType: file.mimeType,
                    data: file.data,
                    createdBy: file.uploadedBy ?? undefined
                },
                started
            );
            const uploadedAt: Date = new Date();
            return await this.receiptRepository.create(
                {
                    file: record.id,
                    uploadedAt,
                    uploadedBy: file.uploadedBy ?? null,
                    retainUntil: ArchiveUtilities.resolveRetainUntil(
                        uploadedAt,
                        { retention: this.options.receiptRetention, from: 'endOfYear' },
                        inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS).defaultTimezone
                    )
                },
                { transaction: started }
            );
        });
    }

    /**
     * Records an expense: posts it, and marks it recorded with the entry posted, in one transaction.
     * @param expense - The expense, a draft.
     * @param transaction - The transaction.
     * @returns The expense, recorded.
     */
    protected async record(expense: Expense, transaction: Transaction): Promise<Expense> {
        const posted: JournalEntryDetails | undefined = await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.POSTING_SERVICE)
            .postFor({ type: PostingSourceType.EXPENSE, expense }, transaction);
        return await this.expenseRepository.updateById(
            expense.id,
            { recordedAt: new Date(), postedEntryId: posted?.entry.id ?? null },
            { transaction }
        );
    }

    /**
     * Validates that an expense is a draft, which is changed.
     * @param expense - The expense.
     * @throws A ConflictError for a recorded one.
     */
    protected validateDraft(expense: Expense): void {
        if (expense.recordedAt != undefined) {
            throw new ConflictError(
                $ts`The expense ${expense.documentNumber} is recorded, and cannot be changed or deleted. A new expense corrects it.`
            );
        }
    }

    /**
     * Validates what an expense states: days, one total per rate, amounts of at least 0 adding up to more than 0, an
     * account of the books and a receipt of the tenant.
     * @param data - What the expense states.
     * @param transaction - The transaction.
     * @throws A BadRequestError for totals that do not hold, or a day with a time.
     * @throws A ConflictError for an account that is not one of the books, and a NotFoundError for a receipt the
     * tenant does not have.
     */
    protected async validateData(data: ExpenseData, transaction: Transaction): Promise<void> {
        BookkeepingDayUtilities.validateDay(data.documentDate, 'documentDate');
        if (data.dueDate != undefined) {
            BookkeepingDayUtilities.validateDay(data.dueDate, 'dueDate');
        }
        if (!data.totals.length) {
            throw new BadRequestError($ts`The totals of an expense need to name at least one VAT rate.`);
        }
        const rates: number[] = data.totals.map(t => t.rate);
        const twice: number | undefined = rates.find((rate, index) => rates.indexOf(rate) !== index);
        if (twice != undefined) {
            throw new BadRequestError($ts`The totals of an expense need to name each VAT rate once, and name ${twice} % twice.`);
        }
        if (data.totals.some(t => t.net.isLessThan(0) || t.tax.isLessThan(0))) {
            throw new BadRequestError($ts`The amounts of an expense need to be at least 0.`);
        }
        const total: BigNumber = data.totals.reduce(
            (sum, t) => NumberUtilities.add(NumberUtilities.add(sum, t.net), t.tax),
            NumberUtilities.new(0)
        );
        if (!total.isGreaterThan(0)) {
            throw new BadRequestError($ts`The total of an expense needs to be above 0.`);
        }
        if (!await this.accountRepository.exists({ where: { id: data.accountId }, transaction })) {
            throw new ConflictError($ts`The account of an expense needs to be an account of the books, and "${data.accountId}" is none.`);
        }
        if (data.receiptId != undefined) {
            await this.receiptRepository.findById(data.receiptId, { transaction });
        }
    }

    /**
     * Gets what an expense is written with from what it states.
     * @param data - What the expense states.
     * @returns The values of the expense.
     */
    protected resolveData(data: ExpenseData): OmitStrict<ExpenseCreateData, 'recordedAt' | 'postedEntryId' | 'correctsExpenseId'> {
        return {
            supplier: data.supplier,
            documentNumber: data.documentNumber,
            documentDate: data.documentDate,
            dueDate: data.dueDate ?? null,
            totals: data.totals,
            currency: data.currency,
            accountId: data.accountId,
            receiptId: data.receiptId ?? null
        };
    }

    /**
     * Runs work in the transaction given, or in one of its own.
     * @param transaction - The transaction of the caller, if any.
     * @param work - The work.
     * @returns What the work returns.
     */
    protected async runInTransaction<T>(transaction: Transaction | undefined, work: (transaction: Transaction) => Promise<T>): Promise<T> {
        return transaction == undefined
            ? await this.expenseRepository.dataSource.runInTransaction(work, { maxAttempts: 3 })
            : await work(transaction);
    }
}