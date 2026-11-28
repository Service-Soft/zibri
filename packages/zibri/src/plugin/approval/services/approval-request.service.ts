import { type AuthServiceInterface } from '../../../auth/auth-service.interface';
import { type CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { type Permission } from '../../../auth/roles/permission.type';
import { AlsUtilities } from '../../../context/als.utilities';
import { type HttpRequestContext } from '../../../context/request/http-request.context';
import { type WebsocketRequestContext } from '../../../context/request/websocket-request.context';
import { dataSourceNow } from '../../../data-source/models/data-source-now.function';
import { type PaginationResult } from '../../../data-source/models/pagination-result.model';
import { type Where } from '../../../data-source/models/where/where-filter.model';
import { Repository } from '../../../data-source/repository/repository';
import { type Transaction } from '../../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { Inject } from '../../../di/decorators/inject.decorator';
import { Injectable } from '../../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { ErrorUtilities } from '../../../error-handling/error.utilities';
import { BadRequestError } from '../../../error-handling/errors/bad-request.error';
import { ConflictError } from '../../../error-handling/errors/conflict.error';
import { ForbiddenError } from '../../../error-handling/errors/forbidden.error';
import { NotFoundError } from '../../../error-handling/errors/not-found.error';
import { UnauthorizedError } from '../../../error-handling/errors/unauthorized.error';
import { InternalError } from '../../../error-handling/internal-error.model';
import { type EventTypeFor } from '../../../event/event-type-for.type';
import { FrameworkEventUtilities } from '../../../event/framework-event.utilities';
import { MimeType } from '../../../http/mime-type.enum';
import { type TranslatedString } from '../../../localization/models/translated-string.model';
import { $ts } from '../../../localization/translate.function';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { parseObject } from '../../../parsing/functions/parse-object.function';
import { type JsonBodyMetadata, type XmlBodyMetadata } from '../../../routing/decorators/body-metadata.model';
import { resolveStructuredBodyMetadata } from '../../../routing/resolve-body-metadata.function';
import { Ms } from '../../../utilities/ms';
import { ApprovalRequestUtilities } from '../approval-request.utilities';
import { ZIBRI_APPROVAL_PLUGIN_DI_TOKENS } from '../approval.tokens';
import { type ApprovalActionDescription } from '../models/approval-action-description.model';
import { type ApprovalAction } from '../models/approval-action.model';
import { ApprovalActorKind } from '../models/approval-actor-kind.enum';
import { ApprovalDecisionType } from '../models/approval-decision-type.enum';
import { ApprovalDecision, type ApprovalDecisionCreateData } from '../models/approval-decision.model';
import { type ApprovalPluginOptions } from '../models/approval-plugin-options.model';
import { type ApprovalPrecondition } from '../models/approval-precondition.model';
import { type ApprovalProposal } from '../models/approval-proposal.model';
import { type ApprovalRequestDetails } from '../models/approval-request-details.model';
import { type ApprovalRequestEventData } from '../models/approval-request-event-data.model';
import { type ApprovalRequestFilter } from '../models/approval-request-filter.model';
import { ApprovalRequestStatus } from '../models/approval-request-status.enum';
import { ApprovalRequest, type ApprovalRequestCreateData } from '../models/approval-request.model';
import { type ApprovalRequestServiceInterface } from './approval-request-service.interface';

/**
 * Who proposes or decides a request.
 */
type ApprovalActor = {
    /**
     * The id of the user, or the name of the system or the policy.
     */
    by: string,
    /**
     * What `by` names.
     */
    kind: ApprovalActorKind
};

/**
 * The logged in user of a request, and the request.
 */
type ApprovalCaller = {
    /**
     * The user.
     */
    user: CurrentUser,
    /**
     * The request they sent.
     */
    context: HttpRequestContext | WebsocketRequestContext
};

/**
 * What a decision records besides who decided it.
 */
type ApprovalDecisionData = Pick<ApprovalDecisionCreateData, 'decision' | 'note' | 'result' | 'error'>;

/**
 * Default implementation of the approval request service.
 */
@Injectable({ register: 'onUse' })
export class ApprovalRequestService implements ApprovalRequestServiceInterface {
    private actions: Map<string, ApprovalAction> | undefined;

    // read when used, like the repositories of the bank service: ZibriApprovalPlugin.validate names a missing entity
    // rather than a failed build of this
    private get requestRepository(): Repository<ApprovalRequest, ApprovalRequestCreateData> {
        return inject(repositoryTokenFor(ApprovalRequest));
    }

    private get decisionRepository(): Repository<ApprovalDecision, ApprovalDecisionCreateData> {
        return inject(repositoryTokenFor(ApprovalDecision));
    }

    private get authService(): AuthServiceInterface {
        return inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
    }

    constructor(
        @Inject(ZIBRI_APPROVAL_PLUGIN_DI_TOKENS.OPTIONS)
        protected readonly options: ApprovalPluginOptions,
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        protected readonly logger: LoggerInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    findAction(name: string): ApprovalAction | undefined {
        this.actions ??= ApprovalRequestUtilities.resolveRegisteredActions();
        return this.actions.get(name);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async propose(proposal: ApprovalProposal): Promise<ApprovalRequestDetails> {
        const action: ApprovalAction | undefined = this.findAction(proposal.action);
        if (action == undefined) {
            throw new BadRequestError($ts`The action "${proposal.action}" does not exist.`);
        }
        const proposer: ApprovalActor = proposal.system == undefined
            ? await this.resolveProposingUser(action)
            : { by: proposal.system, kind: ApprovalActorKind.SYSTEM };
        const input: object = await this.resolveInput(action, proposal.input);
        const description: ApprovalActionDescription = await action.describe(input);
        const proposedAt: Date = new Date();
        const request: ApprovalRequest = await this.requestRepository.create({
            action: action.name,
            input,
            reason: proposal.reason ?? null,
            summary: description.summary,
            changes: (description.rows ?? []).map(row => ApprovalRequestUtilities.resolveChange(row)),
            preconditions: ApprovalRequestUtilities.resolvePreconditions(description.rows ?? []),
            proposedBy: proposer.by,
            proposedByKind: proposer.kind,
            proposedAt,
            status: ApprovalRequestStatus.PENDING,
            expiresAt: new Date(proposedAt.getTime() + (action.expiresInMs ?? this.options.expiresInMs))
        });
        await this.emit(this.options.eventNames.requestCreated, request);

        for (const policy of action.policies ?? []) {
            if (await policy.approves(input, request, description)) {
                const decider: ApprovalActor = { by: policy.name, kind: ApprovalActorKind.POLICY };
                // outside the request it was proposed in, so that what the action writes records the policy that
                // approved it rather than the user who proposed it
                return await AlsUtilities.runOutsideRequest(
                    async () => await this.decide(request.id, decider, ApprovalDecisionType.APPROVED, null)
                );
            }
        }
        return { request, decision: null };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async approve(requestId: string, note: string | null = null): Promise<ApprovalRequestDetails> {
        const request: ApprovalRequest = await this.resolveRequest(requestId);
        const action: ApprovalAction = this.resolveRequestAction(request);
        const caller: ApprovalCaller = await this.resolveCaller(
            action.permission,
            $ts`You do not have permission to decide this approval request.`
        );
        // whatever the permissions of the proposer, the second pair of eyes is the point of a request
        if (request.proposedByKind === ApprovalActorKind.USER && request.proposedBy === caller.user.id) {
            throw new ForbiddenError($ts`You cannot approve an approval request you proposed.`);
        }
        // before the second factor, which a request that cannot be decided would spend for nothing
        this.validatePending(request);
        if (action.require2fa === true) {
            await inject(ZIBRI_DI_TOKENS.TWO_FACTOR_SERVICE).validate2fa(caller.user, caller.context);
        }
        return await this.decide(request.id, { by: caller.user.id, kind: ApprovalActorKind.USER }, ApprovalDecisionType.APPROVED, note);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async reject(requestId: string, note: string | null = null): Promise<ApprovalRequestDetails> {
        const request: ApprovalRequest = await this.resolveRequest(requestId);
        const action: ApprovalAction = this.resolveRequestAction(request);
        const caller: ApprovalCaller = await this.resolveCaller(
            action.permission,
            $ts`You do not have permission to decide this approval request.`
        );
        return await this.decide(request.id, { by: caller.user.id, kind: ApprovalActorKind.USER }, ApprovalDecisionType.REJECTED, note);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findRequest(requestId: string): Promise<ApprovalRequestDetails | undefined> {
        const request: ApprovalRequest | undefined = await this.requestRepository.findById(requestId, { required: false });
        if (request == undefined) {
            return undefined;
        }
        const decision: ApprovalDecision | undefined = await this.decisionRepository.findOne({ where: { requestId }, required: false });
        return { request, decision: decision ?? null };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findRequests(page: number, limit: number, filter: ApprovalRequestFilter): Promise<PaginationResult<ApprovalRequest>> {
        const where: Where<ApprovalRequest> = {
            ...filter.status == undefined ? {} : { status: filter.status },
            ...filter.action == undefined ? {} : { action: filter.action }
        };
        return await this.requestRepository.findAllPaginated(page, limit, { where, order: { proposedAt: 'DESC' } });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async closeExpiredRequests(): Promise<number> {
        return await this.requestRepository.updateAll(
            { status: ApprovalRequestStatus.PENDING, expiresAt: { before: dataSourceNow() } },
            { status: ApprovalRequestStatus.EXPIRED },
            { acrossTenants: true }
        );
    }

    /**
     * Decides a request, one decision at a time: approves it by running its action and recording the decision, or
     * rejects it.
     * @param requestId - The id of the request.
     * @param decider - Who decides it.
     * @param decision - Whether it is approved or rejected.
     * @param note - What the decider noted.
     * @returns The request as it stands then, and the decision.
     * @throws A `ConflictError` for a request that is not pending, expired or whose rows changed.
     */
    protected async decide(
        requestId: string,
        decider: ApprovalActor,
        decision: ApprovalDecisionType,
        note: string | null
    ): Promise<ApprovalRequestDetails> {
        // one decision per request: a second approver waits here, and finds it decided
        const res: ApprovalRequestDetails | undefined = await inject(ZIBRI_DI_TOKENS.LEASE_SERVICE).withLease(
            { key: `zibri.approval:${requestId}`, mode: 'wait', leaseInMs: Ms.MINUTE, acquireTimeoutInMs: Ms.MINUTE },
            async () => {
                const request: ApprovalRequest = await this.resolveRequest(requestId);
                this.validatePending(request);
                await this.validateNotExpired(request);
                const action: ApprovalAction = this.resolveRequestAction(request);
                switch (decision) {
                    case ApprovalDecisionType.APPROVED: {
                        return await this.runApproved(request, action, decider, note);
                    }
                    case ApprovalDecisionType.REJECTED: {
                        return await this.requestRepository.dataSource.runInTransaction(async transaction => await this.recordDecision(
                            request,
                            decider,
                            { decision, note, result: null, error: null },
                            ApprovalRequestStatus.REJECTED,
                            transaction
                        ), { maxAttempts: 3 });
                    }
                }
            }
        );
        if (res == undefined) {
            throw new InternalError('Could not take the lease to decide the approval request.');
        }
        await this.emit(this.options.eventNames.requestDecided, res.request);
        return res;
    }

    /**
     * Runs the action of an approved request, and records the decision with what it answered, or with its error.
     * @param request - The request.
     * @param action - Its action.
     * @param decider - Who approved it.
     * @param note - What they noted.
     * @returns The request, `APPROVED` or `FAILED`, and the decision.
     * @throws A `ConflictError` when a row the request was proposed against changed.
     */
    protected async runApproved(
        request: ApprovalRequest,
        action: ApprovalAction,
        decider: ApprovalActor,
        note: string | null
    ): Promise<ApprovalRequestDetails> {
        const input: object = await this.resolveInput(action, request.input);
        const description: ApprovalActionDescription = await action.describe(input);
        const broken: ApprovalPrecondition | undefined = ApprovalRequestUtilities
            .findBrokenPrecondition(request.preconditions, description.rows ?? []);
        if (broken != undefined) {
            throw new ConflictError(
                $ts`The row ${broken.id} of ${broken.entity} changed since the approval request was proposed. Propose the action again.`
            );
        }
        try {
            return await this.requestRepository.dataSource.runInTransaction(async transaction => {
                const result: unknown = await action.run(input, {
                    transaction,
                    request,
                    decidedBy: decider.by,
                    decidedByKind: decider.kind
                });
                return await this.recordDecision(
                    request,
                    decider,
                    { decision: ApprovalDecisionType.APPROVED, note, result: result ?? null, error: null },
                    ApprovalRequestStatus.APPROVED,
                    transaction
                );
            // an attempt that conflicted with another transaction wrote nothing, so the action runs once in effect
            }, { maxAttempts: 3 });
        }
        catch (error) {
            // a refusal is the action saying no, which the proposer reads. Anything else is the application's to
            // look into, and its message is nothing for the people reading the request
            const message: string = ErrorUtilities.isRefusal(error) ? error.message : $ts`The action failed.`;
            if (!ErrorUtilities.isRefusal(error)) {
                this.logger.error(new InternalError(`The approval action "${action.name}" failed.`, { cause: error }));
            }
            return await this.requestRepository.dataSource.runInTransaction(async transaction => await this.recordDecision(
                request,
                decider,
                { decision: ApprovalDecisionType.APPROVED, note, result: null, error: message },
                ApprovalRequestStatus.FAILED,
                transaction
            ), { maxAttempts: 3 });
        }
    }

    /**
     * Records a decision, and moves its request to where it then stands.
     * @param request - The request.
     * @param decider - Who decided it.
     * @param data - What was decided.
     * @param status - Where the request stands then.
     * @param transaction - The transaction to write in.
     * @returns The request and the decision.
     * @throws A `ConflictError` when the request is no longer pending, such as once it expired meanwhile.
     */
    protected async recordDecision(
        request: ApprovalRequest,
        decider: ApprovalActor,
        data: ApprovalDecisionData,
        status: ApprovalRequestStatus,
        transaction: Transaction
    ): Promise<ApprovalRequestDetails> {
        const [updated] = await this.requestRepository.updateAll(
            { id: request.id, status: ApprovalRequestStatus.PENDING },
            { status },
            { transaction, returnUpdated: true }
        );
        if (updated == undefined) {
            throw new ConflictError($ts`The approval request was decided or expired meanwhile.`);
        }
        const decision: ApprovalDecision = await this.decisionRepository.create(
            { requestId: request.id, decidedBy: decider.by, decidedByKind: decider.kind, decidedAt: new Date(), ...data },
            { transaction }
        );
        return { request: updated, decision };
    }

    /**
     * Reads a request of the active tenant.
     * @param requestId - Its id.
     * @returns The request.
     * @throws A `NotFoundError` when there is none.
     */
    protected async resolveRequest(requestId: string): Promise<ApprovalRequest> {
        const request: ApprovalRequest | undefined = await this.requestRepository.findById(requestId, { required: false });
        if (request == undefined) {
            throw new NotFoundError($ts`The approval request does not exist.`);
        }
        return request;
    }

    /**
     * The action a request proposes.
     * @param request - The request.
     * @returns Its action.
     * @throws A `ConflictError` when no action of its name is registered.
     */
    protected resolveRequestAction(request: ApprovalRequest): ApprovalAction {
        const action: ApprovalAction | undefined = this.findAction(request.action);
        if (action == undefined) {
            throw new ConflictError($ts`The action "${request.action}" of the approval request is not registered.`);
        }
        return action;
    }

    /**
     * Resolves the logged in user of the request this runs in, who needs a permission.
     * @param permission - The permission.
     * @param refusal - What a user without it is told.
     * @returns The user and the request.
     * @throws An `UnauthorizedError` outside a request or when nobody is logged in, and a `ForbiddenError` for a user
     * without the permission.
     */
    protected async resolveCaller(permission: Permission, refusal: TranslatedString): Promise<ApprovalCaller> {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = AlsUtilities.getCurrentRequestContext();
        const user: CurrentUser | undefined = context == undefined
            ? undefined
            : await this.authService.resolveCurrentUser(context, this.authService.strategies, false);
        if (context == undefined || user == undefined) {
            throw new UnauthorizedError($ts`You need to be logged in to propose or decide an approval request.`);
        }
        if (!await this.authService.hasPermission(context, this.authService.strategies, permission)) {
            throw new ForbiddenError(refusal);
        }
        return { user, context };
    }

    /**
     * Resolves the logged in user proposing an action, who needs its `proposePermission`.
     * @param action - The action.
     * @returns The user, as the proposer.
     * @throws An `UnauthorizedError` when nobody is logged in, and a `ForbiddenError` without the permission.
     */
    protected async resolveProposingUser(action: ApprovalAction): Promise<ApprovalActor> {
        const caller: ApprovalCaller = await this.resolveCaller(
            action.proposePermission,
            $ts`You do not have permission to propose this action.`
        );
        return { by: caller.user.id, kind: ApprovalActorKind.USER };
    }

    /**
     * Reads an input into the model of an action, the way a json body of it is read, and validates it.
     * @param action - The action.
     * @param raw - The input, as proposed or as stored.
     * @returns The input.
     * @throws A `ValidationError` when it is not one of the model.
     */
    protected async resolveInput(action: ApprovalAction, raw: unknown): Promise<object> {
        const input: unknown = parseObject(raw, action.input);
        const metadata: JsonBodyMetadata | XmlBodyMetadata = resolveStructuredBodyMetadata(
            { type: MimeType.JSON, modelClass: action.input },
            0
        );
        await inject(ZIBRI_DI_TOKENS.VALIDATION_SERVICE).validateBody(input, metadata);
        if (typeof input !== 'object' || input == undefined) {
            throw new BadRequestError($ts`The input of an approval request needs to be an object.`);
        }
        return input;
    }

    /**
     * Validates that a request waits for a decision.
     * @param request - The request.
     * @throws A `ConflictError` when it is decided or expired.
     */
    protected validatePending(request: ApprovalRequest): void {
        if (request.status !== ApprovalRequestStatus.PENDING) {
            throw new ConflictError($ts`The approval request is ${request.status}, and only a pending one can be decided.`);
        }
    }

    /**
     * Validates that a pending request has not expired, by the clock of the data source, and closes it when it has.
     * @param request - The request.
     * @throws A `ConflictError` once it expired.
     */
    protected async validateNotExpired(request: ApprovalRequest): Promise<void> {
        const closed: number = await this.requestRepository.updateAll(
            { id: request.id, status: ApprovalRequestStatus.PENDING, expiresAt: { before: dataSourceNow() } },
            { status: ApprovalRequestStatus.EXPIRED }
        );
        if (closed > 0) {
            throw new ConflictError($ts`The approval request expired at ${request.expiresAt.toISOString()}.`);
        }
    }

    /**
     * Emits a change of a request as the event the application named for it, once it is stored.
     * @param type - The type the application named, or undefined for none.
     * @param request - The request.
     */
    protected async emit(type: EventTypeFor<ApprovalRequestEventData> | undefined, request: ApprovalRequest): Promise<void> {
        if (type == undefined) {
            return;
        }
        const data: ApprovalRequestEventData = { requestId: request.id, action: request.action, status: request.status };
        await FrameworkEventUtilities.emit(type, data, request.tenantId);
    }
}