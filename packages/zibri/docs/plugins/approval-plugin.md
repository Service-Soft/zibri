---
keywords: [approvals, approval requests, four eyes principle, maker checker, review, propose, human in the loop, ai assistant]
---

# Approving actions
`ZibriApprovalPlugin` lets an actor propose an action that a person approves before it runs, such as an AI assistant, a new employee or an integration closing a task. A proposal is stored as an approval request of a [tenant](../glossary.md#tenant), with a summary and the values it would change for the reviewer. Approving it runs the action once, as the approver, and records the decision in a [hash chain](../glossary.md#hash-chain) of the tenant. A user with an [API key](../glossary.md#api-key), the application itself or a plugin proposes, and a policy of the action can approve on its own, such as a suggestion above a confidence.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ZibriApprovalPlugin` | class | The plugin for approval requests |
| `ApprovalAction` | type | An action that can be proposed: its `name`, `input` model, `permission`, `proposePermission`, `describe` and `run`, see [declaring an action](#declaring-an-action) |
| `provideApprovalAction` | function | Registers an action, for the `providers` of your application or of a plugin |
| `ApprovalRequestController` | class | The routes of the approval requests, below the path of your controller extending it |
| `ApprovalRequestServiceInterface`, `ApprovalRequestService` | interface, class | Proposes, approves, rejects and finds requests. Replaceable through `ZIBRI_APPROVAL_PLUGIN_DI_TOKENS.APPROVAL_REQUEST_SERVICE` |
| `ZIBRI_APPROVAL_PLUGIN_DI_TOKENS` | DI token | The tokens of the plugin, see [configuring the plugin](#configuring-the-plugin) |
| `ZIBRI_APPROVAL_PERMISSIONS`, `ZibriApprovalPermissions` | constant, constant | The tenant permissions of the routes, to spread into yours, and the same by name |
| `ApprovalPolicy` | type | A rule that approves the requests of an action without a person: its `name` and `approves`, see [approving automatically](#approving-automatically) |
| `ApprovalActionDescription`, `ApprovalRowChange` | type, type | What `describe` answers: a `summary`, and the `rows` the action writes, each with its `entity`, the `stored` row and the `values` written |
| `ApprovalRunContext` | type | What `run` is handed besides the input: the `transaction` to write through, the `request` and who decided it |
| `ApprovalProposal` | type | What `propose` takes: the `action`, the `input`, a `reason` and the `system` proposing it |
| `ApprovalRequestFilter` | type | Which requests `findRequests` answers: by `status` and `action` |
| `ApprovalRequest`, `ApprovalRequestCreateData` | entity, type | A proposed action of a tenant: its `input`, `summary`, `changes`, `preconditions`, who proposed it, its `status` and `expiresAt`. Stored by `ZibriApprovalPlugin` |
| `ApprovalDecision`, `ApprovalDecisionCreateData` | entity, type | The decision on a request: who decided it, the `note`, and the `result` or `error` of its action. Chained by `ZibriApprovalPlugin` |
| `ApprovalRequestDetails` | class | What reading, proposing, approving and rejecting a request answer: the `request` and its `decision` |
| `ApprovalRequestChange`, `ApprovalValueChange` | class, class | A row a request would write, and a value it would change on it, against the value stored |
| `ApprovalPrecondition` | class | A row a request was proposed against, by a hash of what it held |
| `NewApprovalRequest`, `ApprovalDecisionInput` | class, class | What `POST /` and approving or rejecting take |
| `ApprovalRequestStatus` | enum | `PENDING`, `APPROVED`, `REJECTED`, `EXPIRED` or `FAILED` |
| `ApprovalDecisionType` | enum | `APPROVED` or `REJECTED` |
| `ApprovalActorKind` | enum | `USER`, `SYSTEM` or `POLICY`: what proposed or decided a request |
| `ApprovalRequestExpiryCronJob` | cron job | Closes the pending requests that expired as `EXPIRED`, every five minutes. Registered for you |
| `ApprovalEventNames`, `ApprovalRequestEventData` | type, type | Which changes of requests are emitted as events of yours, and what they carry, see [hearing of requests](#hearing-of-requests) |
| `ApprovalPluginOptionsInput`, `ApprovalPluginOptions` | type, type | `expiresInMs` and `eventNames`, via `ZIBRI_APPROVAL_PLUGIN_DI_TOKENS.OPTIONS_INPUT`. A request waits 7 days by default |
| `APPROVAL_ACTION_DI_VARIANT` | constant | The variant `provideApprovalAction` gives the provider of an action |

`zibri-contract` has the models of the routes for your frontend: `ApprovalRequestModel`, `ApprovalDecisionModel`, `ApprovalRequestDetailsModel`, `ApprovalRequestChangeModel`, `ApprovalValueChangeModel`, `ApprovalPreconditionModel`, `NewApprovalRequestModel`, `ApprovalDecisionInputModel`, the enums and the permissions.

## Setting it up
Add `new ZibriApprovalPlugin()` to the `plugins` of your application, see [registering a plugin](../application/plugin.md#registering-a-plugin), and `ApprovalRequest` and `ApprovalDecision` to the `entities` of one data source, beside what a [chained entity](../data/tamper-evident-tables.md#chaining-the-rows-of-each-tenant) needs. You import the names of the plugin from `zibri/plugin/approval`.

Extend `ApprovalRequestController` with a `@Controller` of your own, at the path you choose:

```ts
// src/controllers/approval-request.controller.ts
import { Controller } from 'zibri';
import { ApprovalRequestController } from 'zibri/plugin/approval';

@Controller('/approval-requests', { versions: 'all' })
export class AppApprovalRequestController extends ApprovalRequestController {}
```

Add it to your application:

```ts
// src/application-options.base.ts
import { OmitStrict, ZibriApplicationOptions } from 'zibri';
import { ZibriApprovalPlugin } from 'zibri/plugin/approval';

import { AppApprovalRequestController } from './controllers/approval-request.controller';

export const baseApplicationOptions: OmitStrict<ZibriApplicationOptions, 'dataSources'> = {
    name: 'Task Tracker',
    baseUrl: 'http://localhost:3000',
    version: '1.0.0',
    environment: 'development',
    plugins: [new ZibriApprovalPlugin()],
    controllers: [AppApprovalRequestController],
    websocketControllers: [],
    defaultAuth: 'public',
    twoFactorAtLogin: 'never'
};
```

Spread `ZIBRI_APPROVAL_PERMISSIONS` into your tenant permissions, beside those your actions name, see [declaring permissions](../auth/roles-and-permissions.md#declaring-permissions):

```ts
// src/models/permissions.ts
import { DefinedPermissions, definePermissions, ZIBRI_PERMISSIONS } from 'zibri';
import { ZIBRI_APPROVAL_PERMISSIONS } from 'zibri/plugin/approval';

const PERMISSIONS = [...ZIBRI_PERMISSIONS, ...ZIBRI_APPROVAL_PERMISSIONS, 'tasks.close', 'tasks.propose'] as const;

export const Permissions: DefinedPermissions<typeof PERMISSIONS> = definePermissions(PERMISSIONS);
```

| Permission | Lets a member |
|---|---|
| `approval-requests.read` | List and read the requests of the tenant |
| `approval-requests.decide` | Reach the routes approving and rejecting a request. Deciding one also takes the `permission` of its action |

## Declaring an action
An action names its input model, the permission it takes to approve it and the one it takes to propose it. `describe` says what it would do, and `run` does it:

```ts
// src/approvals/close-task.approval-action.ts
import { inject, Property, Repository, repositoryTokenFor } from 'zibri';
import { ApprovalAction } from 'zibri/plugin/approval';

import { Permissions, Task } from '../models';

export class CloseTaskInput {
    @Property.string({ format: 'uuid' })
    taskId!: string;
}

export const closeTaskAction: ApprovalAction<CloseTaskInput, Task> = {
    name: 'tasks.close',
    input: CloseTaskInput,
    permission: Permissions.TASKS_CLOSE,
    proposePermission: Permissions.TASKS_PROPOSE,
    async describe(input) {
        const taskRepository: Repository<Task> = inject(repositoryTokenFor(Task));
        const task: Task = await taskRepository.findById(input.taskId);
        return {
            summary: `Close the task "${task.title}"`,
            rows: [{ entity: Task, stored: task, values: { status: 'done' } }]
        };
    },
    async run(input, context) {
        const taskRepository: Repository<Task> = inject(repositoryTokenFor(Task));
        return await taskRepository.updateById(input.taskId, { status: 'done' }, { transaction: context.transaction });
    }
};
```

Register it with `provideApprovalAction`, in the `providers` of your application. A plugin registers its own actions in its `providers` the same way:

```ts
// src/providers.ts
import { DiProvider } from 'zibri';
import { provideApprovalAction } from 'zibri/plugin/approval';

import { closeTaskAction } from './approvals/close-task.approval-action';

export const approvalProviders: DiProvider<unknown>[] = [provideApprovalAction(closeTaskAction)];
```

The application does not start with two actions of one name.

`describe` runs when the action is proposed. The request stores its `summary`, and of each row it names the values `values` changes against the `stored` row: all of them for a row the action creates, with `stored` undefined, and every stored value for a row it deletes, with `values` null. These are the `changes` a reviewer reads:

```json
{
    "action": "tasks.close",
    "input": { "taskId": "0b6d6a7e-61a4-4c2f-9d0e-5f2b8c1e7a90" },
    "reason": "The release is out",
    "summary": "Close the task \"Write the release notes\"",
    "changes": [
        {
            "entity": "task",
            "id": "0b6d6a7e-61a4-4c2f-9d0e-5f2b8c1e7a90",
            "changes": [{ "key": "status", "previousValue": "open", "newValue": "done" }]
        }
    ],
    "preconditions": [{ "entity": "task", "id": "0b6d6a7e-61a4-4c2f-9d0e-5f2b8c1e7a90", "hash": "q2X4n7mW1sYc0bJt9pVhR5kLdEaFzU3oGiN8wTe6yMQ" }],
    "proposedBy": "3c1f7a52-8d4e-4b6a-9f20-1e7d5c4b3a21",
    "proposedByKind": "USER",
    "status": "PENDING",
    "expiresAt": "2026-12-01T09:30:00.000Z"
}
```

`run` runs once the request is approved, and what it answers is the `result` of the decision. It writes through `context.transaction`, in which the decision is recorded too: what it wrote is kept only when it succeeds.

> [!NOTE]
> `context.transaction` is a transaction of the data source holding `ApprovalRequest`. An action writes the rows of that data source through it, see [using transactions](../data/data-source.md#using-transactions).

| Option | What it is |
|---|---|
| `name` | The name the requests of the action are stored with. Required |
| `input` | The model of the input, which a proposal is validated against. Required |
| `permission` | The tenant permission it takes to approve or reject a request. Give several actions one permission to have one group of people decide them all. Required |
| `proposePermission` | The tenant permission it takes a user to propose the action. Required |
| `describe` | What the action would do with an input: a `summary` and the `rows` it writes. Required |
| `run` | Runs the action, once its request is approved. Required |
| `require2fa` | Whether approving takes a [second factor](../glossary.md#second-factor) of the approver, see [approving and rejecting](#approving-and-rejecting). False by default |
| `expiresInMs` | How long a request waits for a decision. The `expiresInMs` of the plugin, 7 days by default |
| `policies` | The policies that approve a request without a person, see [approving automatically](#approving-automatically). None by default |

## Proposing an action
`POST /` proposes an action as the logged in user, who needs its `proposePermission`. The input is validated against the model of the action:

```bash
curl https://api.example.com/approval-requests \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'content-type: application/json' \
    -d '{ "action": "tasks.close", "input": { "taskId": "0b6d6a7e-61a4-4c2f-9d0e-5f2b8c1e7a90" }, "reason": "The release is out" }'
```

It answers the request and its `decision`, which is null until it is decided. Nothing the action writes is written until then.

`propose` of the approval request service proposes from your own code. Inside a request, the logged in user proposes. Name the `system` to propose as the application or a plugin, which needs no user and no permission:

```ts
// src/services/task-cleanup.function.ts
import { inject } from 'zibri';
import { ApprovalRequestDetails, ZIBRI_APPROVAL_PLUGIN_DI_TOKENS } from 'zibri/plugin/approval';

export async function proposeClosingStaleTask(taskId: string): Promise<ApprovalRequestDetails> {
    return await inject(ZIBRI_APPROVAL_PLUGIN_DI_TOKENS.APPROVAL_REQUEST_SERVICE).propose({
        action: 'tasks.close',
        input: { taskId },
        reason: 'Nobody changed the task for 30 days',
        system: 'task-cleanup'
    });
}
```

The request records the user's id in `proposedBy` with `proposedByKind` `USER`, a user of an API key such as a service account included, or the name of the system with `SYSTEM`. A request belongs to the active tenant, so propose outside a request in the tenant of the rows, see [work outside a request](../data/tenancy.md#work-outside-a-request).

## Approving and rejecting
`POST /:id/approve` and `POST /:id/reject` take an optional `note`:

```bash
curl https://api.example.com/approval-requests/9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d/approve \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'content-type: application/json' \
    -d '{ "note": "Looks right" }'
```

Deciding takes `approval-requests.decide` and the `permission` of the action. Approving then:

1. Refuses the user who proposed the request with a `403`, whatever their permissions.
2. Takes a second factor of the approver, where the action sets `require2fa`. A request without one is answered as a route guarded by `@Auth.require2fa()` answers it, see [two factor](../auth/two-factor.md#what-a-second-factor-is-for).
3. Calls `describe` again, and refuses the request with a `409` when a row it was proposed against changed since, or is gone.
4. Runs the action once, as the approver, and records the decision with its `result`.

Two approvals of one request at the same moment run its action once. The second is refused with a `409`, as a request that is decided already:

| A decision is refused with | When |
|---|---|
| `403` | The user lacks a permission it takes, or approves a request they proposed |
| `401` | The action requires a second factor the approval does not carry |
| `409` | The request is not `PENDING`, has expired, or a row it was proposed against changed, which the message names: `The row 0b6d6a7e-61a4-4c2f-9d0e-5f2b8c1e7a90 of task changed since the approval request was proposed. Propose the action again.` |

An action that throws leaves the request `FAILED`, and nothing it wrote is kept. The decision holds the message of an error answering the request below `500`, such as a `ConflictError` of the action, and `The action failed.` for any other error, which is logged:

```json
{
    "request": { "id": "9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d", "status": "FAILED" },
    "decision": {
        "requestId": "9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d",
        "decision": "APPROVED",
        "decidedBy": "7d2e9f10-5a4b-4c3d-9e8f-1a2b3c4d5e6f",
        "decidedByKind": "USER",
        "note": "Looks right",
        "result": null,
        "error": "The task is locked by its project."
    }
}
```

Rejecting records the note, and the action does not run. `approve` and `reject` of the service decide as the logged in user of the request they are called in.

## Approving automatically
A policy approves the requests of its action without a person, such as a suggestion the system is sure of. It is asked once a request is proposed, with the input, the request and what `describe` answered:

```ts
// src/approvals/suggest-label.approval-action.ts
import { inject, Property, Repository, repositoryTokenFor } from 'zibri';
import { ApprovalAction } from 'zibri/plugin/approval';

import { Permissions, Task } from '../models';

export class SuggestLabelInput {
    @Property.string({ format: 'uuid' })
    taskId!: string;

    @Property.string()
    label!: string;

    @Property.number()
    confidence!: number;
}

export const suggestLabelAction: ApprovalAction<SuggestLabelInput> = {
    name: 'tasks.label',
    input: SuggestLabelInput,
    permission: Permissions.TASKS_CLOSE,
    proposePermission: Permissions.TASKS_PROPOSE,
    policies: [{ name: 'confidence-at-least-0.95', approves: input => input.confidence >= 0.95 }],
    async describe(input) {
        const taskRepository: Repository<Task> = inject(repositoryTokenFor(Task));
        const task: Task = await taskRepository.findById(input.taskId);
        return {
            summary: `Label the task "${task.title}" as ${input.label}`,
            rows: [{ entity: Task, stored: task, values: { labels: [...task.labels ?? [], input.label] } }]
        };
    },
    async run(input, context) {
        const taskRepository: Repository<Task> = inject(repositoryTokenFor(Task));
        const task: Task = await taskRepository.findById(input.taskId, { transaction: context.transaction });
        await taskRepository.updateById(task.id, { labels: [...task.labels ?? [], input.label] }, { transaction: context.transaction });
    }
};
```

The first policy that approves decides the request: the action runs, outside the request it was proposed in, and the decision names the policy in `decidedBy`, with `decidedByKind` `POLICY`. `propose` answers the request decided. A request no policy approves waits for a person.

The bank plugin works this way: it proposes the matches of transactions with invoices it suggests as requests of its action `'bank.match'`, as the system, and a policy approves those of at least the confidence you configure, see [matching transactions with invoices](./bank-plugin.md#matching-transactions-with-invoices).

## Expiring requests
A request waits `expiresInMs` of its action for a decision, 7 days by default. An expired request is refused with a `409` and closed as `EXPIRED`. `ApprovalRequestExpiryCronJob` closes the pending requests of every tenant that expired, every five minutes, so that listing the `PENDING` requests leaves them out.

## Hearing of requests
A request proposed and a request decided can be emitted as [events](../background-work/events.md) of yours, such as to tell the approvers. Declare a type for each in your event map:

```ts
// src/events/approval-events.ts
import { ApprovalRequestEventData } from 'zibri/plugin/approval';

declare module 'zibri' {
    interface ZibriEventMap {
        'approval-request.created': ApprovalRequestEventData,
        'approval-request.decided': ApprovalRequestEventData
    }
}

export {};
```

and name them in the `eventNames` of the options:

```ts
// src/providers.ts
import { defineProvider } from 'zibri';
import { ZIBRI_APPROVAL_PLUGIN_DI_TOKENS } from 'zibri/plugin/approval';

defineProvider({
    token: ZIBRI_APPROVAL_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
    useValue: { eventNames: { requestCreated: 'approval-request.created', requestDecided: 'approval-request.decided' } }
})
```

| Name | Emitted when |
|---|---|
| `requestCreated` | A request is proposed, before a policy decides it |
| `requestDecided` | A request is approved, by a user or a policy, or rejected |

Each carries the `requestId`, the `action` and the `status` the request has then, and belongs to the tenant of the request. None is emitted until you name it.

## Checking the decisions
The decisions of each tenant form a hash chain, which tells a decision that was changed or removed past your application apart from those written. `resolveChainVerification` of the chain service checks it, see [checking a chain](../data/tamper-evident-tables.md#checking-a-chain):

```ts
// src/services/approval-check.function.ts
import { ChainVerification, inject, ZIBRI_DI_TOKENS } from 'zibri';
import { ApprovalDecision } from 'zibri/plugin/approval';

export async function checkApprovalDecisions(tenantId: string): Promise<ChainVerification> {
    return await inject(ZIBRI_DI_TOKENS.CHAIN_SERVICE).resolveChainVerification(ApprovalDecision, tenantId);
}
```

## Listing requests
| Route | What | Permission |
|---|---|---|
| `POST /` | Proposes an action: its `action`, `input` and `reason` | Logged in, and the `proposePermission` of the action |
| `GET /` | A page of the requests, the latest proposed first. Takes `page`, `limit`, `status` and `action` | `approval-requests.read` |
| `GET /:id` | A request and its decision | `approval-requests.read` |
| `POST /:id/approve` | Approves a request, see [approving and rejecting](#approving-and-rejecting) | `approval-requests.decide` and the `permission` of the action |
| `POST /:id/reject` | Rejects a request | `approval-requests.decide` and the `permission` of the action |

Every route answers the requests of the tenant of the request alone. A page holds at most 100 requests.

## Configuring the plugin
The tokens of `ZIBRI_APPROVAL_PLUGIN_DI_TOKENS`.

| Token | Type | What it is |
|---|---|---|
| `OPTIONS_INPUT` | `ApprovalPluginOptionsInput` | `expiresInMs`, how long a request of an action that names none waits for a decision, 7 days by default. `eventNames`, which changes of requests are emitted, see [hearing of requests](#hearing-of-requests). None by default |
| `OPTIONS` | `ApprovalPluginOptions` | `OPTIONS_INPUT` as it is in effect. Read, not provided |
| `APPROVAL_REQUEST_SERVICE` | `ApprovalRequestServiceInterface` | Proposes, decides and finds requests. `ApprovalRequestService` by default |

## Requirements
Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `ApprovalRequest`, `ApprovalDecision` | The plugin is registered. Both in one data source |
| `ChainAnchor` | The plugin is registered, for the chained decisions |

How large each table grows, and what deletes its rows, is in [framework tables](../data/framework-tables.md).

## See also
- [Tamper-evident tables](../data/tamper-evident-tables.md) — the chain the decisions form, and checking it
- [Roles and permissions](../auth/roles-and-permissions.md) — giving the permissions to propose and decide
- [Two factor](../auth/two-factor.md) — the second factor an approval can take
- [API keys](../auth/api-keys.md) — keys and service accounts that propose actions
- [Serving AI assistants over MCP](./mcp-plugin.md) — tools an assistant proposes actions through
- [Plugins](../application/plugin.md) — registering a plugin, and writing your own