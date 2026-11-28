import { type McpReadTool } from './mcp-read-tool.model';
import { type McpWriteTool } from './mcp-write-tool.model';

/**
 * A tool of the MCP server: one that reads, or one that proposes an approval action, which runs once a person or a
 * policy of it approves it.
 */
export type McpTool<Input extends object = object, Output extends object = object> = McpReadTool<Input, Output> | McpWriteTool<Input>;