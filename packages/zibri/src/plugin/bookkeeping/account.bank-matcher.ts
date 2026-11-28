import { Repository } from '../../data-source/repository/repository';
import { type Transaction } from '../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { inject } from '../../di/inject.function';
import { ConflictError } from '../../error-handling/errors/conflict.error';
import { $ts } from '../../localization/translate.function';
import { BankMatchReason } from '../bank/models/bank-match-reason.enum';
import { BankMatchTargetType } from '../bank/models/bank-match-target-type.enum';
import { type BankMatchTarget } from '../bank/models/bank-match-target.model';
import { type BankMatcherSuggestion } from '../bank/models/bank-matcher-suggestion.model';
import { type BankMatcherTransaction } from '../bank/models/bank-matcher-transaction.model';
import { type BankTransaction } from '../bank/models/bank-transaction.model';
import { normalizeIban } from '../bank/normalize-iban.function';
import { type BankMatcherInterface } from '../bank/services/bank-matcher.interface';
import { AccountMatchRule } from './models/account-match-rule.model';
import { BookkeepingAccount } from './models/bookkeeping-account.model';

/**
 * Matches bank transactions with accounts of the books, for the bank plugin: what pays no invoice and no expense, such
 * as a deposit of capital or a transfer between own accounts. Suggests the account of each account match rule that
 * names the counterparty or the text of a transaction, with a confidence of 0.5 for each of the two it names. Such a
 * match is always confirmed by a person. Registered into the matchers of the bank plugin by `ZibriBookkeepingPlugin`.
 */
@Injectable({ register: 'onUse' })
export class AccountBankMatcher implements BankMatcherInterface {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly targetType: BankMatchTargetType = BankMatchTargetType.ACCOUNT;

    // read when used, as the bank plugin is only there in an application that matches
    private get ruleRepository(): Repository<AccountMatchRule> {
        return inject(repositoryTokenFor(AccountMatchRule));
    }

    private get accountRepository(): Repository<BookkeepingAccount> {
        return inject(repositoryTokenFor(BookkeepingAccount));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveSuggestions(transactions: BankMatcherTransaction[]): Promise<BankMatcherSuggestion[]> {
        const rules: AccountMatchRule[] = await this.ruleRepository.findAll({ limit: 'all' });
        if (!rules.length) {
            return [];
        }
        return transactions.flatMap(({ transaction }) => rules
            .filter(rule => this.isMatching(rule, transaction))
            .map(rule => ({
                transactionId: transaction.id,
                targetId: rule.accountId,
                targetOpen: null,
                score: {
                    confidence: (rule.counterpartyIban == undefined ? 0 : 0.5) + (rule.text == undefined ? 0 : 0.5),
                    reasons: [BankMatchReason.ACCOUNT_RULE]
                }
            })));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveTarget(
        targetId: string,
        _bankTransaction: BankTransaction,
        transaction: Transaction | undefined
    ): Promise<BankMatchTarget> {
        const account: BookkeepingAccount = await this.accountRepository.findById(targetId, { transaction });
        if (account.closedAt != undefined) {
            throw new ConflictError($ts`The account ${account.number} ${account.name} is closed, and a match needs an open account.`);
        }
        return {
            label: $ts`the account ${account.number} ${account.name}`,
            open: null,
            row: { entity: BookkeepingAccount, stored: account, values: {} }
        };
    }

    /**
     * Whether a rule applies to a transaction: the transaction has what the rule names.
     * @param rule - The rule, naming an IBAN, a text, or both.
     * @param transaction - The transaction.
     * @returns True when it applies.
     */
    protected isMatching(rule: AccountMatchRule, transaction: BankTransaction): boolean {
        if (rule.counterpartyIban == undefined && rule.text == undefined) {
            return false;
        }
        if (rule.counterpartyIban != undefined
            && (transaction.counterpartyIban == undefined || normalizeIban(transaction.counterpartyIban) !== rule.counterpartyIban)) {
            return false;
        }
        if (rule.text != undefined) {
            const text: string = [transaction.remittanceInformation, transaction.counterpartyName]
                .filter(t => t != undefined)
                .join(' ')
                .toLowerCase();
            return text.includes(rule.text.toLowerCase());
        }
        return true;
    }
}