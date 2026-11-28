import { type ZibriApplication } from '../application/application';
import { Auth } from '../auth/decorators/auth.decorator';
import { type PaginationResult } from '../data-source/models/pagination-result.model';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { NotFoundError } from '../error-handling/errors/not-found.error';
import { ServiceUnavailableError } from '../error-handling/errors/service-unavailable.error';
import { type OnAppInit } from '../global/on-app-init.interface';
import { HttpStatus } from '../http/http-status.enum';
import { CircuitOpenError } from '../http-client/circuit-open.error';
import { HttpClientError } from '../http-client/http-client.error';
import { $ts } from '../localization/translate.function';
import { Response } from '../open-api/decorators/response.decorator';
import { Body } from '../routing/decorators/body.decorator';
import { Delete } from '../routing/decorators/delete.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { Param } from '../routing/decorators/param.decorator';
import { Post } from '../routing/decorators/post.decorator';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';
import { TenantWebDavConnection } from '../web-dav/tenant-web-dav-connection.model';
import { WebDavForbiddenError } from '../web-dav/web-dav-forbidden.error';
import { WebDavNotFoundError } from '../web-dav/web-dav-not-found.error';
import { ZIBRI_FILE_MIRROR_LIMITS } from './file-mirror-limits.model';
import { FileMirrorRequest } from './file-mirror-request.model';
import { type FileMirrorServiceInterface } from './file-mirror-service.interface';
import { FileMirrorShareLinkInput } from './file-mirror-share-link-input.model';
import { FileMirrorShareLink } from './file-mirror-share-link.model';
import { MirroredFileConflictResolutionInput } from './mirrored-file-conflict-resolution-input.model';
import { MirroredFile } from './mirrored-file.model';
import { ZibriFileMirrorPermissions } from './zibri-file-mirror-permissions.model';

/**
 * The routes of the file mirror of the tenant of the request, below the path of the controller that extends it:
 * listing the mirrored files in conflict, resolving a conflict, answering the share link of a path, created where
 * there is none, and revoking one. Listing is behind `file-mirror.read`, everything else behind `file-mirror.manage`.
 */
// no @Controller of its own, for the reason MailingListController has none: the application's class extending this
// one says where the routes are. Every decorator is on a route rather than the class, which the application's class
// would not inherit
export class FileMirrorController implements OnAppInit {
    // read when used rather than injected, for the reason MailingListController reads its repository so
    private get fileMirrorService(): FileMirrorServiceInterface {
        return inject(ZIBRI_DI_TOKENS.FILE_MIRROR_SERVICE);
    }

    onAppInit(app: ZibriApplication): void {
        // every route needs them, the share links included: a controller registered is every route registered
        validateEntitiesRegistered(
            FileMirrorController.name,
            app,
            MirroredFile,
            FileMirrorRequest,
            FileMirrorShareLink,
            TenantWebDavConnection
        );
    }

    @Auth.hasPermission(ZibriFileMirrorPermissions.FILE_MIRROR_READ)
    @Response.paginated(MirroredFile)
    @Get('/conflicts')
    async findConflicts(
        @Param.query('page', { type: 'number', format: 'integer', min: 1 })
        page: number,
        @Param.query('limit', { type: 'number', format: 'integer', min: 1, max: ZIBRI_FILE_MIRROR_LIMITS.CONFLICTS_PAGE_MAX_LIMIT })
        limit: number
    ): Promise<PaginationResult<MirroredFile>> {
        return await this.fileMirrorService.findConflicts(page, limit);
    }

    @Auth.hasPermission(ZibriFileMirrorPermissions.FILE_MIRROR_MANAGE)
    @Response.error(HttpStatus.BAD_REQUEST)
    @Response.error(HttpStatus.NOT_FOUND)
    @Response.error(HttpStatus.SERVICE_UNAVAILABLE)
    @Response.empty()
    @Post('/conflicts/:mirroredFileId/resolution')
    async resolveConflict(
        @Param.path('mirroredFileId', { type: 'string', format: 'uuid' })
        mirroredFileId: string,
        @Body(MirroredFileConflictResolutionInput)
        input: MirroredFileConflictResolutionInput
    ): Promise<void> {
        await FileMirrorController.callServer(async () => await this.fileMirrorService.resolveConflict(mirroredFileId, input.resolution));
    }

    @Auth.hasPermission(ZibriFileMirrorPermissions.FILE_MIRROR_MANAGE)
    @Response.error(HttpStatus.BAD_REQUEST)
    @Response.error(HttpStatus.NOT_FOUND)
    @Response.error(HttpStatus.SERVICE_UNAVAILABLE)
    @Response.object(FileMirrorShareLink)
    @Post('/share-links')
    async resolveShareLink(
        @Body(FileMirrorShareLinkInput)
        input: FileMirrorShareLinkInput
    ): Promise<FileMirrorShareLink> {
        return await FileMirrorController.callServer(async () => await this.fileMirrorService.resolveShareLink({
            connectionId: input.connectionId,
            path: input.path,
            password: input.password,
            expiresOn: input.expiresOn
        }));
    }

    @Auth.hasPermission(ZibriFileMirrorPermissions.FILE_MIRROR_MANAGE)
    @Response.error(HttpStatus.BAD_REQUEST)
    @Response.error(HttpStatus.NOT_FOUND)
    @Response.error(HttpStatus.SERVICE_UNAVAILABLE)
    @Response.empty()
    @Delete('/share-links')
    async revokeShareLink(
        @Param.query('connectionId', { type: 'string', format: 'uuid' })
        connectionId: string,
        @Param.query('path', { type: 'string', minLength: 1, maxLength: ZIBRI_FILE_MIRROR_LIMITS.PATH_MAX_LENGTH })
        path: string
    ): Promise<void> {
        await FileMirrorController.callServer(async () => await this.fileMirrorService.revokeShareLink(connectionId, path));
    }

    /**
     * Calls the service for a route that reaches the WebDAV server, answering what the server refused with an error
     * of the route.
     * @param call - The call.
     * @returns What it resolves to.
     */
    private static async callServer<T>(call: () => Promise<T>): Promise<T> {
        try {
            return await call();
        }
        catch (error) {
            throw FileMirrorController.resolveServerError(error);
        }
    }

    /**
     * Resolves what a refusal of the WebDAV server is answered with.
     * @param error - What the call failed with.
     * @returns The error of the route, or the error itself when it is none of the server.
     */
    private static resolveServerError(error: unknown): unknown {
        // an error of the http client is a 500 otherwise, which tells the caller nothing of what to change
        if (error instanceof WebDavNotFoundError) {
            return new NotFoundError($ts`The WebDAV server has nothing at the path.`, { cause: error });
        }
        if (error instanceof WebDavForbiddenError) {
            return new BadRequestError($ts`The WebDAV server refused the user of the connection access to the path.`, { cause: error });
        }
        const status: number | undefined = error instanceof HttpClientError ? error.responseData?.status : undefined;
        if (
            error instanceof CircuitOpenError
            || (error instanceof HttpClientError && (status == undefined || status >= HttpStatus.INTERNAL_SERVER_ERROR))
        ) {
            return new ServiceUnavailableError($ts`The WebDAV server cannot be reached.`, { cause: error });
        }
        return error instanceof HttpClientError
            ? new BadRequestError($ts`The WebDAV server refused the request with ${String(status)}.`, { cause: error })
            : error;
    }
}