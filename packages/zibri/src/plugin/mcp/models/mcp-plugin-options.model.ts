import { type McpRateLimitOptions } from './mcp-rate-limit-options.model';

/**
 * What the MCP plugin is created with.
 */
export type McpPluginOptions = {
    /**
     * The origins a browser may call the MCP endpoint from, such as `https://app.example.com`. A request naming
     * any other origin in its `Origin` header is refused with a `403`, which is what keeps a page from reaching the
     * endpoint through the browser of somebody who can. An empty list refuses every request that names an origin,
     * and takes those of a client that is no browser.
     */
    readonly allowedOrigins: readonly string[],
    /**
     * How often one service account may call the endpoint.
     */
    readonly rateLimit: McpRateLimitOptions,
    /**
     * What a client hands its model on how to use the tools, such as which tool to call first. None by default.
     */
    readonly instructions?: string
};
