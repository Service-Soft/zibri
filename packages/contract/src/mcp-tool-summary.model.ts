/**
 * A tool of the MCP server of the application, as the route of the MCP tools of a service account answers it.
 */
export type McpToolSummaryModel = {
    /**
     * The name a client calls the tool by, such as `tasks.find`.
     */
    name: string,
    /**
     * What the tool is called in a list for people, such as `Find tasks`. Undefined for a tool without one.
     */
    title?: string,
    /**
     * What the tool does, as the model choosing a tool reads it.
     */
    description: string,
    /**
     * Whether the tool reads, or proposes an approval request that a person approves before anything is written.
     */
    kind: 'read' | 'write',
    /**
     * The tenant permission a caller needs to see and call the tool.
     */
    permission: string
};
