import { DiProvider } from '../../di/models/di-provider.model';
import { InjectionToken } from '../../di/models/injection-token.model';
import { MCP_TOOL_DI_VARIANT } from './mcp.tokens';
import { type McpTool } from './models/mcp-tool.model';

/**
 * Registers a tool of the MCP server, for the `providers` of an application or a plugin.
 * @param tool - The tool: an `McpReadTool`, or an `McpWriteTool` of an approval action.
 * @returns The provider of the tool.
 */
export function provideMcpTool<Input extends object, Output extends object>(tool: McpTool<Input, Output>): DiProvider<McpTool> {
    return {
        token: new InjectionToken<McpTool>(`zi.mcp.tool.${tool.name}`),
        // a tool of any input is one of object input, see the methods of McpReadTool and ApprovalAction
        useValue: tool,
        variants: [MCP_TOOL_DI_VARIANT]
    };
}