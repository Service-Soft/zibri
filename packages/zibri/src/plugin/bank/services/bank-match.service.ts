import { KeptRowDivergenceReason } from '../../../backup/kept-row-divergence-reason.enum';
import { type KeptRowDivergence } from '../../../backup/kept-row-divergence.model';
import { type PaginationResult } from '../../../data-source/models/pagination-result.model';
import { type Where } from '../../../data-source/models/where/where-filter.model';
import { Repository } from '../../../data-source/repository/repository';
import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { UniqueConstraintViolationError } from '../../../data-source/unique-constraint-violation.error';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { getDiTokenName } from '../../../di/get-di-token-name.function';
import { getRegisteredProvidersOfVariant } from '../../../di/get-registered-providers-of-variant.function';
import { inject } from '../../../di/inject.function';
import { DiVariant } from '../../../di/models/di-variant.model';
import { type EntityOrder } from '../../../entity/models/entity-order.model';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error';
import { ConflictError } from '../../../error-handling/errors/conflict.error';
import { InternalError } from '../../../error-handling/internal-error.model';
import { type TranslatedString } from '../../../localization/models/translated-string.model';
import { $ts } from '../../../localization/translate.function';
import { parseObject } from '../../../parsing/functions/parse-object.function';
import { Ms } from '../../../utilities/ms';
import { BigNumber, NumberUtilities } from '../../../utilities/number.utilities';
import { ZIBRI_APPROVAL_PLUGIN_DI_TOKENS } from '../../approval/approval.tokens';
import { ApprovalActorKind } from '../../approval/models/approval-actor-kind.enum';
import { type ApprovalRequestDetails } from '../../approval/models/approval-request-details.model';
import { ApprovalRequestStatus } from '../../approval/models/approval-request-status.enum';
import { ApprovalRequest } from '../../approval/models/approval-request.model';
import { type ApprovalRunContext } from '../../approval/models/approval-run-context.model';
import { BookkeepingDayUtilities } from '../../bookkeeping/bookkeeping-day.utilities';
import { ZIBRI_INVOICING_PLUGIN_DI_TOKENS } from '../../invoicing/invoicing.tokens';
import { type InvoicePaymentState } from '../../invoicing/models/invoice-payment-state.model';
import { InvoiceType } from '../../invoicing/models/invoice-type.enum';
import { Invoice } from '../../invoicing/models/invoice.model';
import { BankMatchUtilities } from '../bank-match.utilities';
import { BankTransactionStateUtilities } from '../bank-transaction-state.utilities';
import { BANK_MATCH_POSTING_DI_VARIANT, BANK_MATCHER_DI_VARIANT, ZIBRI_BANK_PLUGIN_DI_TOKENS } from '../bank.tokens';
import { BANK_MATCH_ACTION_NAME } from '../models/bank-match-action-name.model';
import { type BankMatchFilter } from '../models/bank-match-filter.model';
import { BankMatchInput } from '../models/bank-match-input.model';
import { BankMatchReason } from '../models/bank-match-reason.enum';
import { type BankMatchScore } from '../models/bank-match-score.model';
import { BankMatchTargetType } from '../models/bank-match-target-type.enum';
import { type BankMatchTarget } from '../models/bank-match-target.model';
import { BankMatch, type BankMatchCreateData } from '../models/bank-match.model';
import { type BankMatcherSuggestion } from '../models/bank-matcher-suggestion.model';
import { type BankPluginOptions } from '../models/bank-plugin-options.model';
import { type BankTransactionDetails } from '../models/bank-transaction-details.model';
import { type BankTransactionFilter } from '../models/bank-transaction-filter.model';
import { BankTransactionState, type BankTransactionStateCreateData } from '../models/bank-transaction-state.model';
import { type BankTransactionSuggestion } from '../models/bank-transaction-suggestion.model';
import { BankTransaction } from '../models/bank-transaction.model';
import { type BankMatchPostingInterface } from './bank-match-posting.interface';
import { type BankMatchServiceInterface } from './bank-match-service.interface';
import { type BankMatcherInterface } from './bank-matcher.interface';

/**
 * An invoice that money received may pay, with what of it is open.
 */
type OpenInvoice = {
    /**
     * The invoice.
     */
    invoice: Invoice,
    /**
     * What of it is open.
     */
    open: BigNumber
};

/**
 * A match an approval request proposes, read from its input.
 */
type ProposedMatch = {
    /**
     * The id of the transaction.
     */
    transactionId: string,
    /**
     * What it is matched with.
     */
    targetType: BankMatchTargetType,
    /**
     * The id of what it is matched with.
     */
    targetId: string,
    /**
     * The amount.
     */
    amount: BigNumber,
    /**
     * How sure the matching is, or null for a match a user proposed.
     */
    confidence: number | null,
    /**
     * Why the matching suggested it, none for a match a user proposed.
     */
    reasons: BankMatchReason[],
    /**
     * Where the request stands.
     */
    status: ApprovalRequestStatus
};

/**
 * A pending request of `bank.match`, with the match it proposes.
 */
type PendingSuggestion = {
    /**
     * The request.
     */
    request: ApprovalRequest,
    /**
     * The match it proposes.
     */
    match: ProposedMatch
};

/**
 * An invoice a transaction may pay, as the matching scored it.
 */
type ScoredInvoice = OpenInvoice & {
    /**
     * How sure the matching is.
     */
    score: BankMatchScore
};

/**
 * Where the suggestions of one round stand: what of each transaction is left, what of each transaction and target is
 * spoken for, and which pairs were proposed before.
 */
type SuggestionRound = {
    /**
     * What of each transaction is left to suggest, by its id.
     */
    remaining: Map<string, BigNumber>,
    /**
     * What pending suggestions match of each target, by its id.
     */
    spoken: Map<string, BigNumber>,
    /**
     * The pairs proposed before, as `transactionId:targetId`.
     */
    proposedPairs: Set<string>
};

/**
 * The name the suggestions are proposed by, as the system.
 */
const BANK_MATCHING_SYSTEM: string = 'bank-matching';

/**
 * How many ids one read looks for, so that many transactions or invoices are read in pages.
 */
const IDS_PER_READ: number = 500;

