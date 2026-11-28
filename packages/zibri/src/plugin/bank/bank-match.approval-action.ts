import { type Permission } from '../../auth/roles/permission.type';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { ConflictError } from '../../error-handling/errors/conflict.error';
import { type LocalizeServiceInterface } from '../../localization/localize-service.interface';
import { isCurrencyCode } from '../../localization/models/currency-code.model';
import { $ts } from '../../localization/translate.function';
import { type ApprovalActionDescription } from '../approval/models/approval-action-description.model';
import { type ApprovalAction } from '../approval/models/approval-action.model';
import { ApprovalActorKind } from '../approval/models/approval-actor-kind.enum';
import { type ApprovalPolicy } from '../approval/models/approval-policy.model';
import { type ApprovalRowChange } from '../approval/models/approval-row-change.model';
import { type ApprovalRunContext } from '../approval/models/approval-run-context.model';
import { Invoice } from '../invoicing/models/invoice.model';
import { ZIBRI_BANK_PLUGIN_DI_TOKENS } from './bank.tokens';
import { BANK_MATCH_ACTION_NAME } from './models/bank-match-action-name.model';
import { BankMatchInput } from './models/bank-match-input.model';
import { type BankMatchTarget } from './models/bank-match-target.model';
import { BankMatchTargetType } from './models/bank-match-target-type.enum';
import { BankMatch } from './models/bank-match.model';
import { type BankPluginOptions } from './models/bank-plugin-options.model';
import { BankTransaction } from './models/bank-transaction.model';
import { ZibriBankPermissions } from './models/zibri-bank-permissions.model';

/**
 * The approval action `bank.match`: matches a part of a bank transaction with an invoice it pays, or with what a
 * matcher of `BANK_MATCHER_DI_VARIANT` matches it with, such as an expense or an account. The bank plugin proposes its
 * suggestions as requests of it, which a user with `bank.matches.confirm` approves, or the policy of
 * `autoApproveConfidence` of the matching options, which never approves a match of an account. Without `matching` of
 * the bank plugin options, it refuses every proposal with a ConflictError.
 */
@Injectable({ register: 'onUse' })
export class BankMatchApprovalAction implements ApprovalAction<BankMatchInput, BankMatch> {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = BANK_MATCH_ACTION_NAME;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly input: typeof BankMatchInput = BankMatchInput;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly permission: Permission = ZibriBankPermissions.BANK_MATCHES_CONFIRM;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly proposePermission: Permission = ZibriBankPermissions.BANK_MATCHES_SUGGEST;

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly policies: ApprovalPolicy<BankMatchInput>[];

    constructor(
        @Inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.OPTIONS)
        protected readonly options: BankPluginOptions
    ) {
        const threshold: number | undefined = options.matching?.autoApproveConfidence;
        // the confidence of the system's own suggestions only: a user proposing a match names its confidence
        // themselves. Never a match of an account, which books money that pays no document, such as a deposit of
        // capital, and which a person confirms whatever its confidence
        this.policies = threshold == undefined
            ? []
            : [
                {
                    name: `confidence-at-least-${threshold}`,
                    approves: (input, request) => request.proposedByKind === ApprovalActorKind.SYSTEM
                        && input.targetType !== BankMatchTargetType.ACCOUNT
                        && input.confidence != undefined
                        && input.confidence >= threshold
                }
            ];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async describe(input: BankMatchInput): Promise<ApprovalActionDescription> {
        // registered whatever the options say, as the providers of a plugin are fixed before its options are read, so
        // a proposal without matching is refused here, before it is stored, and so is approving one
        if (this.options.matching == undefined) {
            throw new ConflictError($ts`This application does not match bank transactions with invoices.`);
        }
        const transactions: Repository<BankTransaction> = inject(repositoryTokenFor(BankTransaction));
        const transaction: BankTransaction = await transactions.findById(input.transactionId);
        const counterparty: string = transaction.counterpartyName ?? transaction.counterpartyIban ?? '-';
        // in the locale `$ts` writes the summary in, which is stored as it is written: the one of the request
        // proposing the match, the default locale outside of one. The day is held as its midnight UTC
        const localizeService: LocalizeServiceInterface = inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE);
        const bookedOn: string = localizeService.formatDate(transaction.bookingDate, 'date', { timezone: 'UTC' });
        // a bank may name a code that is not in the list of ISO 4217, which is written as the bank named it
        const amount: string = isCurrencyCode(transaction.currency)
            ? localizeService.formatPrice(input.amount, { currency: transaction.currency })
            : `${input.amount.toFixed()} ${transaction.currency}`;
        const match: ApprovalRowChange = {
            entity: BankMatch,
            stored: undefined,
            values: {
                transactionId: transaction.id,
                targetType: input.targetType,
                targetId: input.targetId,
                amount: input.amount,
                currency: transaction.currency
            }
        };
        if (input.targetType !== BankMatchTargetType.INVOICE) {
            const target: BankMatchTarget = await inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.BANK_MATCH_SERVICE)
                .resolveTarget(input.targetType, input.targetId, transaction);
            return {
                summary: $ts`Match ${amount} of ${counterparty} on ${bookedOn} with ${target.label}.`,
                // proposed against the target as it is, so that a match of a target changed since is refused
                rows: [match, target.row]
            };
        }
        const invoice: Invoice = await inject<Repository<Invoice>>(repositoryTokenFor(Invoice)).findById(input.targetId);
        return {
            summary: $ts`Match ${amount} paid by ${counterparty} on ${bookedOn} with the invoice ${invoice.number}.`,
            // proposed against the invoice as it is, so that a match of an invoice changed since is refused
            rows: [match, { entity: Invoice, stored: invoice, values: {} }]
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async run(input: BankMatchInput, context: ApprovalRunContext): Promise<BankMatch> {
        return await inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.BANK_MATCH_SERVICE).createMatch(input, context);
    }
}