import { Auth } from '../../auth/decorators/auth.decorator';
import { type PaginationResult } from '../../data-source/models/pagination-result.model';
import { inject } from '../../di/inject.function';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { HttpStatus } from '../../http/http-status.enum';
import { $ts } from '../../localization/translate.function';
import { Response } from '../../open-api/decorators/response.decorator';
import { Body } from '../../routing/decorators/body.decorator';
import { Get } from '../../routing/decorators/get.decorator';
import { Param } from '../../routing/decorators/param.decorator';
import { Post } from '../../routing/decorators/post.decorator';
import { ZIBRI_APPROVAL_PLUGIN_DI_TOKENS } from './approval.tokens';
import { ApprovalDecisionInput } from './models/approval-decision-input.model';
import { ApprovalLimits } from './models/approval-limits.model';
import { ApprovalRequestDetails } from './models/approval-request-details.model';
import { ApprovalRequestStatus } from './models/approval-request-status.enum';
import { ApprovalRequest } from './models/approval-request.model';
import { NewApprovalRequest } from './models/new-approval-request.model';
import { ZibriApprovalPermissions } from './models/zibri-approval-permissions.model';
import { type ApprovalRequestServiceInterface } from './services/approval-request-service.interface';

/**
 * The routes of the approval requests of the tenant of the request, below the path of the controller that extends it:
 * proposing an action, listing and reading the requests, and approving and rejecting them. Reading is behind
 * `approval-requests.read`, deciding behind `approval-requests.decide` and the permission of the action.
 */
// no @Controller of its own, for the reason MailingListController has none: the application's class extending this
// one says where the routes are. Every decorator is on a route rather than the class, which the application's class
// would not inherit
export class ApprovalRequestController {
    // read when used rather than injected, for the reason MailingListController reads its repository so
    private get approvalRequestService(): ApprovalRequestServiceInterface {
        return inject(ZIBRI_APPROVAL_PLUGIN_DI_TOKENS.APPROVAL_REQUEST_SERVICE);
    }

    // which users may propose is the proposePermission of each action, which the service checks
    @Auth.isLoggedIn()
    @Response.object(ApprovalRequestDetails)
    @Post('/')
    async propose(
        @Body(NewApprovalRequest)
        proposal: NewApprovalRequest
    ): Promise<ApprovalRequestDetails> {
        return await this.approvalRequestService.propose({ action: proposal.action, input: proposal.input, reason: proposal.reason });
    }

    @Auth.hasPermission(ZibriApprovalPermissions.APPROVAL_REQUESTS_READ)
    @Response.paginated(ApprovalRequest)
    @Get('/')
    async findRequests(
        @Param.query('page', { type: 'number', format: 'integer', min: 1 })
        page: number,
        @Param.query('limit', { type: 'number', format: 'integer', min: 1, max: ApprovalLimits.PAGE_MAX_LIMIT })
        limit: number,
        @Param.query('status', { type: 'string', enum: ApprovalRequestStatus, required: false })
        status: ApprovalRequestStatus | undefined,
        @Param.query('action', { type: 'string', required: false, maxLength: ApprovalLimits.ACTION_MAX_LENGTH })
        action: string | undefined
    ): Promise<PaginationResult<ApprovalRequest>> {
        return await this.approvalRequestService.findRequests(page, limit, { status, action });
    }

    @Auth.hasPermission(ZibriApprovalPermissions.APPROVAL_REQUESTS_READ)
    @Response.error(HttpStatus.NOT_FOUND)
    @Response.object(ApprovalRequestDetails)
    @Get('/:id')
    async findRequest(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string
    ): Promise<ApprovalRequestDetails> {
        const res: ApprovalRequestDetails | undefined = await this.approvalRequestService.findRequest(id);
        if (res == undefined) {
            throw new NotFoundError($ts`The approval request does not exist.`);
        }
        return res;
    }

    @Auth.hasPermission(ZibriApprovalPermissions.APPROVAL_REQUESTS_DECIDE)
    @Response.error(HttpStatus.NOT_FOUND)
    @Response.error(HttpStatus.CONFLICT)
    @Response.object(ApprovalRequestDetails)
    @Post('/:id/approve')
    async approve(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @Body(ApprovalDecisionInput)
        input: ApprovalDecisionInput
    ): Promise<ApprovalRequestDetails> {
        return await this.approvalRequestService.approve(id, input.note);
    }

    @Auth.hasPermission(ZibriApprovalPermissions.APPROVAL_REQUESTS_DECIDE)
    @Response.error(HttpStatus.NOT_FOUND)
    @Response.error(HttpStatus.CONFLICT)
    @Response.object(ApprovalRequestDetails)
    @Post('/:id/reject')
    async reject(
        @Param.path('id', { type: 'string', format: 'uuid' })
        id: string,
        @Body(ApprovalDecisionInput)
        input: ApprovalDecisionInput
    ): Promise<ApprovalRequestDetails> {
        return await this.approvalRequestService.reject(id, input.note);
    }
}