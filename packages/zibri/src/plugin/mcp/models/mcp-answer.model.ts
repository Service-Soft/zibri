import { type HttpStatus } from '../../../http/http-status.enum';
import { type McpJsonRpcMessage } from './mcp-json-rpc-message.model';

/**
 * What the MCP endpoint answers a message with: the status, and the JSON-RPC response, none for a notification.
 */
export type McpAnswer = {
    /**
     * The status of the HTTP response.
     */
    status: HttpStatus,
    /**
     * The JSON-RPC response. Undefined for a notification, which is answered `202` without a body.
     */
    body: McpJsonRpcMessage | undefined
};