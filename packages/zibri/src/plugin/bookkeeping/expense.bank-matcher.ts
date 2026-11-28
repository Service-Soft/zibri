import { Repository } from '../../data-source/repository/repository';
import { type Transaction } from '../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { inject } from '../../di/inject.function';
import { ConflictError } from '../../error-handling/errors/conflict.error';
import { $ts } from '../../localization/translate.function';
import { BigNumber, NumberUtilities } from '../../utilities/number.utilities';
import { BankMatchUtilities } from '../bank/bank-match.utilities';
import { BankMatchReason } from '../bank/models/bank-match-reason.enum';
import { type BankMatchScore } from '../bank/models/bank-match-score.model';
import { BankMatchTargetType } from '../bank/models/bank-match-target-type.enum';
import { type BankMatchTarget } from '../bank/models/bank-match-target.model';
import { BankMatch } from '../bank/models/bank-match.model';
import { type BankMatcherSuggestion } from '../bank/models/bank-matcher-suggestion.model';
import { type BankMatcherTransaction } from '../bank/models/bank-matcher-transaction.model';
import { type BankTransaction } from '../bank/models/bank-transaction.model';
import { type BankMatcherInterface } from '../bank/services/bank-matcher.interface';
import { Expense } from './models/expense.model';

/**
 * An expense that money paid may pay, with what of it is open.
 */
type OpenExpense = {
    /**
     * The expense.
     */
    expense: Expense,
    /**
     * What of it is open.
     */
    open: BigNumber
};

/**
 * Matches money paid with the recorded expenses it pays, for the bank plugin: by the document number in the
 * remittance information, the amount and the name of the supplier. Registered into the matchers of the bank plugin by
 * `ZibriBookkeepingPlugin`.
 */
@Injectable({ register: 'onUse' })
export class ExpenseBankMatcher implements BankMatcherInterface {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly targetType: BankMatchTargetType = BankMatchTargetType.EXPENSE;

    // read when used, as the bank plugin is only there in an application that matches
    private get expenseRepository(): Repository<Expense> {
        return inject(repositoryTokenFor(Expense));
    }

