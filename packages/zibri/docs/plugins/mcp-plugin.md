---
keywords: [mcp, model context protocol, ai assistant, llm, tools, agent, claude, chatgpt, json-rpc]
---

# Serving AI assistants over MCP
`ZibriMcpPlugin` makes your application an MCP server: an endpoint an AI assistant calls the tools of over the [Model Context Protocol](https://modelcontextprotocol.io), with any client that speaks it. A tool reads data of a [tenant](../glossary.md#tenant), or proposes an [approval request](./approval-plugin.md) that a person approves before anything is written. The assistant calls as a [service account](../auth/api-keys.md#service-accounts) of its own, with an [API key](../glossary.md#api-key), and sees only the tools whose permission its key carries.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ZibriMcpPlugin` | class | The plugin of the MCP server, created with its `McpPluginOptions` |
| `McpController` | class | The MCP endpoint, at the path of your controller extending it |
| `provideMcpTool` | function | Registers a tool, for the `providers` of your application or of a plugin |
| `McpReadTool` | type | A tool that reads: its `name`, `description`, `input` and `output` models, `permission` and `read`, see [declaring a tool that reads](#declaring-a-tool-that-reads) |
| `McpWriteTool` | type | A tool that proposes an approval action: its `name`, `description` and `action`, see [declaring a tool that writes](#declaring-a-tool-that-writes) |
| `McpTool` | type | A tool of either kind |
| `McpPluginOptions`, `McpRateLimitOptions` | type, type | What the plugin is created with: `allowedOrigins`, `rateLimit` and `instructions`. Required |
| `McpProposal` | class | What a write tool answers: the `approvalRequestId` and its `status` |
| `ZIBRI_MCP_PLUGIN_DI_TOKENS` | DI token | The tokens of the plugin, see [configuring the plugin](#configuring-the-plugin) |
| `McpServiceInterface`, `McpService` | interface, class | Answers the messages of the clients. Replaceable through `ZIBRI_MCP_PLUGIN_DI_TOKENS.MCP_SERVICE` |
| `McpRateLimiter` | class | Limits how often a service account calls the endpoint. Replaceable through `ZIBRI_MCP_PLUGIN_DI_TOKENS.RATE_LIMITER` |
| `MCP_PROTOCOL_REVISIONS`, `McpProtocolRevisions` | constant, type | The revisions of the protocol the server speaks, see [protocol revisions](#protocol-revisions) |
| `McpJsonRpcMessage`, `McpAnswer` | class, type | A JSON-RPC message the endpoint takes and answers, and what the service answers it with |
| `MCP_TOOL_DI_VARIANT` | constant | The variant `provideMcpTool` gives the provider of a tool |
| `ServiceAccountMcpToolController` | class | The route of the tools a service account can use, for the people managing it, see [listing the tools of a service account](#listing-the-tools-of-a-service-account) |
| `McpToolSummary` | class | A tool as that route answers it: its `name`, `title`, `description`, `kind` and `permission` |

## Setting it up
Extend `McpController` with a `@Controller` of your own, at the path the clients are given:

```ts
// src/controllers/mcp.controller.ts
import { Controller, McpController } from 'zibri';

@Controller('/mcp', { versions: 'all' })
export class AppMcpController extends McpController {}
```

Add it and `new ZibriMcpPlugin()` with its options to your application, beside `ZibriApprovalPlugin` when a tool writes, and register `ApiKeyAuthStrategy`:

```ts
// src/application-options.base.ts
import { ApiKeyAuthStrategy, JwtAuthStrategy, Ms, OmitStrict, RateLimitStoreFailurePolicy, ZibriApplicationOptions, ZibriApprovalPlugin, ZibriMcpPlugin } from 'zibri';

import { AppMcpController } from './controllers/mcp.controller';

export const baseApplicationOptions: OmitStrict<ZibriApplicationOptions, 'dataSources'> = {
    name: 'Task Tracker',
    baseUrl: 'http://localhost:3000',
    version: '1.0.0',
    environment: 'development',
    plugins: [
        new ZibriApprovalPlugin(),
        new ZibriMcpPlugin({
            allowedOrigins: [],
            rateLimit: { maxRequests: 600, windowInMs: Ms.MINUTE * 10, onStoreFailure: RateLimitStoreFailurePolicy.REJECT },
            instructions: 'Find the open tasks of a project before proposing to close one.'
        })
    ],
    authStrategies: [JwtAuthStrategy, ApiKeyAuthStrategy],
    controllers: [AppMcpController],
    websocketControllers: [],
    defaultAuth: 'public',
    twoFactorAtLogin: 'never'
};
```

Create a service account for the assistant, give it a [membership](../glossary.md#membership) in each tenant it works in, with a role carrying the permissions of its tools, and a key, see [service accounts](../auth/api-keys.md#service-accounts). Your administrators do it through the routes of the [`ServiceAccountController`](../auth/api-keys.md#letting-administrators-manage-service-accounts). The client sends the key in the `x-api-key` header, and the tenant in the tenant header, unless the key is bound to one.

| Option | What it is |
|---|---|
| `allowedOrigins` | The origins a browser may call the endpoint from, such as `https://app.example.com`. A request naming another origin in its `Origin` header is refused with a `403`, which keeps a page of another site from reaching the endpoint through a browser. A client that is no browser sends no origin. Required |
| `rateLimit` | How many requests one service account may send in a window, `maxRequests` and `windowInMs`, and what one the limiter has no room for gets, `onStoreFailure`. Required |
| `instructions` | What a client hands its model on how to use the tools. None by default |

## Declaring a tool that reads
A tool that reads names the model of its arguments, the model of what it answers, the tenant permission a caller needs, and `read`:

```ts
// src/mcp/find-tasks.mcp-tool.ts
import { inject, McpReadTool, Property, Repository, repositoryTokenFor } from 'zibri';

import { Permissions, Task } from '../models';

export class FindTasksInput {
    @Property.string({ description: 'The status of the tasks, such as open or done' })
    status!: string;
}

export class TaskSummary {
    @Property.string({ format: 'uuid' })
    id!: string;

    @Property.string()
    title!: string;
}

export class FoundTasks {
    @Property.array({ items: { type: 'object', cls: () => TaskSummary } })
    tasks!: TaskSummary[];
}

export const findTasksTool: McpReadTool<FindTasksInput, FoundTasks> = {
    kind: 'read',
    name: 'tasks.find',
    title: 'Find tasks',
    description: 'Finds the tasks of the team that have a status.',
    input: FindTasksInput,
    output: FoundTasks,
    permission: Permissions.TASKS_READ,
    async read(input) {
        const taskRepository: Repository<Task> = inject(repositoryTokenFor(Task));
        return { tasks: await taskRepository.findAll({ where: { status: input.status } }) };
    }
};
```

A client is given the JSON Schema of both models, which is what the [OpenAPI document](../endpoints/open-api.md) holds for them. A call is validated against `input`, and answered with the properties `output` declares only: the rows `read` answers here are sent with their `id` and `title`. `read` runs as the service account, in the tenant of the request.

> [!WARNING]
> `read` is code of yours, which the plugin runs as it is. Write through an approval action only, see [declaring a tool that writes](#declaring-a-tool-that-writes).

## Declaring a tool that writes
A tool that writes names an [approval action](./approval-plugin.md#declaring-an-action), whose `input` is the model of its arguments and whose `proposePermission` a caller needs. A call proposes the action as the service account, and answers the approval request it created:

```ts
// src/mcp/close-task.mcp-tool.ts
import { McpWriteTool } from 'zibri';

import { closeTaskAction } from '../approvals/close-task.approval-action';

export const closeTaskTool: McpWriteTool<{ taskId: string }> = {
    kind: 'write',
    name: 'tasks.close',
    description: 'Proposes closing a task. A person approves it before the task is closed.',
    action: closeTaskAction
};
```

Register every tool with `provideMcpTool`, and the action of a write tool with `provideApprovalAction`:

```ts
// src/providers.ts
import { DiProvider, provideApprovalAction, provideMcpTool } from 'zibri';

import { closeTaskAction } from './approvals/close-task.approval-action';
import { closeTaskTool } from './mcp/close-task.mcp-tool';
import { findTasksTool } from './mcp/find-tasks.mcp-tool';

export const mcpProviders: DiProvider<unknown>[] = [provideApprovalAction(closeTaskAction), provideMcpTool(findTasksTool), provideMcpTool(closeTaskTool)];
```

The application does not start with two tools of one name, or with a write tool whose action is not registered. A call answers the request while it waits:

```json
{ "approvalRequestId": "9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d", "status": "PENDING" }
```

Nothing the action writes is written until a person approves the request, or a [policy](./approval-plugin.md#approving-automatically) of the action does, which the status then says. The service account proposed it, and never approves it: it has no login, and a route taking a [second factor](../glossary.md#second-factor) is closed to it.

## Calling the endpoint
`POST` of the path takes one JSON-RPC message, and answers a request with JSON, a notification with `202`. A `GET` is answered `405`: the server opens no stream of its own. The methods:

| Method | Answers |
|---|---|
| `server/discover` | The revisions the server speaks, its capabilities and the `instructions`. Stateless revisions only |
| `initialize`, `notifications/initialized`, `ping` | The handshake. Revisions with a handshake only, see [protocol revisions](#protocol-revisions) |
| `tools/list` | The tools the caller sees, on one page |
| `tools/call` | What the tool answers, as `structuredContent` and as its JSON in a text content |

```bash
curl https://api.example.com/mcp \
    -H 'x-api-key: zibri_3q2-7wEAAAB6t...' \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'content-type: application/json' \
    -H 'accept: application/json, text/event-stream' \
    -H 'mcp-protocol-version: 2026-07-28' \
    -H 'mcp-method: tools/call' \
    -H 'mcp-name: tasks.find' \
    -d '{ "jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": { "name": "tasks.find", "arguments": { "status": "open" }, "_meta": { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientCapabilities": {} } } }'
```

Only a service account calls the endpoint: a request with the key or the login of a person is refused with a `403`, so what the assistant proposes is never proposed in the name of a person. A caller sees a tool when the permissions of its key, narrowed to what its roles carry in the tenant of the request, include the permission of the tool. A call of a tool the caller does not see answers like one of a tool that does not exist, with the JSON-RPC error `-32602`.

| A call is answered with | When |
|---|---|
| A result | The tool answered |
| A result with `isError: true` | The arguments are not of the model, or the tool refused the call, such as with a `ConflictError`. The text says why, for the model to correct the call |
| The error `-32602` | The tool does not exist, or the caller does not see it |
| The error `-32603` | The tool failed for another reason, which is logged |

## Protocol revisions
The server speaks the revisions of `MCP_PROTOCOL_REVISIONS`:

| Revision | How a client starts |
|---|---|
| `2026-07-28` | Without a handshake. Every request names the revision and the capabilities of its client in its `_meta`, and in its `MCP-Protocol-Version`, `Mcp-Method` and `Mcp-Name` headers |
| `2025-11-25`, `2025-06-18` | With `initialize`, which answers the revision asked for, or `2025-11-25` for one the server does not speak. Every later request names the revision in its `MCP-Protocol-Version` header. The server keeps no session |

A request of a revision the server does not speak is answered `400`, with the error `-32022` and the revisions it does speak. So is a request of a revision without a handshake whose headers do not match its body, with the error `-32020`.

## Listing the tools of a service account
Extend `ServiceAccountMcpToolController` with a `@Controller` of your own, beside the [routes of the service accounts](../auth/api-keys.md#letting-administrators-manage-service-accounts):

```ts
// src/controllers/service-account-tool.controller.ts
import { Controller, ServiceAccountMcpToolController } from 'zibri';

@Controller('/service-account-tools')
export class AppServiceAccountToolController extends ServiceAccountMcpToolController {}
```

`GET /:serviceAccountId` answers the tools whose permission the roles of the service account carry in the tenant of the request, each as an `McpToolSummary`, in the order they were registered. A request acting in no tenant gets the tools of every tenant the service account is a member of. A client calling with a key sees those of them whose permission its key lists. The route needs the platform permission `service-accounts.read`, and answers `404` for the id of a person. `zibri-contract` has the model as `McpToolSummaryModel`.

## Limiting how often
Each service account may send `rateLimit.maxRequests` requests in `rateLimit.windowInMs`, and is refused with a `429` past them. `McpRateLimiter` counts in memory, so the limit is per instance. Provide a limiter of your own under `ZIBRI_MCP_PLUGIN_DI_TOKENS.RATE_LIMITER` for one shared across instances, see [sharing limits across instances](../endpoints/rate-limiting.md#sharing-limits-across-instances).

## What gets recorded
Every call of a tool is recorded in the [audit trail](../data/audit.md) as `mcp.tool.called`, in the tenant of the request:

| Carries | What it is |
|---|---|
| `subject` | The name of the tool, as it was called |
| `userId`, `userKind` | The service account, and `'service'` |
| `outcome`, `reason` | `success`, or `failure` with `missing-permission` for a tool the caller does not see, `refused` for one that does not exist or arguments that are not of the model, `error` for a tool that failed |
| `approvalRequestId` | The approval request a write tool proposed |

## Configuring the plugin
The tokens of `ZIBRI_MCP_PLUGIN_DI_TOKENS`.

| Token | Type | What it is |
|---|---|---|
| `OPTIONS` | `McpPluginOptions` | The options the plugin was created with. Read, not provided |
| `MCP_SERVICE` | `McpServiceInterface` | Answers the messages of the clients. `McpService` by default |
| `RATE_LIMITER` | `RateLimiterInterface<TokenBucketState>` | Limits how often a service account calls the endpoint. `McpRateLimiter` by default |

## Requirements
Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `ApiKey` | The plugin is registered, for the keys of the service accounts |
| `ApprovalRequest`, `ApprovalDecision` | A write tool is registered |

## See also
- [API keys](../auth/api-keys.md) — service accounts and their keys
- [Approving actions](./approval-plugin.md) — the actions a write tool proposes, and approving them
- [Roles and permissions](../auth/roles-and-permissions.md) — the permissions of a tool
- [Rate limiting](../endpoints/rate-limiting.md) — the limiter of the endpoint
- [Audit trail](../data/audit.md) — reading the calls of the tools
