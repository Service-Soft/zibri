import { type CurrentUser } from '../../../auth/decorators/current-user.decorator';
import { type Permission } from '../../../auth/roles/permission.type';
import { type Newable } from '../../../types/newable.type';

/**
 * A tool of the MCP server that reads, such as finding the open tasks of a project. Registered with
 * `provideMcpTool`. A tool that writes is an `McpWriteTool`.
 */
export type McpReadTool<Input extends object = object, Output extends object = object> = {
    /**
     * Says that the tool reads.
     */
    readonly kind: 'read',
    /**
     * The name a client calls the tool by, such as `tasks.find`: letters, digits, `_`, `-` and `.`, at most 128
     * characters. Unique among the tools.
     */
    readonly name: string,
    /**
     * What the tool is called in a list for people, such as `Find tasks`. None by default.
     */
    readonly title?: string,
    /**
     * What the tool does and when to call it, for the model choosing a tool.
     */
    readonly description: string,
    /**
     * The model of the arguments, which a call is validated against and whose JSON Schema a client is given.
     */
    readonly input: Newable<Input>,
    /**
     * The model of what the tool answers, whose JSON Schema a client is given. What `read` answers is sent with the
     * properties the model declares only.
     */
    readonly output: Newable<Output>,
    /**
     * The tenant permission a caller needs to see and call the tool.
     */
    readonly permission: Permission,
    /**
     * Reads what the tool answers, as the caller, in the tenant of the request.
     * @param input - The arguments, validated against `input`.
     * @param user - The service account calling.
     */
    // a method rather than a function property, for the reason ApprovalAction gives for its own
    // eslint-disable-next-line typescript/method-signature-style
    read(input: Input, user: CurrentUser): Promise<Output>
};