    private get matchRepository(): Repository<BankMatch> {
        return inject(repositoryTokenFor(BankMatch));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveSuggestions(transactions: BankMatcherTransaction[]): Promise<BankMatcherSuggestion[]> {
        const paid: BankMatcherTransaction[] = transactions.filter(t => t.transaction.amount.isLessThan(0));
        if (!paid.length) {
            return [];
        }
        const expenses: OpenExpense[] = await this.findOpenExpenses(new Set(paid.map(t => t.transaction.currency)));
        return paid.flatMap(({ transaction, open }) => expenses
            .filter(e => e.expense.currency === transaction.currency)
            .flatMap(e => {
                const score: BankMatchScore | undefined = this.resolveScore(transaction, open, e);
                return score == undefined ? [] : [{ transactionId: transaction.id, targetId: e.expense.id, targetOpen: e.open, score }];
            }));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveTarget(
        targetId: string,
        bankTransaction: BankTransaction,
        transaction: Transaction | undefined
    ): Promise<BankMatchTarget> {
        const expense: Expense = await this.expenseRepository.findById(targetId, { transaction });
        const documentNumber: string = expense.documentNumber;
        if (expense.recordedAt == undefined) {
            throw new ConflictError($ts`The expense ${documentNumber} is a draft, and a match needs a recorded expense.`);
        }
        if (await this.expenseRepository.exists({ where: { correctsExpenseId: expense.id }, transaction })) {
            throw new ConflictError($ts`The expense ${documentNumber} is corrected by another, which a match pays instead.`);
        }
        if (!bankTransaction.amount.isLessThan(0)) {
            throw new ConflictError($ts`The transaction is money received, and a match of an expense needs money paid.`);
        }
        if (expense.currency !== bankTransaction.currency) {
            throw new ConflictError($ts`A match of the expense ${documentNumber} needs a transaction in ${expense.currency}.`);
        }
        const matched: Map<string, BigNumber> = await this.resolveMatchedAmounts([expense.id], transaction);
        return {
            label: $ts`the expense ${documentNumber} of ${expense.supplier.name}`,
            open: NumberUtilities.subtract(this.resolveTotal(expense), matched.get(expense.id) ?? 0),
            row: { entity: Expense, stored: expense, values: {} }
        };
    }

    /**
     * Scores how sure the matching is that money paid pays an expense.
     * @param transaction - The transaction.
     * @param open - What of it is left.
     * @param expense - The expense, with what of it is open.
     * @returns The score, or undefined below the confidence a suggestion needs.
     */
    protected resolveScore(transaction: BankTransaction, open: BigNumber, expense: OpenExpense): BankMatchScore | undefined {
        const reasons: Exclude<BankMatchReason, BankMatchReason.ACCOUNT_RULE>[] = [];
        const text: string = [transaction.remittanceInformation, transaction.endToEndId].filter(t => t != undefined).join(' ');
        if (BankMatchUtilities.containsInvoiceNumber(text, expense.expense.documentNumber)) {
            reasons.push(BankMatchReason.DOCUMENT_NUMBER);
        }
        if (NumberUtilities.compare(open, expense.open) === 0) {
            reasons.push(BankMatchReason.AMOUNT);
        }
        if (BankMatchUtilities.isNamed(transaction.counterpartyName, expense.expense.supplier.name)) {
            reasons.push(BankMatchReason.COUNTERPARTY_NAME);
        }
        return BankMatchUtilities.resolveScoreOf(reasons);
    }

    /**
     * Finds the recorded expenses of the active tenant in the given currencies that are open: not corrected by another
     * and not paid in full.
     * @param currencies - The currencies.
     * @returns The expenses, with what of each is open.
     */
    protected async findOpenExpenses(currencies: Set<string>): Promise<OpenExpense[]> {
        const recorded: Expense[] = await this.expenseRepository.findAll({ where: { recordedAt: { not: null } }, limit: 'all' });
        const corrected: Set<string> = new Set(recorded.flatMap(e => e.correctsExpenseId == undefined ? [] : [e.correctsExpenseId]));
        const expenses: Expense[] = recorded.filter(e => currencies.has(e.currency) && !corrected.has(e.id));
        const matched: Map<string, BigNumber> = await this.resolveMatchedAmounts(expenses.map(e => e.id), undefined);
        return expenses.flatMap(expense => {
            const open: BigNumber = NumberUtilities.subtract(this.resolveTotal(expense), matched.get(expense.id) ?? 0);
            return open.isGreaterThan(0) ? [{ expense, open }] : [];
        });
    }

    /**
     * Resolves what the matches of expenses pay of each.
     * @param expenseIds - The ids of the expenses.
     * @param transaction - The transaction to read in, if any.
     * @returns What is paid, by the id of the expense.
     */
    protected async resolveMatchedAmounts(expenseIds: string[], transaction: Transaction | undefined): Promise<Map<string, BigNumber>> {
        const res: Map<string, BigNumber> = new Map();
        if (!expenseIds.length) {
            return res;
        }
        const matches: BankMatch[] = await this.matchRepository.findAll({
            where: { targetType: BankMatchTargetType.EXPENSE, targetId: { oneOf: expenseIds } },
            limit: 'all',
            transaction
        });
        for (const match of matches) {
            res.set(match.targetId, NumberUtilities.add(res.get(match.targetId) ?? 0, match.amount));
        }
        return res;
    }

    /**
     * Resolves what an expense comes to after tax.
     * @param expense - The expense.
     * @returns Its total.
     */
    protected resolveTotal(expense: Expense): BigNumber {
        return expense.totals.reduce((sum, t) => NumberUtilities.add(NumberUtilities.add(sum, t.net), t.tax), NumberUtilities.new(0));
    }
}