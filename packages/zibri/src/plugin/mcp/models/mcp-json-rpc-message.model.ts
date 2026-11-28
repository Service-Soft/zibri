import { Property } from '../../../entity/decorators/property.decorator';

/**
 * A JSON-RPC message as the MCP endpoint takes it: a request, a notification or a response, which the MCP service
 * reads, answering what it is not with a JSON-RPC error.
 */
export class McpJsonRpcMessage {
    /**
     * The version of JSON-RPC, `2.0`.
     */
    @Property.unknown({ required: false })
    jsonrpc?: unknown;

    /**
     * The id of a request, a string or a number. None for a notification.
     */
    @Property.unknown({ required: false })
    id?: unknown;

    /**
     * The method, such as `tools/call`.
     */
    @Property.unknown({ required: false })
    method?: unknown;

    /**
     * The parameters of the method.
     */
    @Property.unknown({ required: false })
    params?: unknown;

    /**
     * The result of a response.
     */
    @Property.unknown({ required: false })
    result?: unknown;

    /**
     * The error of a response.
     */
    @Property.unknown({ required: false })
    error?: unknown;
}
