import { type CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { type HttpRequestContext } from '../../../context/request/http-request.context';
import { type McpAnswer } from '../models/mcp-answer.model';
import { type McpJsonRpcMessage } from '../models/mcp-json-rpc-message.model';
import { type McpTool } from '../models/mcp-tool.model';

/**
 * Answers the messages of MCP clients: the handshake of the revisions that have one, the discovery of the server, and
 * the listing and calling of its tools.
 */
export interface McpServiceInterface {
    /**
     * Answers one JSON-RPC message of a service account, sent to the MCP endpoint.
     * @param message - The message.
     * @param user - The service account.
     * @param context - The request, whose headers name the revision and the method.
     */
    handle: (message: McpJsonRpcMessage, user: CurrentUser, context: HttpRequestContext) => Promise<McpAnswer>,
    /**
     * Finds the tools a caller sees: those whose permission their credential carries in the tenant of the request.
     * @param user - The caller.
     */
    findTools: (user: CurrentUser) => McpTool[]
}