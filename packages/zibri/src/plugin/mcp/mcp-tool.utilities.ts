import { type Permission } from '../../auth/roles/permission.type';
import { getDiTokenName } from '../../di/get-di-token-name.function';
import { getRegisteredProvidersOfVariant } from '../../di/get-registered-providers-of-variant.function';
import { inject } from '../../di/inject.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { type Newable } from '../../types/newable.type';
import { MCP_TOOL_DI_VARIANT } from './mcp.tokens';
import { McpProposal } from './models/mcp-proposal.model';
import { type McpTool } from './models/mcp-tool.model';

/**
 * What the name of a tool is made of, as the protocol recommends it.
 */
const TOOL_NAME: RegExp = /^[\w.-]{1,128}$/;

/**
 * Reads the registered tools of the MCP server, and what each takes and answers.
 */
export abstract class McpToolUtilities {
    /**
     * Resolves the tools registered with `provideMcpTool`, by name, in the order they were registered.
     * @returns The tools.
     * @throws An InternalError for a provider that is no tool, a name the protocol does not take, and two tools of
     * one name.
     */
    static resolveRegisteredTools(): Map<string, McpTool> {
        const tools: Map<string, McpTool> = new Map();
        for (const provider of getRegisteredProvidersOfVariant(MCP_TOOL_DI_VARIANT)) {
            const tool: unknown = inject(provider.token);
            if (!this.isTool(tool)) {
                throw new InternalError(`${getDiTokenName(provider.token)} is provided as an MCP tool, and needs to be one.`);
            }
            if (!TOOL_NAME.test(tool.name)) {
                throw new InternalError(`The MCP tool "${tool.name}" needs a name of at most 128 letters, digits, _, - and . characters.`);
            }
            if (tools.has(tool.name)) {
                throw new InternalError(`Two MCP tools are named "${tool.name}", which needs to be unique.`);
            }
            tools.set(tool.name, tool);
        }
        return tools;
    }

    /**
     * The tenant permission a caller needs to see and call a tool.
     * @param tool - The tool.
     * @returns The `permission` of a read tool, the `proposePermission` of the action of a write tool.
     */
    static getPermission(tool: McpTool): Permission {
        switch (tool.kind) {
            case 'read': {
                return tool.permission;
            }
            case 'write': {
                return tool.action.proposePermission;
            }
        }
    }

    /**
     * The model of the arguments of a tool.
     * @param tool - The tool.
     * @returns The `input` of a read tool, the one of the action of a write tool.
     */
    static getInput(tool: McpTool): Newable<object> {
        switch (tool.kind) {
            case 'read': {
                return tool.input;
            }
            case 'write': {
                return tool.action.input;
            }
        }
    }

    /**
     * The model of what a tool answers.
     * @param tool - The tool.
     * @returns The `output` of a read tool, `McpProposal` for a write tool.
     */
    static getOutput(tool: McpTool): Newable<object> {
        switch (tool.kind) {
            case 'read': {
                return tool.output;
            }
            case 'write': {
                return McpProposal;
            }
        }
    }

    private static isTool(value: unknown): value is McpTool {
        return typeof value === 'object'
            && value != undefined
            && 'name' in value
            && typeof value.name === 'string'
            && 'kind' in value
            && (value.kind === 'read' || value.kind === 'write');
    }
}
