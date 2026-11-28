/**
 * The revisions of the Model Context Protocol the MCP plugin speaks, each by its date.
 */
export type McpProtocolRevisions = {
    /**
     * The revisions whose every request names its revision and the capabilities of its client, latest first. A
     * client of one of them is answered without a handshake, and the first is the one the server names first.
     */
    readonly stateless: readonly string[],
    /**
     * The revisions whose client starts with `initialize`, latest first. A client asking for one that is not here is
     * answered with the first.
     */
    readonly handshake: readonly string[]
};

// the one place a revision is adopted: add it here, answer what it changed in McpService, and add its run of the
// cases of mcp.plugin.test.ts
/**
 * The revisions of the Model Context Protocol the MCP plugin speaks.
 */
export const MCP_PROTOCOL_REVISIONS: McpProtocolRevisions = {
    stateless: ['2026-07-28'],
    handshake: ['2025-11-25', '2025-06-18']
};