/**
 * The order the transactions are listed in, by their states: the latest booking first, and by the id of the
 * transaction among those of one moment, so that the pages of a list neither repeat nor skip one.
 */
const STATE_ORDER: EntityOrder<BankTransactionState> = { bookingDate: 'DESC', transactionId: 'DESC' };

/**
 * Default implementation of the bank match service.
 */
@Injectable({ register: 'onUse' })
export class BankMatchService implements BankMatchServiceInterface {
    // read when used, like the repositories of the bank statement service: ZibriBankPlugin.validate names a missing
    // entity rather than a failed build of this
    private get matchRepository(): Repository<BankMatch, BankMatchCreateData> {
        return inject(repositoryTokenFor(BankMatch));
    }

    private get transactionRepository(): Repository<BankTransaction> {
        return inject(repositoryTokenFor(BankTransaction));
    }

    private get invoiceRepository(): Repository<Invoice> {
        return inject(repositoryTokenFor(Invoice));
    }

    private get requestRepository(): Repository<ApprovalRequest> {
        return inject(repositoryTokenFor(ApprovalRequest));
    }

    private get stateRepository(): Repository<BankTransactionState, BankTransactionStateCreateData> {
        return inject(repositoryTokenFor(BankTransactionState));
    }

    constructor(
        @Inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.OPTIONS)
        protected readonly options: BankPluginOptions
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async suggestMatches(transactionIds?: string[]): Promise<ApprovalRequestDetails[]> {
        this.validateMatching();
        const matchers: BankMatcherInterface[] = this.resolveMatchers();
        // money paid only when a matcher may match it, as invoices are paid with money received
        const found: BankTransaction[] = await this.findTransactions(transactionIds, matchers.length > 0);
        const transactionOpen: Map<string, BigNumber> = await this.resolveTransactionOpenAmounts(found, undefined);
        const transactions: BankTransaction[] = found
            .filter(t => transactionOpen.get(t.id)?.isGreaterThan(0) === true)
            .sort((a, b) => a.bookingDate.getTime() - b.bookingDate.getTime());
        if (!transactions.length) {
            return [];
        }
        const proposed: ProposedMatch[] = await this.findProposedMatches(transactions);
        // a pair proposed before waits for a person or was refused by one, and what a pending request matches is
        // spoken for, on both sides
        const spoken: Map<string, BigNumber> = new Map();
        for (const match of proposed.filter(p => p.status === ApprovalRequestStatus.PENDING)) {
            for (const id of [match.transactionId, match.targetId]) {
                spoken.set(id, NumberUtilities.add(spoken.get(id) ?? 0, match.amount));
            }
        }
        const round: SuggestionRound = {
            remaining: new Map(transactions.map(t => [
                t.id,
                NumberUtilities.subtract(transactionOpen.get(t.id) ?? 0, spoken.get(t.id) ?? 0)
            ])),
            spoken,
            proposedPairs: new Set(proposed.map(p => `${p.transactionId}:${p.targetId}`))
        };
        const res: ApprovalRequestDetails[] = await this.suggestInvoices(
            transactions.filter(t => t.amount.isGreaterThan(0)),
            transactionOpen,
            round
        );
        // the invoices first, then each matcher for what they left
        for (const matcher of matchers) {
            res.push(...await this.suggestWith(matcher, transactions, round));
        }
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createMatch(input: BankMatchInput, context: ApprovalRunContext): Promise<BankMatch> {
        this.validateMatching();
        const res: BankMatch | undefined = await this.withMatchLease(context.transaction, async () => {
            const transaction: BankTransaction = await this.transactionRepository.findById(input.transactionId);
            const invoice: Invoice | undefined = input.targetType === BankMatchTargetType.INVOICE
                ? await this.invoiceRepository.findById(input.targetId)
                : undefined;
            if (invoice != undefined) {
                this.validateMatchable(transaction, invoice, input.amount);
            }
            else if (!input.amount.isGreaterThan(0)) {
                throw new ConflictError($ts`The amount of a match needs to be above 0.`);
            }
            const target: BankMatchTarget | undefined = invoice == undefined
                ? await this.resolveTarget(input.targetType, input.targetId, transaction, context.transaction)
                : undefined;
            const openAmounts: Map<string, BigNumber> = await this.resolveTransactionOpenAmounts([transaction], context.transaction);
            const transactionOpen: BigNumber | undefined = openAmounts.get(transaction.id);
            if (transactionOpen == undefined || input.amount.isGreaterThan(transactionOpen)) {
                const amount: string = (transactionOpen ?? NumberUtilities.new(0)).toFixed();
                throw new ConflictError(

                    $ts`A match of the transaction needs to be at most ${amount} ${transaction.currency}, what of it is not matched yet.`
                );
            }
            const difference: BigNumber | null = invoice == undefined
                ? this.validateTargetOpen(target, input.amount, transaction.currency)
                : await this.resolveInvoiceDifference(invoice, input.amount);
            const match: BankMatch = await this.matchRepository.create(
                {
                    transactionId: transaction.id,
                    targetType: input.targetType,
                    targetId: input.targetId,
                    amount: input.amount,
                    difference,
                    currency: transaction.currency,
                    reversesMatchId: null,
                    requestId: context.request.id,
                    confirmedBy: context.decidedBy,
                    confirmedByKind: context.decidedByKind,
                    confirmedAt: new Date()
                },
                { transaction: context.transaction }
            );
            // one after the other, as the writes of one transaction run over one connection
            for (const posting of this.resolvePostings()) {
                await posting.postMatch(match, transaction, context.transaction);
            }
            return match;
        });
        if (res == undefined) {
            throw new InternalError('Could not take the lease to match the bank transaction.');
        }
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async reverseMatch(matchId: string, reversedBy: string, transaction?: Transaction): Promise<BankMatch> {
        this.validateMatching();
        const work: (started: Transaction) => Promise<BankMatch> = async started => {
            const original: BankMatch = await this.matchRepository.findById(matchId, { transaction: started });
            if (original.reversesMatchId != undefined) {
                throw new ConflictError($ts`The match "${matchId}" reverses another, and is not reversed.`);
            }
            if (await this.matchRepository.exists({ where: { reversesMatchId: matchId }, transaction: started })) {
                throw new ConflictError($ts`The match "${matchId}" is reversed already, and a match is reversed at most once.`);
            }
            let reversal: BankMatch;
            try {
                reversal = await this.matchRepository.create(
                    {
                        transactionId: original.transactionId,
                        targetType: original.targetType,
                        targetId: original.targetId,
                        // the negative of the original, so that what is matched adds up without it
                        amount: original.amount.negated(),
                        difference: original.difference == undefined ? null : original.difference.negated(),
                        currency: original.currency,
                        reversesMatchId: original.id,
                        requestId: null,
                        confirmedBy: reversedBy,
                        confirmedByKind: ApprovalActorKind.USER,
                        confirmedAt: new Date()
                    },
                    { transaction: started }
                );
            }
            catch (error) {
                // a reversal of the same match committed meanwhile, which the check above could not see yet
                if (error instanceof UniqueConstraintViolationError) {
                    throw new ConflictError(
                        $ts`The match "${matchId}" is reversed already, and a match is reversed at most once.`,
                        { cause: error }
                    );
                }
                throw error;
            }
            for (const posting of this.resolvePostings()) {
                await posting.postMatchReversal(reversal, original, started);
            }
            return reversal;
        };
        const res: BankMatch | undefined = await this.withMatchLease(
            transaction,
            async () => transaction == undefined
                ? await this.matchRepository.dataSource.runInTransaction(work, { maxAttempts: 3 })
                : await work(transaction)
        );
        if (res == undefined) {
            throw new InternalError('Could not take the lease to reverse the bank match.');
        }
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveTarget(
        targetType: BankMatchTargetType,
        targetId: string,
        bankTransaction: BankTransaction,
        transaction?: Transaction
    ): Promise<BankMatchTarget> {
        return await this.resolveMatcher(targetType).resolveTarget(targetId, bankTransaction, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findMatches(page: number, limit: number, filter: BankMatchFilter): Promise<PaginationResult<BankMatch>> {
        const where: Where<BankMatch> = {
            ...filter.transactionId == undefined ? {} : { transactionId: filter.transactionId },
            ...filter.invoiceId == undefined ? {} : { targetType: BankMatchTargetType.INVOICE, targetId: filter.invoiceId }
        };
        return await this.matchRepository.findAllPaginated(page, limit, { where, order: { confirmedAt: 'DESC' } });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findTransactionDetails(
        page: number,
        limit: number,
        filter: BankTransactionFilter
    ): Promise<PaginationResult<BankTransactionDetails>> {
        this.validateTransactionFilter(filter);
        // the page of the states, which hold what the list is narrowed and ordered by, and then its transactions
        const states: PaginationResult<BankTransactionState> = await this.stateRepository.findAllPaginated(
            page,
            limit,
            { where: this.resolveStateWhere(filter), order: STATE_ORDER }
        );
        const transactions: BankTransaction[] = states.items.length
            ? await this.transactionRepository.findAll({ where: { id: { oneOf: states.items.map(s => s.transactionId) } }, limit: 'all' })
            : [];
        const byId: Map<string, BankTransaction> = new Map(transactions.map(t => [t.id, t]));
        return {
            totalAmount: states.totalAmount,
            items: states.items.flatMap(state => {
                const transaction: BankTransaction | undefined = byId.get(state.transactionId);
                return transaction == undefined ? [] : [{ transaction, openAmount: state.openAmount }];
            })
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async recomputeTransactionStates(transactionIds?: string[], transaction?: Transaction): Promise<BankTransactionState[]> {
        if (transaction != undefined) {
            return await this.writeTransactionStates(transactionIds ?? await this.findTransactionIds(transaction), transaction);
        }
        const ids: string[] = transactionIds ?? await this.findTransactionIds(undefined);
        const res: BankTransactionState[] = [];
        // a page at a time, each in a transaction of its own under the lease the matches are written under, so that a
        // match written meanwhile is either counted or waits
        for (let start: number = 0; start < ids.length; start += IDS_PER_READ) {
            const page: string[] = ids.slice(start, start + IDS_PER_READ);
            const written: BankTransactionState[] | undefined = await this.withMatchLease(
                undefined,
                async () => await this.stateRepository.dataSource.runInTransaction(
                    async started => await this.writeTransactionStates(page, started),
                    { maxAttempts: 3 }
                )
            );
            if (written == undefined) {
                throw new InternalError('Could not take the lease to recompute the states of the bank transactions.');
            }
            res.push(...written);
        }
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findSuggestions(transactionId: string): Promise<BankTransactionSuggestion[]> {
        // read first, so that a transaction of another tenant is not found
        const transaction: BankTransaction = await this.transactionRepository.findById(transactionId);
        if (this.options.matching == undefined) {
            return [];
        }
        const pending: PendingSuggestion[] = (await this.findRequestsOf([transaction], [ApprovalRequestStatus.PENDING]))
            .flatMap(request => {
                const match: ProposedMatch | undefined = this.findProposedMatch(request);
                return match?.transactionId === transaction.id ? [{ request, match }] : [];
            });
        const differences: Map<string, BigNumber | null> = await this.resolveSuggestionDifferences(pending);
        return pending
            .map(({ request, match }) => ({
                requestId: request.id,
                targetType: match.targetType,
                targetId: match.targetId,
                amount: match.amount,
                confidence: match.confidence,
                reasons: match.reasons,
                paymentDifference: differences.get(request.id) ?? null,
                summary: request.summary
            }))
            .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveTransactionOpenAmounts(
        transactions: Pick<BankTransaction, 'id' | 'amount'>[],
        transaction: Transaction | undefined
    ): Promise<Map<string, BigNumber>> {
        const res: Map<string, BigNumber> = new Map(transactions.map(t => [t.id, t.amount.abs()]));
        // without matching there are no matches, and BankMatch need not be declared
        if (this.options.matching == undefined) {
            return res;
        }
        const matches: Pick<BankMatch, 'transactionId' | 'amount'>[] = await this.findInPages(
            transactions.map(t => t.id),
            async page => await this.matchRepository.findAll({
                where: { transactionId: { oneOf: page } },
                select: { transactionId: true, amount: true },
                limit: 'all',
                transaction
            })
        );
        for (const match of matches) {
            res.set(match.transactionId, NumberUtilities.subtract(res.get(match.transactionId) ?? 0, match.amount));
        }
        return res;
    }

    /**
     * Validates what a page of the transactions is narrowed by.
     * @param filter - The filter.
     * @throws A BadRequestError for a `from` or `until` with a time, or an `until` before `from`.
     */
    protected validateTransactionFilter(filter: BankTransactionFilter): void {
        const { from, until } = filter;
        if (from != undefined) {
            BookkeepingDayUtilities.validateDay(from, 'from');
        }
        if (until != undefined) {
            BookkeepingDayUtilities.validateDay(until, 'until');
        }
        if (from != undefined && until != undefined && until.getTime() < from.getTime()) {
            throw new BadRequestError($ts`The until needs to be on or after the from, ${BookkeepingDayUtilities.formatDay(from)}.`);
        }
    }

    /**
     * Resolves the filter of the states of the transactions a filter narrows to.
     * @param filter - The filter.
     * @returns The where of the states.
     */
    protected resolveStateWhere(filter: BankTransactionFilter): Where<BankTransactionState> {
        const { accountId, statementId, from, until, status } = filter;
        return {
            ...accountId == undefined ? {} : { accountId },
            ...statementId == undefined ? {} : { statementId },
            ...status == undefined ? {} : { status },
            // up to the end of the day of until, as a bank can book at a time of the day
            ...from == undefined && until == undefined
                ? {}
                : {
                    bookingDate: {
                        afterOrOn: from,
                        before: until == undefined ? undefined : BookkeepingDayUtilities.resolveNextDay(until)
                    }
                }
        };
    }

    /**
     * Finds the ids of every transaction of the active tenant.
     * @param transaction - The transaction to read in, if any.
     * @returns The ids.
     */
    protected async findTransactionIds(transaction: Transaction | undefined): Promise<string[]> {
        const res: string[] = [];
        for await (const row of this.transactionRepository.stream({ select: { id: true }, transaction })) {
            res.push(row.id);
        }
        return res;
    }

    /**
     * Writes the state of each of the given transactions as their matches make it, creating it where it is missing,
     * in a transaction that holds the lease of the matches or runs in the transaction a match is written in.
     * @param transactionIds - The ids of the transactions.
     * @param transaction - The transaction to read and write in, of the data source of the transactions.
     * @returns The states written, which differed or were missing.
     */
    protected async writeTransactionStates(transactionIds: string[], transaction: Transaction): Promise<BankTransactionState[]> {
        const transactions: BankTransaction[] = await this.findInPages(
            transactionIds,
            async page => await this.transactionRepository.findAll({ where: { id: { oneOf: page } }, limit: 'all', transaction })
        );
        const stored: Map<string, BankTransactionState> = new Map((await this.findInPages(
            transactionIds,
            async page => await this.stateRepository.findAll({ where: { transactionId: { oneOf: page } }, limit: 'all', transaction })
        )).map(state => [state.transactionId, state]));
        const open: Map<string, BigNumber> = await this.resolveTransactionOpenAmounts(transactions, transaction);
        const missing: BankTransactionStateCreateData[] = [];
        const res: BankTransactionState[] = [];
        // one after the other, as the writes of one transaction run over one connection
        for (const bankTransaction of transactions) {
            const state: BankTransactionStateCreateData = BankTransactionStateUtilities.resolveState(
                bankTransaction,
                open.get(bankTransaction.id) ?? bankTransaction.amount.abs()
            );
            const existing: BankTransactionState | undefined = stored.get(bankTransaction.id);
            if (existing == undefined) {
                missing.push(state);
            }
            else if (!BankTransactionStateUtilities.isSameState(existing, state)) {
                res.push(await this.stateRepository.updateById(existing.id, state, { transaction }));
            }
        }
        if (missing.length) {
            res.push(...await this.stateRepository.createAll(missing, { transaction }));
        }
        return res;
    }

    /**
     * Resolves what of each invoice the pending suggestions of a transaction would leave open within
     * `paymentDifferenceTolerance`, as confirming each would record it, from what of the invoice is open now.
     * @param pending - The requests and the matches they propose.
     * @returns The difference of each suggestion of an invoice, by the id of its request.
     */
    protected async resolveSuggestionDifferences(
        pending: PendingSuggestion[]
    ): Promise<Map<string, BigNumber | null>> {
        const ofInvoices: PendingSuggestion[] = pending.filter(p => p.match.targetType === BankMatchTargetType.INVOICE);
        if (!ofInvoices.length) {
            return new Map();
        }
        const invoices: Invoice[] = await this.invoiceRepository.findAll({
            where: { id: { oneOf: [...new Set(ofInvoices.map(p => p.match.targetId))] } },
            limit: 'all'
        });
        const states: InvoicePaymentState[] = await this.resolvePaymentStatesOf(invoices);
        const openOf: Map<string, BigNumber> = new Map(invoices.flatMap((invoice, index) => {
            const state: InvoicePaymentState | undefined = states[index];
            return state == undefined ? [] : [[invoice.id, state.open]];
        }));
        return new Map(ofInvoices.map(({ request, match }) => {
            const open: BigNumber | undefined = openOf.get(match.targetId);
            // a suggestion above what is open fails once approved, and records nothing
            return [request.id, open == undefined || match.amount.isGreaterThan(open) ? null : this.resolveDifference(open, match.amount)];
        }));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveKeptRowDivergences(): Promise<KeptRowDivergence[]> {
        if (this.options.matching == undefined) {
            return [];
        }
        // the matches of invoices that stand: a reversal undoes the match it reverses, as reversing a match resolves one
        const matches: Pick<BankMatch, 'id' | 'targetId' | 'reversesMatchId'>[] = [];
        for await (const row of this.matchRepository.stream({
            where: { targetType: BankMatchTargetType.INVOICE },
            select: { id: true, targetId: true, reversesMatchId: true }
        })) {
            matches.push(row);
        }
        const reversed: Set<string> = new Set(matches.flatMap(m => m.reversesMatchId == undefined ? [] : [m.reversesMatchId]));
        const standing: Pick<BankMatch, 'id' | 'targetId' | 'reversesMatchId'>[]
            = matches.filter(m => m.reversesMatchId == undefined && !reversed.has(m.id));
        const invoices: Pick<Invoice, 'id' | 'number' | 'issuedAt'>[] = await this.findInPages(
            [...new Set(standing.map(m => m.targetId))],
            async page => await this.invoiceRepository.findAll({
                where: { id: { oneOf: page } },
                select: { id: true, number: true, issuedAt: true },
                limit: 'all'
            })
        );
        const byId: Map<string, Pick<Invoice, 'id' | 'number' | 'issuedAt'>> = new Map(invoices.map(i => [i.id, i]));
        return standing.flatMap((match): KeptRowDivergence[] => {
            const invoice: Pick<Invoice, 'id' | 'number' | 'issuedAt'> | undefined = byId.get(match.targetId);
            if (invoice?.issuedAt != undefined) {
                return [];
            }
            return [
                {
                    entity: BankMatch.name,
                    id: match.id,
                    sourceEntity: Invoice.name,
                    sourceId: match.targetId,
                    reason: invoice == undefined ? KeptRowDivergenceReason.SOURCE_MISSING : KeptRowDivergenceReason.SOURCE_DRAFT,
                    message: invoice == undefined
                        ? `The bank match ${match.id} pays the invoice ${match.targetId}, which is gone.`
                        : `The bank match ${match.id} pays the invoice ${invoice.number}, which is a draft again.`
                }
            ];
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolvePaidAmounts(invoices: Invoice[]): Promise<Map<string, BigNumber> | undefined> {
        if (this.options.matching == undefined) {
            return undefined;
        }
        const matches: BankMatch[] = await this.findInPages(
            invoices.map(i => i.id),
            async page => await this.matchRepository.findAll({
                where: { targetType: BankMatchTargetType.INVOICE, targetId: { oneOf: page } },
                limit: 'all'
            })
        );
        const res: Map<string, BigNumber> = new Map();
        for (const match of matches) {
            // a difference within the tolerance counts as paid with its match
            const paid: BigNumber = NumberUtilities.add(match.amount, match.difference ?? 0);
            res.set(match.targetId, NumberUtilities.add(res.get(match.targetId) ?? 0, paid));
        }
        return res;
    }

    /**
     * Runs work matching the transactions of the active tenant, one match of a tenant at a time, held until the
     * transaction it is written in ends: each reads what the matches before it left open, which another one written at
     * once would not see yet.
     * @param transaction - The transaction the match is written in, if any.
     * @param work - The work.
     * @returns What the work returns, or undefined when the lease could not be taken.
     */
    protected async withMatchLease<T>(transaction: Transaction | undefined, work: () => Promise<T>): Promise<T | undefined> {
        const tenantId: string | undefined = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).getActiveTenantId();
        return await inject(ZIBRI_DI_TOKENS.LEASE_SERVICE).withLease(
            {
                key: `zibri.bank-match:${tenantId ?? ''}`,
                mode: 'wait',
                leaseInMs: Ms.MINUTE,
                acquireTimeoutInMs: Ms.MINUTE,
                heldUntil: transaction
            },
            work
        );
    }

    /**
     * Resolves what of an invoice a match leaves open within `paymentDifferenceTolerance`, which counts as paid.
     * @param invoice - The invoice.
     * @param amount - The amount of the match.
     * @returns The difference, or null when the match leaves nothing open or more than the tolerance.
     * @throws A ConflictError when the amount exceeds what of the invoice is open.
     */
    protected async resolveInvoiceDifference(invoice: Invoice, amount: BigNumber): Promise<BigNumber | null> {
        const state: InvoicePaymentState | undefined = await inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_PAYMENT_SERVICE)
            .resolvePaymentState(invoice);
        if (state == undefined) {
            throw new InternalError('The invoice payment service knows of no payment source, which the bank plugin is one of.');
        }
        if (amount.isGreaterThan(state.open)) {
            const open: string = BigNumber.max(state.open, 0).toFixed();
            throw new ConflictError(
                $ts`A match of the invoice ${invoice.number} needs to be at most ${open} ${invoice.currency}, what of it is open.`
            );
        }
        return this.resolveDifference(state.open, amount);
    }

    /**
     * Resolves what a match of an amount leaves of what of an invoice is open, when it is within
     * `paymentDifferenceTolerance` and counts as paid.
     * @param open - What of the invoice is open, at least the amount.
     * @param amount - The amount of the match.
     * @returns The difference, or null when the match leaves nothing open or more than the tolerance.
     */
    protected resolveDifference(open: BigNumber, amount: BigNumber): BigNumber | null {
        const left: BigNumber = NumberUtilities.subtract(open, amount);
        const tolerance: number = this.options.matching?.paymentDifferenceTolerance ?? 0;
        return left.isGreaterThan(0) && !left.isGreaterThan(tolerance) ? left : null;
    }

    /**
     * Validates that a match does not exceed what of its target is open.
     * @param target - The target, as its matcher resolved it.
     * @param amount - The amount of the match.
     * @param currency - The currency of the transaction.
     * @returns Null, as only an invoice is paid with a difference.
     * @throws A ConflictError when it does.
     */
    protected validateTargetOpen(target: BankMatchTarget | undefined, amount: BigNumber, currency: string): null {
        if (target?.open != undefined && amount.isGreaterThan(target.open)) {
            const open: string = BigNumber.max(target.open, 0).toFixed();
            throw new ConflictError($ts`A match of ${target.label} needs to be at most ${open} ${currency}, what of it is open.`);
        }
        return null;
    }

    /**
     * Suggests the invoices money received pays.
     * @param transactions - The transactions of money received, oldest first.
     * @param transactionOpen - What of each is not matched yet.
     * @param round - Where the suggestions stand, which this updates.
     * @returns The requests proposed.
     */
    protected async suggestInvoices(
        transactions: BankTransaction[],
        transactionOpen: Map<string, BigNumber>,
        round: SuggestionRound
    ): Promise<ApprovalRequestDetails[]> {
        if (!transactions.length) {
            return [];
        }
        const invoices: OpenInvoice[] = await this.findOpenInvoices(new Set(transactions.map(t => t.currency)));
        if (!invoices.length) {
            return [];
        }
        const recipientsByIban: Map<string, Set<string>> = await this.resolveRecipientsByIban(transactions);
        const res: ApprovalRequestDetails[] = [];
        // one proposal after the other, oldest transaction first: each may be approved by a policy right away, and
        // what it matches is no longer open for the next
        for (const transaction of transactions) {
            const open: BigNumber = transactionOpen.get(transaction.id) ?? NumberUtilities.new(0);
            const candidates: ScoredInvoice[] = this.resolveCandidates(transaction, open, invoices, recipientsByIban)
                .filter(c => !round.proposedPairs.has(`${transaction.id}:${c.invoice.id}`));
            for (const candidate of candidates) {
                const remaining: BigNumber = round.remaining.get(transaction.id) ?? NumberUtilities.new(0);
                if (!remaining.isGreaterThan(0)) {
                    break;
                }
                const invoiceRemaining: BigNumber = NumberUtilities.subtract(candidate.open, round.spoken.get(candidate.invoice.id) ?? 0);
                const amount: BigNumber = BigNumber.min(remaining, invoiceRemaining);
                if (!amount.isGreaterThan(0)) {
                    continue;
                }
                res.push(await this.proposeMatch(transaction, BankMatchTargetType.INVOICE, candidate.invoice.id, amount, candidate.score));
                round.remaining.set(transaction.id, NumberUtilities.subtract(remaining, amount));
                round.spoken.set(candidate.invoice.id, NumberUtilities.add(round.spoken.get(candidate.invoice.id) ?? 0, amount));
            }
        }
        return res;
    }

    /**
     * Suggests what a matcher matches the transactions with, for what of each is left.
     * @param matcher - The matcher.
     * @param transactions - The transactions, oldest first.
     * @param round - Where the suggestions stand, which this updates.
     * @returns The requests proposed.
     */
    protected async suggestWith(
        matcher: BankMatcherInterface,
        transactions: BankTransaction[],
        round: SuggestionRound
    ): Promise<ApprovalRequestDetails[]> {
        const left: BankTransaction[] = transactions.filter(t => round.remaining.get(t.id)?.isGreaterThan(0) === true);
        if (!left.length) {
            return [];
        }
        const suggestions: BankMatcherSuggestion[] = (await matcher.resolveSuggestions(left.map(transaction => ({
            transaction,
            open: round.remaining.get(transaction.id) ?? NumberUtilities.new(0)
        }))))
            .filter(s => !round.proposedPairs.has(`${s.transactionId}:${s.targetId}`))
            .sort((a, b) => b.score.confidence - a.score.confidence);
        const byId: Map<string, BankTransaction> = new Map(left.map(t => [t.id, t]));
        const res: ApprovalRequestDetails[] = [];
        for (const suggestion of suggestions) {
            const transaction: BankTransaction | undefined = byId.get(suggestion.transactionId);
            const remaining: BigNumber = round.remaining.get(suggestion.transactionId) ?? NumberUtilities.new(0);
            const targetRemaining: BigNumber = suggestion.targetOpen == undefined
                ? remaining
                : NumberUtilities.subtract(suggestion.targetOpen, round.spoken.get(suggestion.targetId) ?? 0);
            const amount: BigNumber = BigNumber.min(remaining, targetRemaining);
            if (transaction == undefined || !amount.isGreaterThan(0)) {
                continue;
            }
            res.push(await this.proposeMatch(transaction, matcher.targetType, suggestion.targetId, amount, suggestion.score));
            round.remaining.set(transaction.id, NumberUtilities.subtract(remaining, amount));
            round.spoken.set(suggestion.targetId, NumberUtilities.add(round.spoken.get(suggestion.targetId) ?? 0, amount));
        }
        return res;
    }

    /**
     * Scores the invoices a transaction may pay, and keeps those sure enough to suggest.
     * @param transaction - The transaction.
     * @param transactionOpen - What of it is not matched yet.
     * @param invoices - The open invoices.
     * @param recipientsByIban - The recipients each IBAN paid invoices of before.
     * @returns The invoices, the most likely first: by confidence, then the one due first.
     */
    protected resolveCandidates(
        transaction: BankTransaction,
        transactionOpen: BigNumber,
        invoices: OpenInvoice[],
        recipientsByIban: Map<string, Set<string>>
    ): ScoredInvoice[] {
        const recipientsPaidByIban: Set<string> = recipientsByIban.get(transaction.counterpartyIban ?? '') ?? new Set();
        return invoices
            .filter(i => i.invoice.currency === transaction.currency)
            .flatMap(i => {
                const score: BankMatchScore | undefined = BankMatchUtilities.resolveScore({
                    transaction,
                    transactionOpen,
                    invoice: i.invoice,
                    invoiceOpen: i.open,
                    recipientsPaidByIban
                });
                return score == undefined ? [] : [{ ...i, score }];
            })
            .sort((a, b) => b.score.confidence - a.score.confidence
                || a.invoice.dueDate.getTime() - b.invoice.dueDate.getTime()
                || a.invoice.number.localeCompare(b.invoice.number));
    }

    /**
     * Proposes a match as the system, for a person or a policy to approve.
     * @param transaction - The transaction.
     * @param targetType - What it is matched with.
     * @param targetId - The id of what it is matched with.
     * @param amount - The part of the transaction that is matched.
     * @param score - How sure the matching is, and why.
     * @returns The request, decided when a policy approved it.
     */
    protected async proposeMatch(
        transaction: BankTransaction,
        targetType: BankMatchTargetType,
        targetId: string,
        amount: BigNumber,
        score: BankMatchScore
    ): Promise<ApprovalRequestDetails> {
        return await inject(ZIBRI_APPROVAL_PLUGIN_DI_TOKENS.APPROVAL_REQUEST_SERVICE).propose({
            action: BANK_MATCH_ACTION_NAME,
            input: {
                transactionId: transaction.id,
                targetType,
                targetId,
                amount: amount.toFixed(),
                confidence: score.confidence,
                reasons: score.reasons
            },
            reason: score.reasons.map(r => this.resolveReasonText(r, targetType)).join(' '),
            system: BANK_MATCHING_SYSTEM
        });
    }

    /**
     * What a reason of a suggestion says to the reviewer.
     * @param reason - The reason.
     * @param targetType - What the suggestion matches the transaction with.
     * @returns One sentence.
     */
    protected resolveReasonText(reason: BankMatchReason, targetType: BankMatchTargetType): TranslatedString {
        const expense: boolean = targetType === BankMatchTargetType.EXPENSE;
        switch (reason) {
            case BankMatchReason.INVOICE_NUMBER: {
                return $ts`The payer names the invoice number.`;
            }
            case BankMatchReason.DOCUMENT_NUMBER: {
                return $ts`The payment names the document number of the expense.`;
            }
            case BankMatchReason.AMOUNT: {
                return expense ? $ts`The amount is what of the expense is open.` : $ts`The amount is what of the invoice is open.`;
            }
            case BankMatchReason.COUNTERPARTY_NAME: {
                return expense
                    ? $ts`The payee has the name of the supplier of the expense.`
                    : $ts`The payer has the name of the recipient of the invoice.`;
            }
            case BankMatchReason.COUNTERPARTY_IBAN: {
                return $ts`The account of the payer paid an invoice of the recipient before.`;
            }
            case BankMatchReason.ACCOUNT_RULE: {
                return $ts`An account match rule names the counterparty or the text of the transaction.`;
            }
        }
    }

    /**
     * Finds the transactions of the active tenant that may be matched.
     * @param transactionIds - Their ids, or undefined for all of them.
     * @param withPaid - Whether money paid is matched, besides money received.
     * @returns The transactions.
     */
    protected async findTransactions(transactionIds: string[] | undefined, withPaid: boolean): Promise<BankTransaction[]> {
        const where: Where<BankTransaction> = withPaid ? {} : { amount: { greaterThan: 0 } };
        return transactionIds == undefined
            ? await this.transactionRepository.findAll({ where, limit: 'all' })
            : await this.findInPages(
                transactionIds,
                async page => await this.transactionRepository.findAll({ where: { ...where, id: { oneOf: page } }, limit: 'all' })
            );
    }

    /**
     * Finds the invoices of the active tenant in the given currencies that are open: issued, no credit note, and not
     * paid or credited in full.
     * @param currencies - The currencies.
     * @returns The invoices, with what of each is open.
     */
    protected async findOpenInvoices(currencies: Set<string>): Promise<OpenInvoice[]> {
        // issued by its issuedAt, as a draft is
        const invoices: Invoice[] = (await this.invoiceRepository.findAll({
            where: { type: InvoiceType.INVOICE, issuedAt: { not: null } },
            limit: 'all'
        })).filter(i => currencies.has(i.currency));
        const states: InvoicePaymentState[] = await this.resolvePaymentStatesOf(invoices);
        return invoices.flatMap((invoice, index) => {
            const open: BigNumber | undefined = states[index]?.open;
            return open?.isGreaterThan(0) === true ? [{ invoice, open }] : [];
        });
    }

    /**
     * Resolves the payment states of invoices, which the bank plugin is a payment source of.
     * @param invoices - The invoices.
     * @returns The state of each, in their order.
     * @throws An InternalError when the invoice payment service knows of no payment source.
     */
    protected async resolvePaymentStatesOf(invoices: Invoice[]): Promise<InvoicePaymentState[]> {
        const states: InvoicePaymentState[] | undefined = await inject(ZIBRI_INVOICING_PLUGIN_DI_TOKENS.INVOICE_PAYMENT_SERVICE)
            .resolvePaymentStates(invoices);
        if (states == undefined) {
            throw new InternalError('The invoice payment service knows of no payment source, which the bank plugin is one of.');
        }
        return states;
    }

    /**
     * Finds the matches pending or rejected for the given transactions, which are not suggested again.
     * @param transactions - The transactions.
     * @returns The matches the requests propose.
     */
    protected async findProposedMatches(transactions: BankTransaction[]): Promise<ProposedMatch[]> {
        const ids: Set<string> = new Set(transactions.map(t => t.id));
        const requests: ApprovalRequest[] = await this.findRequestsOf(
            transactions,
            [ApprovalRequestStatus.PENDING, ApprovalRequestStatus.REJECTED]
        );
        return requests.flatMap(request => {
            const match: ProposedMatch | undefined = this.findProposedMatch(request);
            return match != undefined && ids.has(match.transactionId) ? [match] : [];
        });
    }

    /**
     * Finds the requests of `bank.match` of the given statuses that may propose a match of the given transactions.
     * @param transactions - The transactions, at least one.
     * @param statuses - The statuses.
     * @returns The requests, of these transactions and of others, as the input of a request is not filtered by.
     */
    protected async findRequestsOf(transactions: BankTransaction[], statuses: ApprovalRequestStatus[]): Promise<ApprovalRequest[]> {
        // a transaction is proposed once it is imported, which is after it was booked
        const since: Date = new Date(Math.min(...transactions.map(t => t.bookingDate.getTime())));
        return await this.requestRepository.findAll({
            where: { action: BANK_MATCH_ACTION_NAME, status: { oneOf: statuses }, proposedAt: { afterOrOn: since } },
            order: { proposedAt: 'ASC' },
            limit: 'all'
        });
    }

    /**
     * Reads the match a request proposes from its input.
     * @param request - The request.
     * @returns The match, or undefined for an input that is not one.
     */
    protected findProposedMatch(request: ApprovalRequest): ProposedMatch | undefined {
        const input: unknown = parseObject(request.input, BankMatchInput);
        if (typeof input !== 'object' || input == undefined
            || !('transactionId' in input) || typeof input.transactionId !== 'string'
            || !('targetType' in input) || !this.isTargetType(input.targetType)
            || !('targetId' in input) || typeof input.targetId !== 'string'
            || !('amount' in input) || !NumberUtilities.isBigNumber(input.amount)) {
            return undefined;
        }
        const confidence: unknown = 'confidence' in input ? input.confidence : undefined;
        const reasons: unknown = 'reasons' in input ? input.reasons : undefined;
        return {
            transactionId: input.transactionId,
            targetType: input.targetType,
            targetId: input.targetId,
            amount: input.amount,
            confidence: typeof confidence === 'number' ? confidence : null,
            reasons: Array.isArray(reasons) ? reasons.filter((r: unknown): r is BankMatchReason => this.isReason(r)) : [],
            status: request.status
        };
    }

    /**
     * Resolves the recipients of invoices the IBANs of the counterparties of the given transactions paid before.
     * @param transactions - The transactions.
     * @returns The keys of the recipients, by IBAN.
     */
    protected async resolveRecipientsByIban(transactions: BankTransaction[]): Promise<Map<string, Set<string>>> {
        const ibans: string[] = [...new Set(transactions.flatMap(t => t.counterpartyIban == undefined ? [] : [t.counterpartyIban]))];
        const paying: BankTransaction[] = await this.findInPages(
            ibans,
            async page => await this.transactionRepository.findAll({ where: { counterpartyIban: { oneOf: page } }, limit: 'all' })
        );
        const matches: BankMatch[] = await this.findInPages(
            paying.map(t => t.id),
            async page => await this.matchRepository.findAll({
                where: { transactionId: { oneOf: page }, targetType: BankMatchTargetType.INVOICE },
                limit: 'all'
            })
        );
        const invoices: Invoice[] = await this.findInPages(
            [...new Set(matches.map(m => m.targetId))],
            async page => await this.invoiceRepository.findAll({ where: { id: { oneOf: page } }, limit: 'all' })
        );
        const ibanOf: Map<string, string | null | undefined> = new Map(paying.map(t => [t.id, t.counterpartyIban]));
        const recipientOf: Map<string, string> = new Map(
            invoices.map(i => [i.id, BankMatchUtilities.resolveRecipientKey(i.customerAddressData)])
        );
        const res: Map<string, Set<string>> = new Map();
        for (const match of matches) {
            const iban: string | null | undefined = ibanOf.get(match.transactionId);
            const recipient: string | undefined = recipientOf.get(match.targetId);
            if (iban != undefined && recipient != undefined) {
                res.set(iban, (res.get(iban) ?? new Set()).add(recipient));
            }
        }
        return res;
    }

    /**
     * Validates that a transaction can pay an invoice with an amount.
     * @param transaction - The transaction.
     * @param invoice - The invoice.
     * @param amount - The amount.
     * @throws A ConflictError for money paid, a credit note, another currency or an amount not above zero.
     */
    protected validateMatchable(transaction: BankTransaction, invoice: Invoice, amount: BigNumber): void {
        if (!transaction.amount.isGreaterThan(0)) {
            throw new ConflictError($ts`The transaction is money paid, and a match needs money received.`);
        }
        if (invoice.type === InvoiceType.CREDIT_NOTE) {
            throw new ConflictError($ts`The invoice ${invoice.number} is a credit note, and a match needs an invoice.`);
        }
        if (invoice.currency !== transaction.currency) {
            throw new ConflictError($ts`A match of the invoice ${invoice.number} needs a transaction in ${invoice.currency}.`);
        }
        if (!amount.isGreaterThan(0)) {
            throw new ConflictError($ts`The amount of a match needs to be above 0.`);
        }
    }

    /**
     * Validates that the bank plugin matches transactions.
     * @throws An InternalError when `matching` of its options is not set.
     */
    protected validateMatching(): void {
        if (this.options.matching == undefined) {
            throw new InternalError('ZibriBankPlugin matches transactions once `matching` of its options is set.');
        }
    }

    /**
     * Resolves the matcher of a type of target.
     * @param targetType - The type, other than an invoice.
     * @returns The matcher.
     * @throws A ConflictError when none is registered, such as for an expense without the bookkeeping plugin.
     */
    protected resolveMatcher(targetType: BankMatchTargetType): BankMatcherInterface {
        const matcher: BankMatcherInterface | undefined = this.resolveMatchers().find(m => m.targetType === targetType);
        if (matcher == undefined) {
            throw new ConflictError($ts`This application does not match bank transactions with the target ${targetType}.`);
        }
        return matcher;
    }

    /**
     * Resolves the matchers registered with `BANK_MATCHER_DI_VARIANT`.
     * @returns The matchers.
     * @throws An InternalError when a provider of the variant holds no matcher.
     */
    protected resolveMatchers(): BankMatcherInterface[] {
        return this.resolveVariant(
            BANK_MATCHER_DI_VARIANT,
            'a bank matcher',
            (value): value is BankMatcherInterface => typeof value === 'object' && value != undefined
                && 'resolveSuggestions' in value && typeof value.resolveSuggestions === 'function'
                && 'resolveTarget' in value && typeof value.resolveTarget === 'function'
        );
    }

    /**
     * Resolves the postings registered with `BANK_MATCH_POSTING_DI_VARIANT`.
     * @returns The postings, none without bookkeeping.
     * @throws An InternalError when a provider of the variant holds no posting.
     */
    protected resolvePostings(): BankMatchPostingInterface[] {
        return this.resolveVariant(
            BANK_MATCH_POSTING_DI_VARIANT,
            'a bank match posting',
            (value): value is BankMatchPostingInterface => typeof value === 'object' && value != undefined
                && 'postMatch' in value && typeof value.postMatch === 'function'
                && 'postMatchReversal' in value && typeof value.postMatchReversal === 'function'
        );
    }

    /**
     * Resolves what the providers of a variant hold.
     * @param variant - The variant.
     * @param kind - What each needs to be, for the error.
     * @param isKind - Whether a value is one.
     * @returns The values.
     * @throws An InternalError when a provider of the variant holds something else.
     */
    private resolveVariant<T>(variant: DiVariant, kind: string, isKind: (value: unknown) => value is T): T[] {
        return getRegisteredProvidersOfVariant(variant).map(provider => {
            const value: unknown = inject(provider.token);
            if (!isKind(value)) {
                throw new InternalError(`${getDiTokenName(provider.token)} is provided as ${kind}, and needs to be one.`);
            }
            return value;
        });
    }

    private isTargetType(value: unknown): value is BankMatchTargetType {
        return Object.values<unknown>(BankMatchTargetType).includes(value);
    }

    private isReason(value: unknown): value is BankMatchReason {
        return Object.values<unknown>(BankMatchReason).includes(value);
    }

    /**
     * Finds rows by a list of values, one page of values after the other.
     * @param values - The values, such as ids.
     * @param find - Finds the rows of one page of values.
     * @returns The rows of every page.
     */
    private async findInPages<T>(values: string[], find: (page: string[]) => Promise<T[]>): Promise<T[]> {
        const res: T[] = [];
        // one page after the other, as the reads of one transaction run over one connection
        for (let start: number = 0; start < values.length; start += IDS_PER_READ) {
            res.push(...await find(values.slice(start, start + IDS_PER_READ)));
        }
        return res;
    }
}