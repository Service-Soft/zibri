import { type ApprovalAction } from '../../approval/models/approval-action.model';

/**
 * A tool of the MCP server that writes, such as closing a task. A call proposes its approval action, and answers the
 * approval request it created: nothing is written until a person approves it. Registered with `provideMcpTool`,
 * beside the action registered with `provideApprovalAction`.
 */
export type McpWriteTool<Input extends object = object> = {
    /**
     * Says that the tool writes.
     */
    readonly kind: 'write',
    /**
     * The name a client calls the tool by, such as `tasks.close`: letters, digits, `_`, `-` and `.`, at most 128
     * characters. Unique among the tools.
     */
    readonly name: string,
    /**
     * What the tool is called in a list for people, such as `Close a task`. None by default.
     */
    readonly title?: string,
    /**
     * What the tool proposes and when to call it, for the model choosing a tool.
     */
    readonly description: string,
    /**
     * The action a call proposes. Its `input` is the model of the arguments, and its `proposePermission` the tenant
     * permission a caller needs to see and call the tool.
     */
    readonly action: ApprovalAction<Input>
};
