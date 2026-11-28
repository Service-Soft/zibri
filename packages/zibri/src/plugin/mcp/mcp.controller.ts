import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { UserKindUtilities } from '../../auth/user/user-kind.utilities';
import { type HttpRequestContext } from '../../context/request/http-request.context';
import { type WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { ForbiddenError } from '../../error-handling/errors/forbidden.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { HttpStatus } from '../../http/http-status.enum';
import { JsonResponse } from '../../http/json-response.model';
import { KnownHeader } from '../../http/known-header.enum';
import { MimeType } from '../../http/mime-type.enum';
import { $ts } from '../../localization/translate.function';
import { Response } from '../../open-api/decorators/response.decorator';
import { RateLimited } from '../../rate-limiting/decorators/rate-limited.decorator';
import { Body } from '../../routing/decorators/body.decorator';
import { Post } from '../../routing/decorators/post.decorator';
import { ZIBRI_MCP_PLUGIN_DI_TOKENS } from './mcp.tokens';
import { type McpAnswer } from './models/mcp-answer.model';
import { McpJsonRpcMessage } from './models/mcp-json-rpc-message.model';

/**
 * The MCP endpoint, at the path of the controller that extends it: the Streamable HTTP transport of the Model Context
 * Protocol, which takes one JSON-RPC message per `POST` and answers it with JSON. Only a service account calls it,
 * through its API key or an access token of the authorization server, from no origin or one of `allowedOrigins`.
 */
// no @Controller of its own, for the reason ApprovalRequestController has none. A GET or DELETE of the path, which a
// revision with sessions or a stream of the server's own sends, is answered 405 by the router
export class McpController {
    @Auth.isLoggedIn()
    // per service account, which every request is of
    @RateLimited(ZIBRI_MCP_PLUGIN_DI_TOKENS.RATE_LIMITER, { keyFn: (_message: McpJsonRpcMessage, user: CurrentUser) => `mcp:${user.id}` })
    @Response.object(McpJsonRpcMessage)
    @Response.empty({ status: HttpStatus.ACCEPTED, mimeTypes: [MimeType.JSON] })
    @Response.error(HttpStatus.BAD_REQUEST)
    @Response.error(HttpStatus.FORBIDDEN)
    @Response.error(HttpStatus.NOT_FOUND)
    @Post('/')
    async message(
        @Body(McpJsonRpcMessage, { allowAdditionalProperties: true })
        message: McpJsonRpcMessage,
        @CurrentUser()
        user: CurrentUser
    ): Promise<JsonResponse<McpJsonRpcMessage | undefined>> {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (context?.type !== 'http-request') {
            throw new InternalError('The MCP endpoint answers http requests only.');
        }
        // a page of another site reaching the endpoint through the browser of somebody who can (DNS rebinding)
        const origin: string | undefined = context.request.get(KnownHeader.ORIGIN);
        if (origin != undefined && !inject(ZIBRI_MCP_PLUGIN_DI_TOKENS.OPTIONS).allowedOrigins.includes(origin)) {
            throw new ForbiddenError($ts`The origin "${origin}" may not call the MCP endpoint.`);
        }
        // an assistant acts as a service account of its own, so what it proposes is never proposed by a person, who
        // could be mistaken for it, and a person's key does not hand the assistant what the person may do
        if (UserKindUtilities.getKind(user) !== 'service') {
            throw new ForbiddenError($ts`Only a service account calls the MCP endpoint.`);
        }
        const answer: McpAnswer = await inject(ZIBRI_MCP_PLUGIN_DI_TOKENS.MCP_SERVICE).handle(message, user, context);
        return JsonResponse.of(answer.body, { status: answer.status });
    }
}
