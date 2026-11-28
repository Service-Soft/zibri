---
keywords: [kanban, board, boards, tasks, task tracker, project management, to do, columns, labels, comments, assignees, deck, customer portal, guests, live board]
---

# Managing projects and tasks
`ZibriProjectsPlugin` keeps the projects of a [tenant](../glossary.md#tenant), each with a board of columns, tasks and labels, and the comments on the tasks. Projects nest to any depth, such as `Internal > Marketing > SEO blog`, and a project that only groups others leaves its board empty. Every change of a task is recorded as a [change set](../glossary.md#change-set) with the user who made it. A project is shared with selected people, such as the customer it is for, who see that project and the projects below it and nothing else of the tenant. The changes of a board reach its open pages over the websocket.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ZibriProjectsPlugin` | class | The plugin for projects and their boards |
| `ProjectsController` | class | The routes of the projects, boards, tasks, comments and shares, below the path of your controller extending it |
| `ProjectBoardWebsocketController` | class | The websocket events subscribing to the changes of a board, below the prefix of your websocket controller extending it, see [updating a board live](#updating-a-board-live) |
| `ZIBRI_PROJECTS_PLUGIN_DI_TOKENS` | DI token | The tokens of the plugin, see [setting it up](#setting-it-up) |
| `ProjectsPluginOptionsInput`, `ProjectsPluginOptions` | type, type | `guestRoles`, `findUsers`, `invitationExpiresInMs` and `calendarSync`, which are required, `invitationColumns` and `eventNames`, via `ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.OPTIONS_INPUT` |
| `ZIBRI_PROJECTS_PERMISSIONS`, `ZibriProjectsPermissions` | constant, constant | The tenant permissions of the plugin, to spread into yours, and the same by name |
| `ZIBRI_PROJECTS_PLATFORM_PERMISSIONS`, `ZibriProjectsPlatformPermissions` | constant, constant | The platform variants of the permissions, to spread into your platform permissions, and the same by name |
| `ProjectsAccess` | class | `READ`, `WRITE` and `MANAGE`, each permission with its platform variant, as `@Auth.hasAnyLevelPermission` takes them |
| `Project` | entity | A project of a tenant: its `name`, `description`, `parentId`, `archivedAt` and its working calendar. Shared with selected people. Stored by `ZibriProjectsPlugin` |
| `ProjectColumn` | entity | A column of the board of a project: its `name`, `position` and whether its tasks are done, `isDone`. Stored by `ZibriProjectsPlugin` |
| `Task` | entity | A task of a project: its column, `title`, `description`, `position`, the day it is due on, `dueOn`, `assigneeIds`, `labelIds`, `doneAt`, `parentTaskId` and `recurringTaskId`, with its change sets. Stored by `ZibriProjectsPlugin` |
| `TaskLabel` | entity | A label of a project its tasks carry: its `name` and the `color` token it is shown in. Stored by `ZibriProjectsPlugin` |
| `TaskComment` | entity | A comment on a task: its `authorId`, `text`, `createdAt` and `editedAt`. Stored by `ZibriProjectsPlugin` |
| `ProjectServiceInterface`, `ProjectService` | interface, class | Finds, creates, changes, archives and deletes projects, resolves a board, writes columns and labels, and shares projects. Replaceable through `ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.PROJECT_SERVICE` |
| `TaskServiceInterface`, `TaskService` | interface, class | Finds, creates, changes, moves and deletes tasks, and writes the comments on them. Replaceable through `ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.TASK_SERVICE` |
| `ProjectAccessServiceInterface`, `ProjectAccessService` | interface, class | Answers the role of the caller on a project, who sees a project, and how other users are shown to the caller. Replaceable through `ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.PROJECT_ACCESS_SERVICE` |
| `ProjectBoardUpdateServiceInterface`, `ProjectBoardUpdateService` | interface, class | Subscribes websocket connections to boards, and sends them the changes. Replaceable through `ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.PROJECT_BOARD_UPDATE_SERVICE` |
| `ProjectAccess` | type | What `resolveAccess` answers: the `project`, the caller's `role` on it and whether they have `fullAccess` |
| `PROJECT_ROLES`, `ProjectRole`, `PROJECT_ROLE_VALUES` | constant, type, constant | `viewer`, `commenter` and `editor`, the roles a project is shared in, from the least to the most, and the same as the `enum` of a property |
| `ZIBRI_PROJECTS_LIMITS` | constant | The longest names, titles, descriptions and comments, the most assignees and labels of a task, and the shape of a label color |
| `NewProject`, `ProjectChange`, `ProjectFilter` | class, class, type | What `POST /` and `PATCH /:projectId` take, and which projects `findProjects` answers |
| `NewProjectColumn`, `ProjectColumnChange`, `ProjectColumnMove` | class, class, class | What adding, changing and moving a column take |
| `NewTask`, `TaskChange`, `TaskMove`, `TaskFilter` | class, class, class, type | What creating, changing and moving a task take, and which tasks `findTasks` answers |
| `NewTaskLabel`, `TaskLabelChange` | class, class | What adding and changing a label take |
| `NewTaskComment`, `TaskCommentPage` | class, class | What writing a comment takes, and a page of the comments on a task with their authors |
| `ProjectBoard` | class | What `GET /:projectId/board` answers: the `project`, its `columns`, `labels` and `tasks`, the `users` the tasks are assigned to, and the `access` of the caller |
| `ProjectCallerAccess`, `ProjectWithAccess` | class, class | What the caller may do on a project, their `role` and whether they have `fullAccess`, and what `GET /:projectId` answers: the project with its `access`, see [showing what a caller may do](#showing-what-a-caller-may-do) |
| `ProjectUser` | class | A user as the routes show them: their `id`, `name`, and `email` for a caller who sees every project |
| `ProjectShare`, `NewProjectShare`, `ProjectShareRole`, `ProjectShareResult` | class, class, class, class | A share of a project with its user, what sharing by email takes, what sharing with a member takes, and what sharing by email did |
| `ProjectInvitee` | type | Who `invitationColumns` of the options is handed: the `email` and the `name` of the person invited |
| `ProjectEventNames`, `TaskEventData` | type, type | Which changes of tasks are emitted as events of yours, and what they carry, see [hearing of changes of tasks](#hearing-of-changes-of-tasks) |
| `ProjectBoardSubscription`, `ProjectBoardMessage`, `PROJECT_BOARD_WEBSOCKET_EVENT` | class, type, constant | What subscribing to a board takes, a change of a board as a subscriber receives it, and the event it arrives as |
| `ProjectBoardMessageProject`, `ProjectBoardMessageTask`, `ProjectBoardMessageColumn`, `ProjectBoardMessageLabel`, `ProjectBoardMessageComment` | type, type, type, type, type | A project, a task, a column, a label and a comment as a `ProjectBoardMessage` carries them, without their relations |
| `ProjectPositionUtilities`, `PositionedRow`, `PositionPlacement`, `TaskPlacementOptions` | class, type, type, type | Places a task among the tasks of its column, or a column among the columns of its board, see [ordering the tasks of a column](#ordering-the-tasks-of-a-column) |
| `RecurringTask` | entity | A task that recurs: the template of its occurrences, its `recurrence`, `startsOn`, `timezone`, `leadTimeInDays`, `nonWorkingDay` and `pausedAt`. Stored by `ZibriProjectsPlugin` |
| `RecurringTaskOccurrence` | entity | An occurrence of a recurring task created: the day of the recurrence it is for and its task, once per day. Stored by `ZibriProjectsPlugin` |
| `TaskRecurrence`, `RECURRENCE_UNITS`, `RecurrenceUnit`, `RECURRENCE_UNIT_VALUES` | class, constant, type, constant | When a recurring task is due, see [repeating a task](#repeating-a-task), and its units |
| `NewRecurringTask`, `RecurringTaskChange` | class, class | What creating and changing a recurring task take |
| `RecurringTaskServiceInterface`, `RecurringTaskService` | interface, class | Writes the recurring tasks of a project, and creates the occurrences that are due with `createDueOccurrences`. Replaceable through `ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.RECURRING_TASK_SERVICE` |
| `RecurringTaskCronJob` | cron job | Creates the occurrences that are due, once a day, and once on a start after a missed run. Registered for you |
| `RecurrenceUtilities` | class | Resolves the days of a recurrence, moves a day off a day that is not a working day, resolves the day of a moment in a time zone, and validates a day |
| `WorkingCalendar`, `WorkingCalendarChange`, `ProjectCalendar` | class, class, class | The working calendar that applies to a project, a change of one, and what a project or the tenant sets beside what applies, see [keeping due dates to working days](#keeping-due-dates-to-working-days) |
| `NON_WORKING_DAY_RULES`, `NonWorkingDayRule`, `NON_WORKING_DAY_RULE_VALUES` | constant, type, constant | `keep`, `previous` and `next`: what happens to a due date on a day that is not a working day |
| `ProjectCalendarDefaults` | entity | The working calendar of a tenant, which its projects take what they leave unset from. Stored by `ZibriProjectsPlugin` |
| `WorkingCalendarServiceInterface`, `WorkingCalendarService` | interface, class | Resolves the calendar of a project, and reads and writes the calendars of projects and of the tenant. Replaceable through `ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.WORKING_CALENDAR_SERVICE` |
| `HolidayCalendarInterface`, `EmptyHolidayCalendar` | interface, class | Finds the holidays of a calendar your application knows, and the one that knows none. Replaceable through `ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.HOLIDAY_CALENDAR` |
| `ProjectsCalendarSyncOptions` | type | The `taskUrl` an event links back to, as `calendarSync` of the options, see [writing due dates into a calendar](#writing-due-dates-into-a-calendar) |
| `ProjectCalendarSync`, `ProjectCalendarSyncTarget` | class, class | Which calendar a project or the tenant writes the due dates of its tasks into, `{ target: null }` for none, and the calendar: the `connectionId` of a `TenantWebDavConnection` and the `calendarPath` |
| `TaskCalendarSyncServiceInterface`, `TaskCalendarSyncService` | interface, class | Queues requests to sync the calendars, runs those that are due, and syncs one task with `syncTask`. Replaceable through `ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.TASK_CALENDAR_SYNC_SERVICE` |
| `ProjectCalendarUsageFinder` | class | Keeps a WebDAV connection the working calendar of a project or of the tenant names from being deleted. Registered for you as `ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.CALENDAR_USAGE_FINDER` |
| `TaskCalendarSyncRequest` | entity | A change of a task, or of the calendar of a project or of the tenant, not written into the calendar yet. Stored by `ZibriProjectsPlugin` with `calendarSync` |
| `TaskCalendarSyncRequestData`, `TaskCalendarSyncScope`, `TASK_CALENDAR_SYNC_SCOPE_VALUES` | type, type, constant | A request as it is queued, and what it is about: a `task`, a `project` with the projects below it, or the `tenant` |
| `TaskCalendarSyncCronJob` | cron job | Writes the changes into the calendars, every five seconds and as they are queued, and again after a failed attempt. Registered for you with `calendarSync` |
| `TaskCalendarSyncWriteObserver` | class | Queues a request in the transaction of every write that changes an event of a task. Registered for you with `calendarSync` |

`zibri-contract` has the models of the routes for your frontend: `ProjectModel`, `NewProjectModel`, `ProjectChangeModel`, `ProjectQueryModel` for the query of `GET /`, `ProjectColumnModel`, `NewProjectColumnModel`, `ProjectColumnChangeModel`, `ProjectColumnMoveModel`, `TaskModel`, `NewTaskModel`, `TaskChangeModel`, `TaskMoveModel`, `TaskQueryModel` for the query of `GET /tasks`, `TaskLabelModel`, `NewTaskLabelModel`, `TaskLabelChangeModel`, `TaskCommentModel`, `NewTaskCommentModel`, `TaskCommentPageModel`, `ProjectUserModel`, `ProjectBoardModel`, `ProjectCallerAccessModel`, `ProjectWithAccessModel`, `ProjectShareModel`, `NewProjectShareModel`, `ProjectShareRoleModel`, `ProjectShareResultModel`, `ProjectBoardSubscriptionModel`, `ProjectBoardMessageModel` with a model for each kind of change, `TaskRecurrenceModel`, `RecurringTaskModel`, `NewRecurringTaskModel`, `RecurringTaskChangeModel`, `WorkingCalendarModel`, `WorkingCalendarChangeModel`, `ProjectCalendarModel`, `ProjectCalendarSyncModel`, `ProjectCalendarSyncTargetModel`, the roles, the units, the rules of non-working days, the limits, the event and the permissions.

## Setting it up
Add `new ZibriProjectsPlugin()` to the `plugins` of your application, see [registering a plugin](../application/plugin.md#registering-a-plugin), and `Project`, `ProjectColumn`, `Task`, `TaskLabel` and `TaskComment` to the `entities` of the data source of your users, beside `RowShare`, see [sharing rows with selected people](../data/sharing.md). You import the names of the plugin from `zibri/plugin/projects`.

Extend `ProjectsController` with a `@Controller` of your own, at the path you choose:

```ts
// src/controllers/projects.controller.ts
import { Controller } from 'zibri';
import { ProjectsController } from 'zibri/plugin/projects';

@Controller('/projects', { versions: 'all' })
export class AppProjectsController extends ProjectsController {}
```

Add it to your application:

```ts
// src/application-options.base.ts
import { OmitStrict, ZibriApplicationOptions } from 'zibri';
import { ZibriProjectsPlugin } from 'zibri/plugin/projects';

import { AppProjectsController } from './controllers/projects.controller';

export const baseApplicationOptions: OmitStrict<ZibriApplicationOptions, 'dataSources'> = {
    name: 'Task Tracker',
    baseUrl: 'http://localhost:3000',
    version: '1.0.0',
    environment: 'development',
    plugins: [new ZibriProjectsPlugin()],
    controllers: [AppProjectsController],
    websocketControllers: [],
    defaultAuth: 'public',
    twoFactorAtLogin: 'never'
};
```

Provide the options. The guest roles, how a user is named and how long an invitation lasts have no default:

```ts
// src/providers.ts
import { defineProvider, inject, Ms, Repository, repositoryTokenFor } from 'zibri';
import { ZIBRI_PROJECTS_PLUGIN_DI_TOKENS } from 'zibri/plugin/projects';

import { MemberRoles, User } from './models';

defineProvider({
    token: ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
    useValue: {
        guestRoles: [MemberRoles.GUEST],
        findUsers: async (userIds: string[]) => {
            const users: User[] = await inject<Repository<User>>(repositoryTokenFor(User)).findAll({ where: { id: { oneOf: userIds } }, limit: 'all' });
            return users.map(user => ({ id: user.id, name: user.email, email: user.email }));
        },
        invitationExpiresInMs: Ms.DAY * 14,
        calendarSync: undefined,
        invitationColumns: invitee => ({ name: invitee.name })
    }
})
```

| Option | What it is |
|---|---|
| `guestRoles` | The tenant roles somebody invited by [sharing a project by email](#sharing-a-project) becomes a member with, such as a role `guest` without `projects.read`. Required |
| `findUsers` | Finds users by their ids, each with the name your application shows for them and their email address. A user it leaves out is shown by their id. Required |
| `invitationExpiresInMs` | How long an invitation sent by sharing a project lasts, or `undefined` for one that lasts until it is answered or revoked. Required |
| `calendarSync` | How the due dates of tasks are written into calendars, see [writing due dates into a calendar](#writing-due-dates-into-a-calendar), or `undefined` for into none. Required |
| `invitationColumns` | The columns of your own of the invitation entity, such as its `name`, from the email and the name of the person invited. None by default |
| `eventNames` | Which changes of tasks are emitted as events, see [hearing of changes of tasks](#hearing-of-changes-of-tasks). None by default |

Spread `ZIBRI_PROJECTS_PERMISSIONS` into your tenant permissions, and `ZIBRI_PROJECTS_PLATFORM_PERMISSIONS` into your platform permissions, see [declaring permissions](../auth/roles-and-permissions.md#declaring-permissions):

```ts
// src/models/permissions.ts
import { DefinedPermissions, definePermissions, ZIBRI_PERMISSIONS } from 'zibri';
import { ZIBRI_PROJECTS_PERMISSIONS } from 'zibri/plugin/projects';

const PERMISSIONS = [...ZIBRI_PERMISSIONS, ...ZIBRI_PROJECTS_PERMISSIONS] as const;

export const Permissions: DefinedPermissions<typeof PERMISSIONS> = definePermissions(PERMISSIONS);
```

| Permission | Lets a member |
|---|---|
| `projects.read` | See every project of the tenant, read their boards and comments |
| `projects.write` | Create and change projects, and write their boards: the columns, labels, tasks and comments |
| `projects.manage` | Archive, bring back and delete projects, and share them |

Each has a platform variant, `projects.read_all`, `projects.write_all` and `projects.manage_all`, which reaches the projects of every tenant in a request naming the tenant. A member without `projects.read`, such as one with the guest role, sees only the projects shared with them.

## Nesting projects
`POST /` creates a project at the top, or below another with its `parentId`:

```bash
curl https://api.example.com/projects \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'content-type: application/json' \
    -d '{ "name": "SEO blog", "parentId": "9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d" }'
```

`PATCH /:projectId` moves a project below another, or to the top with `parentId: null`. A parent that is the project itself or a project below it is refused with a `400`. `GET /` lists a page of the projects the caller sees, by name, and takes `parentId` for the projects directly below one and `search` for those whose name contains a text.

## Working on a board
A board is the columns of a project, in their order, and the tasks in each:

| Route | What it does |
|---|---|
| `GET /:projectId/board` | The project, its columns, labels and tasks, the users the tasks are assigned to, and what the caller may do on it, see [showing what a caller may do](#showing-what-a-caller-may-do) |
| `POST /:projectId/columns` | Adds a column, after the one `afterColumnId` names, first with `null`, or last |
| `PATCH /columns/:columnId`, `POST /columns/:columnId/move` | Renames a column or changes whether its tasks are done, and moves it |
| `DELETE /columns/:columnId` | Deletes a column that holds no task. One that holds tasks is refused with a `409` |
| `POST /:projectId/tasks` | Creates a task in a column of the project, after the task `afterTaskId` names, first with `null`, or last |
| `GET /tasks/:taskId` | A task with its change sets, oldest first, each with the user who made it |
| `PATCH /tasks/:taskId` | Changes the title, description, due date, assignees, labels or the task it is a part of |
| `POST /tasks/:taskId/move` | Moves a task into a column of its project and to its place there, `{ "columnId", "afterTaskId" }` |
| `DELETE /tasks/:taskId` | Deletes a task with its comments. The tasks that are a part of it are a part of nothing from then on |
| `POST /:projectId/labels`, `PATCH /labels/:labelId`, `DELETE /labels/:labelId` | Adds, changes and deletes a label. A deleted label is taken off the tasks carrying it |

A task moved into a column whose tasks are done gets its `doneAt`, and one moved out of it loses it. A column that becomes one of done tasks marks its tasks done the same way. A task is a part of another task of its project with `parentTaskId`, and never of itself or a task that is a part of it.

The due date of a task is a day, `dueOn`, such as `"2027-07-31"`, the same day in every time zone. A date with a time is refused with a `400`. A task answers it as its midnight UTC, `"2027-07-31T00:00:00.000Z"`, whose first ten characters are the day. A task is overdue once its day has passed, and a day passes at a different moment in each time zone: compare it with the current day of whoever looks at the task, in their own time zone.

A description and a comment are markdown, stored as the text they are written as and never as html, up to the lengths of `ZIBRI_PROJECTS_LIMITS`. Your frontend renders them and sanitizes what it renders. The color of a label is the name of a color token of your frontend, such as `red-500`.

## Ordering the tasks of a column
The tasks of a column are ordered by their `position`, a number. Moving a task gives it a number between those of its new neighbours, so a move writes the task alone and the tasks around it keep theirs. Moves into one column are made one after the other on every instance, through a [lease](../glossary.md#lease) of the column, so two at the same moment never give two tasks one position. The columns of a board are ordered the same way.

A gap between two numbers halves with each task put into it, and after about 50 tasks put between the same two it holds no number. The task then goes in, and every task of the column is given a position again, a step apart, in the order they had.

## Finding tasks
`GET /tasks` lists a page of the tasks of the projects the caller sees, the soonest due first. It takes `projectId`, `assigneeId`, and `search` for the tasks whose title or description contains a text:

```bash
curl 'https://api.example.com/projects/tasks?page=1&limit=20&search=invoice' \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f'
```

The tasks of archived projects are left out unless `includeArchived=true` asks for them.

## Commenting on a task
`POST /tasks/:taskId/comments` writes a comment as the caller, `{ "text" }`. `GET /tasks/:taskId/comments` answers a page of the comments, the oldest first, with their authors in `users`. `PATCH /comments/:commentId` changes the text of a comment of the caller's own and sets its `editedAt`. `DELETE /comments/:commentId` deletes one of the caller's own, or any comment for an editor.

## Who may do what
A caller does on a project what their role on it allows:

| Role | Reads the project, its board and comments | Comments | Writes the tasks, columns and labels |
|---|---|---|---|
| `viewer` | Yes | No | No |
| `commenter` | Yes | Yes | No |
| `editor` | Yes | Yes | Yes |

A member with `projects.read` is a viewer of every project, and with `projects.write` beside it an editor. A member a project is shared with holds the role of the share, on that project and on the projects below it. A share of a project below gives a higher role there, never a lower one. A route refuses a lower role with a `403`, and answers a project the caller does not see with a `404`, like one that does not exist.

Creating and changing a project take `projects.write`, and archiving, deleting and sharing it `projects.manage`, which a guest never holds.

`resolveAccess` of the project access service answers the role of the caller of a request on a project, for a route of your own:

```ts
// src/services/project-access.function.ts
import { inject } from 'zibri';
import { ProjectAccess, ProjectAccessServiceInterface, ZIBRI_PROJECTS_PLUGIN_DI_TOKENS } from 'zibri/plugin/projects';

export async function validateMayEdit(projectId: string): Promise<void> {
    const accessService: ProjectAccessServiceInterface = inject(ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.PROJECT_ACCESS_SERVICE);
    const access: ProjectAccess = await accessService.resolveAccess(projectId);
    accessService.validateRole(access, 'editor');
    accessService.validateNotArchived(access.project);
}
```

## Showing what a caller may do
`GET /:projectId/board` and `GET /:projectId` answer the `access` of the caller beside the project, a `ProjectCallerAccess`, so a frontend shows the controls their role allows:

```json
{ "role": "commenter", "fullAccess": false }
```

`role` is their role on the project, as [who may do what](#who-may-do-what) gives it. `fullAccess` is true for a caller who sees every project of the tenant through `projects.read` or `projects.read_all`, and false for somebody who sees the projects shared with them. A member with `projects.read` and a guest a project is shared with as a viewer are both a `viewer`, told apart by `fullAccess`. An archived project is refused every write, whatever the role. The `access` is the one of the moment the board was read: a share that changes later is answered with the next read.

## Assigning a task
A task is assigned to users who see its project: the members of the tenant with `projects.read`, and the people it or a project above it is shared with. `assigneeIds` naming anybody else is refused with a `400` that names them. `GET /:projectId/users` answers the users who see a project, to pick an assignee from.

## Showing other people
Every user a route answers, such as an assignee, the author of a comment or the user of a share, is a `ProjectUser`: their id and the name `findUsers` gives them. A caller who sees every project of the tenant gets their email address as well. Anybody else, such as a guest, gets the id and the name alone, which is the `SharedUserModel` of `zibri-contract`.

## Archiving a project
`POST /:projectId/archive` archives a project and the projects below it, at the same moment. An archived project is left out of `GET /` and its tasks out of `GET /tasks`, unless `includeArchived=true` asks for them. Its board and comments stay readable, and every write to it, its board or its comments is refused with a `409`.

`DELETE /:projectId/archive` brings a project back, with the projects below it that were archived along with it. A project below that was archived on its own before stays archived. A project below an archived one is brought back with that one, and refused on its own with a `409`.

`DELETE /:projectId` deletes a project with the projects below it, their boards, comments and shares.

## Sharing a project
A project is shared with a member of the tenant, or by email with anybody, behind `projects.manage`:

| Route | What it does |
|---|---|
| `GET /:projectId/shares` | The shares of the project itself, each with its user |
| `PUT /:projectId/shares/:userId` | Shares the project with a member of the tenant in a role, `{ "role" }`, or changes the role |
| `POST /:projectId/shares` | Shares the project by email, `{ "email", "name", "role", "withoutPassword" }` |
| `DELETE /:projectId/shares/:userId` | Ends the share. The user sees nothing of the project from their next request on, unless a project above it is shared with them |

Sharing by email shares the project at once with the member the email belongs to. Any other email gets an [invitation](../auth/invitations.md) into the tenant with the `guestRoles` of the options, and accepting it creates the account, the [membership](../glossary.md#membership) and the share. With `withoutPassword: true` the guest logs in with a link sent by email, see [accepting without a password](../auth/invitations.md#accepting-without-a-password):

```bash
curl https://api.example.com/projects/9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d/shares \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'content-type: application/json' \
    -d '{ "email": "grace@example.com", "name": "Grace", "role": "commenter", "withoutPassword": true }'
```

It answers the `share`, or the `invitationId` of the invitation sent. The caller needs to be allowed to hand out the guest roles, such as with `auth.assign_role.with_own_permissions` for a guest role without permissions, see [inviting somebody](../auth/invitations.md#inviting-somebody). Ending the last share of a guest keeps their account and membership, and they see no project.

## Hearing of changes of tasks
Declare an event type for each change you want to hear of, with a `TaskEventData`, see [declaring what your application emits](../background-work/events.md#declaring-what-your-application-emits):

```ts
// src/events/project-events.ts
import { TaskEventData } from 'zibri/plugin/projects';

declare module 'zibri' {
    interface ZibriEventMap {
        taskDue: TaskEventData,
        taskDone: TaskEventData
    }
}

export {};
```

and name them in `eventNames` of the options:

```ts
// src/providers.ts
import { defineProvider, Ms } from 'zibri';
import { ZIBRI_PROJECTS_PLUGIN_DI_TOKENS } from 'zibri/plugin/projects';

import { MemberRoles } from './models';

defineProvider({
    token: ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
    useValue: {
        guestRoles: [MemberRoles.GUEST],
        findUsers: async (userIds: string[]) => await Promise.resolve(userIds.map(id => ({ id, name: id, email: `${id}@example.com` }))),
        invitationExpiresInMs: Ms.DAY * 14,
        calendarSync: undefined,
        eventNames: { taskDueDateChanged: 'taskDue', taskDone: 'taskDone' }
    }
})
```

| Name | Emitted when |
|---|---|
| `taskCreated` | A task is created |
| `taskMoved` | A task is moved into another column |
| `taskDueDateChanged` | The due date of a task is set, changed or removed, also when it is created with one |
| `taskDone` | A task is done: moved into a column of done tasks, created in one, or in a column that becomes one |

A `TaskEventData` carries the `taskId`, `projectId` and `columnId`. A hook reads the task for anything else, as it is when the hook runs. An event of a task belongs to its tenant.

## Updating a board live
Extend `ProjectBoardWebsocketController` with a `@WebsocketController` of your own, and add it to the `websocketControllers` of your application, beside the [websocket options](../endpoints/websocket.md#configuring-websockets):

```ts
// src/controllers/project-board.websocket-controller.ts
import { WebsocketController } from 'zibri';
import { ProjectBoardWebsocketController } from 'zibri/plugin/projects';

@WebsocketController({ eventPrefix: 'projects:' })
export class AppProjectBoardWebsocketController extends ProjectBoardWebsocketController {}
```

A logged in connection subscribes to the board of a project it sees with `projects:subscribe`, `{ "projectId" }`, naming the tenant in `x-tenant-id` of the headers of the message. A project it does not see is answered `404`. `projects:unsubscribe` ends the subscription. Every change of the board reaches it as a `PROJECT_BOARD_WEBSOCKET_EVENT`, `zi.projects.board`, whose `data` is a `ProjectBoardMessage`, told apart by its `type`:

```ts
// src/board.ts, in the browser
import { io } from 'socket.io-client';
import type { ProjectBoardMessage } from 'zibri/plugin/projects';

const columnOfTask: Map<string, string> = new Map();

const socket = io('https://api.example.com', { auth: callback => callback({ offset: 0 }) });
socket.on('zi.projects.board', (message: { seq: number, data: ProjectBoardMessage }) => {
    const change: ProjectBoardMessage = message.data;
    if (change.type === 'task-moved') {
        columnOfTask.set(change.task.id, change.task.columnId);
    }
});
socket.emit('projects:subscribe', {
    headers: { 'x-tenant-id': '6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' },
    body: { projectId: '9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d' }
});
```

| `type` | Carries |
|---|---|
| `project-updated` | The `project`, renamed, moved, archived or brought back |
| `project-deleted` | The `projectId` of the project deleted |
| `task-created`, `task-updated`, `task-moved` | The `task`, without its change sets |
| `task-deleted` | The `taskId` |
| `column-created`, `column-updated` | The `column` |
| `column-deleted` | The `columnId` |
| `label-created`, `label-updated` | The `label` |
| `label-deleted` | The `labelId` |
| `comment-created`, `comment-updated` | The `comment` |
| `comment-deleted` | The `taskId` and the `commentId` |

`ProjectBoardMessageModel` of `zibri-contract` is the same as it arrives as json, with its dates as strings, for a frontend that does not import `zibri`.

Subscribe before you read the board with `GET /:projectId/board`, so no change falls between the two. The changes are stored like every websocket message, so a client that [reconnects](../endpoints/websocket.md#reconnecting) with its `offset` is sent the changes it missed.

A change reaches a subscriber for as long as their user sees the project. Whether they do is asked as each change is sent, so a share that ended, a membership that ended or a project moved below one they do not see ends the subscription with the next change, on every instance. Nothing of it is replayed to them, and a reconnect puts them back into nothing.

## Repeating a task
A recurring task is a template a task is created from each time it is due, such as a yearly filing due on July 31. It is created as a task in the first column of its project whose tasks are not done, `leadTimeInDays` before its due date, 14 by default:

```bash
curl https://api.example.com/projects/9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d/recurring-tasks \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'content-type: application/json' \
    -d '{ "title": "File the annual return", "recurrence": { "every": 1, "unit": "year", "month": 7, "dayOfMonth": 31 }, "startsOn": "2027-01-01", "timezone": "Europe/Berlin", "leadTimeInDays": 30 }'
```

| Route | What it does |
|---|---|
| `GET /:projectId/recurring-tasks` | The recurring tasks of a project, by title |
| `POST /:projectId/recurring-tasks` | Creates a recurring task, as an editor of a project that is not archived |
| `GET /recurring-tasks/:recurringTaskId` | A recurring task |
| `PATCH /recurring-tasks/:recurringTaskId` | Changes it, pauses it with `paused: true` and brings it back with `paused: false` |
| `DELETE /recurring-tasks/:recurringTaskId` | Deletes it. The tasks created for it stay, with a `recurringTaskId` of null |

A `recurrence` counts its periods from `startsOn`, a day such as `2027-01-01`, which is the first day it may fall on:

| Option | What it is |
|---|---|
| `every` | How many units lie between two periods, such as 3 for every quarter with `month`. Required |
| `unit` | `day`, `week`, `month` or `year`. Required |
| `weekdays` | With `week`: the weekdays of each week, 0 for Sunday to 6 for Saturday. A week starts on a Monday. The weekday of `startsOn` by default |
| `dayOfMonth` | With `month` and `year`: the day of the month, 1 to 31, or -1 for the last day. A month without the day takes its last day, so the 31st falls on April 30 and the 29th of February on the 28th in a year that is no leap year. The day of `startsOn` by default |
| `month` | With `year`: the month, 1 for January to 12. The month of `startsOn` by default |
| `until` | The last day an occurrence may fall on. None by default |
| `count` | The most occurrences, counted from `startsOn`. None by default |

Each occurrence is due on its day, as its `dueOn`. `timezone` says which day it is, which decides when an occurrence is created. It is created once, as a copy of the template: its title, description, the labels of the project that are still there and the assignees who still see the project, with `recurringTaskId` naming the recurring task. It has its own history and comments, and is created even while the one before it is open, which then shows as overdue. Its creation is a `taskCreated` event, see [hearing of changes of tasks](#hearing-of-changes-of-tasks).

`RecurringTaskCronJob` creates what is due once a day, and once on a start after it missed a run. An occurrence is created up to 31 days after its due date, so a run after a downtime catches up what it missed. One is never created for a day before the recurring task was created, its recurrence, `startsOn` or `timezone` changed, or it was brought back from a pause. A paused recurring task, and one of an archived project, create nothing. Two runs at the same moment, on one instance or several, create each occurrence once. `createDueOccurrences` of the recurring task service runs the same in your own code, for a moment you name, in the active tenant.

A board without a column whose tasks are not done gets no occurrence, and the run logs a warning and tries again the next day.

The recurrence is a part of RFC 5545, which a calendar such as CalDAV reads, as an `RRULE` with `DTSTART` on `startsOn`:

| Recurrence | `RRULE` |
|---|---|
| `unit` and `every` | `FREQ=DAILY`, `WEEKLY`, `MONTHLY` or `YEARLY`, `INTERVAL=every`, with `WKST=MO` |
| `weekdays` | `BYDAY`, `SU` for 0 to `SA` for 6 |
| `dayOfMonth` 1 to 28, or -1 | `BYMONTHDAY` with the same number |
| `dayOfMonth` 29 to 31 | `BYMONTHDAY=28,29,30,31` up to the day, with `BYSETPOS=-1`, which takes the last of those the month has |
| `month` | `BYMONTH` |
| `until`, `count` | `UNTIL`, `COUNT` |

A due date moved off a day that is not a working day has no `RRULE`, and is written as the dates of the occurrences.

## Keeping due dates to working days
A due date on a day that is not a working day is kept, moved to the previous working day, or moved to the next. A working day is a working weekday of the calendar of the project that is no holiday of its holiday calendar. The `nonWorkingDay` of a recurring task decides for it, and the calendar of its project when it names none.

| Route | What it does |
|---|---|
| `GET /:projectId/calendar` | What a project sets, `own`, and what applies to it, `effective` |
| `PATCH /:projectId/calendar` | Sets `workingWeekdays`, `holidayCalendarId` and `nonWorkingDay` of a project, and the calendar its due dates are written into, `calendarSync`, see [writing due dates into a calendar](#writing-due-dates-into-a-calendar), behind `projects.manage`. A null takes the value from above again |
| `GET /calendar`, `PATCH /calendar` | The same for the tenant, read with `projects.read` and changed with `projects.manage` |

A project takes each value it leaves unset from the nearest project above it that sets it, and else from the tenant, so a customer's project sets the holidays of the customer's country once for every project below it. Without either, a calendar is Monday to Friday without holidays, and keeps a due date where it falls.

Holidays are your application's. Provide a `HolidayCalendarInterface` that answers the holidays of a calendar it knows within a range of days, and `undefined` for one it does not know:

```ts
// src/providers.ts
import { defineProvider } from 'zibri';
import { HolidayCalendarInterface, ZIBRI_PROJECTS_PLUGIN_DI_TOKENS } from 'zibri/plugin/projects';

const holidays: Record<string, string[]> = { 'de-by': ['2027-01-01', '2027-01-06', '2027-12-25', '2027-12-26'] };

const holidayCalendar: HolidayCalendarInterface = {
    findHolidays: async (calendarId: string, from: Date, until: Date) => {
        const days: Date[] | undefined = holidays[calendarId]?.map(day => new Date(`${day}T00:00:00.000Z`));
        return await Promise.resolve(days?.filter(day => day >= from && day <= until));
    }
};

defineProvider({ token: ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.HOLIDAY_CALENDAR, useValue: holidayCalendar })
```

A day is a `Date` at its midnight UTC. A calendar naming a holiday calendar your application does not know is refused with a `400`.

## Writing due dates into a calendar
The due date of a task can be written into a calendar of the tenant, such as one of its Nextcloud, as an event that links back to the task, see [calendar sync](../endpoints/calendar-sync.md). A task with a due date that is not done has an event, in the calendar of its project. Setting the due date creates it, changing the task updates it, and moving the task into a column of done tasks, removing its due date or deleting it removes the event. It syncs one way: an event somebody changes in the calendar is replaced the next time its task changes.

Turn it on with `calendarSync` of the options, with the url of the page of a task in your frontend:

```ts
// src/providers.ts
import { defineProvider, Ms } from 'zibri';
import { Task, ZIBRI_PROJECTS_PLUGIN_DI_TOKENS } from 'zibri/plugin/projects';

import { MemberRoles } from './models';

defineProvider({
    token: ZIBRI_PROJECTS_PLUGIN_DI_TOKENS.OPTIONS_INPUT,
    useValue: {
        guestRoles: [MemberRoles.GUEST],
        findUsers: async (userIds: string[]) => await Promise.resolve(userIds.map(id => ({ id, name: id, email: `${id}@example.com` }))),
        invitationExpiresInMs: Ms.DAY * 14,
        calendarSync: {
            taskUrl: (task: Task) => `https://app.example.com/projects/${task.projectId}/tasks/${task.id}` // your own frontend
        }
    }
})
```

and declare `TenantWebDavConnection`, `CalendarEntryLink` and `TaskCalendarSyncRequest` beside the other entities of the plugin. A tenant reaches its calendars through a `TenantWebDavConnection`, which it adds through the routes of a `TenantWebDavConnectionController`, see [letting tenants manage their connections](../endpoints/web-dav.md#letting-tenants-manage-their-connections). For Nextcloud, its url is `https://cloud.example.com/remote.php/dav/`.

`calendarSync` of the [working calendar](#keeping-due-dates-to-working-days) of a project or of the tenant names the calendar, by the `connectionId` of the connection and the `calendarPath` below its url, behind `projects.manage`:

```bash
curl -X PATCH https://api.example.com/projects/9a0b1c2d-3e4f-4a5b-8c6d-7e8f9a0b1c2d/calendar \
    -H 'x-tenant-id: 6f1c2d3e-4b5a-4c6d-8e7f-9a0b1c2d3e4f' \
    -H 'content-type: application/json' \
    -d '{ "calendarSync": { "target": { "connectionId": "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e", "calendarPath": "calendars/ada/website" } } }'
```

| `calendarSync` | The due dates of its tasks are written into |
|---|---|
| `{ "target": { "connectionId": …, "calendarPath": … } }` | That calendar |
| `{ "target": null }` | No calendar, whatever the projects above set |
| `null` | The calendar of the nearest project above that sets one, else that of the tenant, else none |

`effective.calendarSync` of `GET /:projectId/calendar` is the calendar that applies, or `null` for none. A connection the tenant does not have, or a path with an empty segment, a `.` or a `..`, is refused with a `400`, and so is any calendar while `calendarSync` of the options is `undefined`.

A project whose calendar changes, or which is moved below another, moves the events of its tasks into the calendar that applies now, with those of the projects below it that take their calendar from it. Each task is written into the new calendar first, then removed from the old one.

An event lasts the whole day the task is due on, and a calendar app shows it on that day in the time zone of whoever reads it. Its title is the title of the task, and its description the description of the task with the link at its end.

Every change is queued as a `TaskCalendarSyncRequest` in the transaction of the write of the task, the project or the calendar, however a repository gets to it: a recurring task creating its occurrence is synced like a task created through the routes, and a write rolled back syncs nothing. `TaskCalendarSyncCronJob` writes the changes, at once and on whichever instance picks them up. An attempt that fails, such as while the server of the calendar is down, is tried again after a minute, then after two, four and on, 14 times in all over some six days. A request that spent its attempts is kept with the error it failed with, and the next change of the same task writes the event again.

A connection the calendar of a project or of the tenant names is not deleted: the deletion is refused with a `409` naming the projects. Choose another calendar for them first. Deleting a connection no calendar names removes the links to the events written through it, and leaves the events in the calendar.

> [!NOTE]
> A connection a repository deleted, past the routes, keeps the links to the events written through it. They are dropped as their tasks change.

## Requirements
Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `Project`, `ProjectColumn`, `Task`, `TaskLabel`, `TaskComment` | `ZibriProjectsPlugin` is registered |
| `RecurringTask`, `RecurringTaskOccurrence`, `ProjectCalendarDefaults` | `ZibriProjectsPlugin` is registered |
| `TenantWebDavConnection`, `CalendarEntryLink`, `TaskCalendarSyncRequest` | `calendarSync` of the options is set |
| `RowShare` | `ZibriProjectsPlugin` is registered, as `Project` is shareable |
| `Lease` | `ZibriProjectsPlugin` is registered, which places the tasks of a column one after the other |
| `ChangeSet`, `Change` | `ZibriProjectsPlugin` is registered, which records the changes of each task |
| `WebsocketChannel`, `WebsocketMessage`, `WebsocketMessageSequence` | A websocket controller extends `ProjectBoardWebsocketController` |

Declare the entities of the plugin in the data source of `RowShare` and of your users: a project is deleted with its board and shares in one transaction, and `TaskCalendarSyncRequest` is written in the transaction of the change of a task.

How large each table grows, and what deletes its rows, is in [framework tables](../data/framework-tables.md).

## See also
- [Sharing rows with selected people](../data/sharing.md) — the shares a project is shown to a guest through
- [Inviting people](../auth/invitations.md) — the invitation sharing by email sends
- [Logging in with a link](../auth/login-links.md) — how a guest without a password logs in
- [Websocket](../endpoints/websocket.md) — connecting, reconnecting and the options of the websocket
- [Events](../background-work/events.md) — subscribing to the changes of tasks
- [Cron](../background-work/cron.md) — when `RecurringTaskCronJob` runs, and catching up a missed run
- [Calendar sync](../endpoints/calendar-sync.md) — the events the due dates of tasks are written as
- [WebDAV](../endpoints/web-dav.md) — the connections of tenants the calendars are reached through
- [Recording who changed what](../data/data-source.md#recording-who-changed-what) — the change sets of a task
