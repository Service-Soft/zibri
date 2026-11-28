---
keywords: [caldav, icalendar, ical, ics, rfc 5545, vevent, events, nextcloud calendar, deadlines, due dates]
---

# Calendar sync
CalDAV is the protocol Nextcloud and most other calendar servers share their calendars with, on top of [WebDAV](./web-dav.md). The calendar sync service writes entries of your application, such as the due dates of tasks, into such a calendar as events, each with a link back to your application. It syncs one way: your application writes, and an event somebody changes in the calendar is replaced by the next sync. A row can be in several calendars at once.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `CalendarSyncServiceInterface`, `CalendarSyncService` | interface, class | Writes an entry into a calendar with `syncEntry`, removes it with `removeEntry`, and finds the calendars a row is in with `findLinks`. Replaceable through `ZIBRI_DI_TOKENS.CALENDAR_SYNC_SERVICE` |
| `ZIBRI_DI_TOKENS.CALENDAR_SYNC_SERVICE` | DI token | Injects `CalendarSyncServiceInterface` |
| `CalendarEntry` | type | What is written as an event: its `source`, `summary`, `description`, `url`, `start` and whether it is `allDay` |
| `CalendarEntrySource` | type | The row an entry is synced from: its `type`, such as `task`, and its `id` |
| `CalendarSyncTarget` | type | The calendar: a `connection`, such as a `TenantWebDavConnection`, and the `calendarPath` below its url |
| `CalendarEntryLink` | entity | Where the event of a row is in one calendar: its `href` and the `etag` written last, one per row and calendar |
| `ICalendarUtilities` | class | Writes an iCalendar file of one event with `writeEvent`, and escapes and folds its lines with `escapeText` and `foldLine` |
| `ICalendarEvent` | type | An event as `writeEvent` takes it: its `uid`, `stampedAt`, `summary`, `description`, `url`, `start` and `allDay` |

## Writing an entry into a calendar
Declare `CalendarEntryLink` in your data source. `syncEntry` writes the event of an entry into a calendar the first time and replaces it after, and links the row to it. `removeEntry` removes it:

```ts
// src/services/task-calendar.service.ts
import { CalendarEntryLink, CalendarSyncServiceInterface, CalendarSyncTarget, inject, Repository, repositoryTokenFor, TenantWebDavConnection, ZIBRI_DI_TOKENS } from 'zibri';

import { Task } from '../models';

export async function syncDueDate(task: Task, connectionId: string): Promise<CalendarEntryLink | undefined> {
    const connections: Repository<TenantWebDavConnection> = inject(repositoryTokenFor(TenantWebDavConnection));
    const target: CalendarSyncTarget = {
        connection: await connections.findById(connectionId),
        calendarPath: 'calendars/team/deadlines' // the calendar of your own
    };
    const calendarSync: CalendarSyncServiceInterface = inject(ZIBRI_DI_TOKENS.CALENDAR_SYNC_SERVICE);
    if (task.dueAt == undefined) {
        await calendarSync.removeEntry({ type: 'task', id: task.id }, target);
        return undefined;
    }
    return await calendarSync.syncEntry({
        source: { type: 'task', id: task.id },
        summary: task.title,
        description: undefined,
        url: `https://app.example.com/tasks/${task.id}`,
        start: task.dueAt,
        allDay: false
    }, target);
}
```

Call the service in the [tenant](../glossary.md#tenant) the row belongs to, in which its links are stored. The event of a row is named `<type>-<id>`, the same in every calendar, and stored as `<calendarPath>/<type>-<id>.ics`. The `url` is written as the url of the event and at the end of its description, which calendar apps show as a link. An entry at a moment is written in UTC and takes no time, and an entry of a whole day ends on the next day. Every event is transparent, so it leaves the free and busy times of the calendar as they are.

The connection of a target is checked as [the server of a tenant](./web-dav.md#connecting-to-the-server-of-a-tenant) is: by `ZIBRI_DI_TOKENS.WEB_DAV_TENANT_CONNECTION_OPTIONS`, at public addresses over https by default. Its `id` names the calendar in the links, with the `calendarPath`.

## Choosing the calendar
A calendar is a folder of the server. On Nextcloud, the calendars of a user are below `/remote.php/dav/calendars/<user>/`: a connection to `https://cloud.example.com/remote.php/dav/` reaches the calendar `projects` of Ada as `calendars/ada/projects`. Every user has the calendar `personal`, and creates others in the calendar app, where the link of a calendar ends in its name. The user of the connection may write a calendar that is shared with them for editing.

A calendar that does not exist fails `syncEntry` with a `WebDavConflictError`.

## Overwriting what the calendar changed
Your application is what the calendar follows. `syncEntry` writes an event under `If-None-Match: *` while the row has no link to that calendar, and under `If-Match` of the ETag of its link after. An event somebody changed in the calendar, or deleted, or one there from an earlier write whose link was never stored, fails that condition, and is replaced or created again. `removeEntry` removes the event whatever it holds, and its link also when somebody deleted the event already.

A sync is one or two requests and a write of the link. A server that is down fails it with the `HttpClientError` of the HTTP client, and the link stays as it was. Retry it from [background work](../background-work/background-work.md#choosing-a-tool), such as a row of your own a polling cron job picks up, so that a change is not lost while the server is down. The [projects plugin](../plugins/projects-plugin.md#writing-due-dates-into-a-calendar) does this for the due dates of tasks.

## Writing an iCalendar file
`ICalendarUtilities.writeEvent` writes a calendar of one event as RFC 5545 describes it: text escaped, lines folded at 75 octets without splitting a character, lines ended by CRLF, times in UTC. Such a file opens in any calendar app:

```ts
// src/services/task-download.service.ts
import { ICalendarUtilities } from 'zibri';

import { Task } from '../models';

export function writeDeadline(task: Task, dueOn: Date): string {
    return ICalendarUtilities.writeEvent({
        uid: `task-${task.id}`,
        stampedAt: new Date(),
        summary: task.title,
        description: undefined,
        url: `https://app.example.com/tasks/${task.id}`,
        start: dueOn,
        allDay: true
    });
}
```

An event of a whole day is on the day of `start` in UTC, such as a `Date` at its midnight UTC. A `url` that is no absolute url throws an `InternalError`.

## Requirements
Your data source declares this entity:

| Entity | Needed when |
|---|---|
| `CalendarEntryLink` | The calendar sync service is called |

## See also
- [WebDAV](./web-dav.md) — the client the events are written with, and the connections of tenants
- [Managing projects and tasks](../plugins/projects-plugin.md#writing-due-dates-into-a-calendar) — the due dates of tasks written into the calendar of their project
- [Background work](../background-work/background-work.md) — retrying a sync while the server is down
