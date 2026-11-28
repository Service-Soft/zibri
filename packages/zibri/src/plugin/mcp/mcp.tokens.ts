/* eslint-disable jsdoc/require-jsdoc */
import { TokenRecord } from '../../di/models/di-token.model';
import { DiVariant } from '../../di/models/di-variant.model';
import { InjectionToken } from '../../di/models/injection-token.model';
import { type RateLimiterInterface } from '../../rate-limiting/limiter/rate-limiter.interface';
import { type TokenBucketState } from '../../rate-limiting/limiter/token-bucket.rate-limiter';
import { type McpPluginOptions } from './models/mcp-plugin-options.model';
import { type McpServiceInterface } from './services/mcp-service.interface';

/**
 * The dependency injection tokens used by the ZibriMcpPlugin.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_MCP_PLUGIN_DI_TOKENS = {
    OPTIONS: mcpToken<McpPluginOptions>('zi.mcp.options'),
    MCP_SERVICE: mcpToken<McpServiceInterface>('zi.mcp.mcp_service'),
    RATE_LIMITER: mcpToken<RateLimiterInterface<TokenBucketState>>('zi.mcp.rate_limiter')
} as const satisfies TokenRecord;

/**
 * The variant of the providers of MCP tools, which `provideMcpTool` gives them.
 */
export const MCP_TOOL_DI_VARIANT: DiVariant = new DiVariant('mcp-tool');

function mcpToken<T = never>(k: `zi.mcp.${string}`): InjectionToken<T> {
    return new InjectionToken<T>(k);
}
