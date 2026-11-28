import { inject } from '../../di/inject.function';
import { DiProvider } from '../../di/models/di-provider.model';
import { DiTokenProviderRecord, providersFromTokenRecord } from '../../di/models/di-token.model';
import { DiVariants } from '../../di/models/di-variant.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { validateTokensRegistered } from '../../utilities/validate-tokens-registered.function';
import { ZIBRI_APPROVAL_PLUGIN_DI_TOKENS } from '../approval/approval.tokens';
import { ZibriPlugin } from '../plugin.model';
import { McpToolUtilities } from './mcp-tool.utilities';
import { McpRateLimiter } from './mcp.rate-limiter';
import { ZIBRI_MCP_PLUGIN_DI_TOKENS } from './mcp.tokens';
import { type McpPluginOptions } from './models/mcp-plugin-options.model';
import { type McpTool } from './models/mcp-tool.model';
import { type McpWriteTool } from './models/mcp-write-tool.model';
import { McpService } from './services/mcp.service';

/**
 * Plugin of an MCP server: the tools an AI assistant reads the data of the application with, and proposes approval
 * requests through, as a service account.
 */
export class ZibriMcpPlugin extends ZibriPlugin {
    override providers: DiProvider<unknown>[];

    /**
     * Creates the plugin.
     * @param options - The origins a browser may call the endpoint from, how often a service account may call it,
     * and the instructions for the model.
     */
    constructor(options: McpPluginOptions) {
        super();
        const defaultDiProviders: DiTokenProviderRecord<typeof ZIBRI_MCP_PLUGIN_DI_TOKENS> = {
            OPTIONS: { useValue: options },
            MCP_SERVICE: { useClass: McpService },
            RATE_LIMITER: { useClass: McpRateLimiter, variants: [DiVariants.RATE_LIMITER] }
        };
        this.providers = providersFromTokenRecord(ZIBRI_MCP_PLUGIN_DI_TOKENS, defaultDiProviders);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    validate(): void {
        validateTokensRegistered(this.constructor.name, ZIBRI_MCP_PLUGIN_DI_TOKENS);
        const options: McpPluginOptions = inject(ZIBRI_MCP_PLUGIN_DI_TOKENS.OPTIONS);
        if (options.rateLimit.maxRequests <= 0 || options.rateLimit.windowInMs <= 0) {
            throw new InternalError(`${this.constructor.name} needs a rateLimit with a maxRequests and a windowInMs above 0.`);
        }
        // read once here, so that a provider holding no tool or two tools of one name stop the start
        const tools: McpTool[] = [...McpToolUtilities.resolveRegisteredTools().values()];
        const writing: McpWriteTool[] = tools.filter((tool): tool is McpWriteTool => tool.kind === 'write');
        if (!writing.length) {
            return;
        }
        // the approval request a write tool proposes is one of an action the approval plugin knows
        validateTokensRegistered(`${this.constructor.name}, for its write tools,`, { APPROVAL_REQUEST_SERVICE: ZIBRI_APPROVAL_PLUGIN_DI_TOKENS.APPROVAL_REQUEST_SERVICE });
        for (const tool of writing) {
            if (inject(ZIBRI_APPROVAL_PLUGIN_DI_TOKENS.APPROVAL_REQUEST_SERVICE).findAction(tool.action.name) !== tool.action) {
                throw new InternalError(
                    `The MCP tool "${tool.name}" proposes the approval action "${tool.action.name}", which needs to be registered with provideApprovalAction.`
                );
            }
        }
    }
}
