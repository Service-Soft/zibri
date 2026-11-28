import { type McpToolSummaryModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';

/**
 * A tool of the MCP server, as `GET /:serviceAccountId` of the `ServiceAccountMcpToolController` answers it.
 */
export class McpToolSummary implements McpToolSummaryModel {
    /**
     * The name a client calls the tool by, such as `tasks.find`.
     */
    @Property.string()
    name!: string;

    /**
     * What the tool is called in a list for people, such as `Find tasks`. Undefined for a tool without one.
     */
    @Property.string({ required: false })
    title?: string;

    /**
     * What the tool does, as the model choosing a tool reads it.
     */
    @Property.string()
    description!: string;

    /**
     * Whether the tool reads, or proposes an approval request that a person approves before anything is written.
     */
    @Property.string({ enum: { read: 'read', write: 'write' } })
    kind!: 'read' | 'write';

    /**
     * The tenant permission a caller needs to see and call the tool.
     */
    @Property.string()
    permission!: string;
}
