# Recovering work that stopped
Some work of an application stops on its own: a cron job whose ticks keep throwing, an event a hook
gave up on, a thread job, a mail, a backup or a restore that failed. Each of them leaves a record of
what went wrong, and each is started again in a way of its own. This page gathers them for whoever is
on call, and links to the page that explains each one.

## Putting a cron job back on the schedule
A job whose ticks threw as often in a row as its `onFailure.stopAfterFailures` allows is
`STOPPED_ON_ERROR`, and runs no more. Its row keeps `errorMessage`, the error of its last tick, and
`consecutiveFailures`.

Once the cause is fixed, `cronService.enable()` puts it back on the schedule on every instance:

```ts
// src/services/cron-recovery.service.ts
import { CronJobEntity, CronJobState, inject, Repository, repositoryTokenFor, ZIBRI_DI_TOKENS } from 'zibri';

export async function restartStoppedCronJobs(): Promise<string[]> {
    const cronJobs: Repository<CronJobEntity> = inject(repositoryTokenFor(CronJobEntity));
    const stopped: CronJobEntity[] = await cronJobs.findAll({ where: { state: CronJobState.STOPPED_ON_ERROR } });
    for (const job of stopped) {
        await inject(ZIBRI_DI_TOKENS.CRON_SERVICE).enable(job.name);
    }
    return stopped.map(job => job.name);
}
```

A stopped job also comes back at the next start of the application, and `restartAfterInMs` puts it
back after a while without anyone, see [when a tick throws](./cron.md#when-a-tick-throws).

## Running a failed event again
An event whose subscriber spent its last attempt is `FAILED`. Its runs keep what each subscriber
failed with, and the event is kept for `EVENT_FAILED_RETENTION_IN_MS`. Once the cause is fixed,
`replayFailed` gives the selected runs all of their attempts again:

```ts
// src/services/event-recovery.service.ts
import { inject, ZIBRI_DI_TOKENS } from 'zibri';

export async function replayFailedEvents(): Promise<number> {
    return await inject(ZIBRI_DI_TOKENS.EVENT_SERVICE).replayFailed({});
}
```

[When an event cannot be handled](./events.md#when-an-event-cannot-be-handled) shows how to find the
failed events, and [replaying failed runs](./events.md#replaying-failed-runs) how to select some of
them.

## Running a failed thread job again
A thread job whose worker threw, or that was started `maxAttempts` times without finishing, is
`FAILED` with its `error`. `requeueThreadJob` puts it back in the queue with its attempts starting
over:

```ts
// src/services/thread-job-recovery.service.ts
import { inject, ZIBRI_DI_TOKENS } from 'zibri';

export async function runJobAgain(jobId: string): Promise<void> {
    await inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE).requeueThreadJob(jobId);
}
```

A job that is `INTERRUPTED`, or `IN_PROGRESS` on an instance that is gone, needs nothing: another
instance takes it over, see [surviving a restart](./multithreading.md#surviving-a-restart).

## Sending a failed mail again
A mail whose recipient was refused, or whose send threw `maxSendAttempts` times, is `FAILED` and is
never tried again. Its row keeps the `error` and the `rejectedRecipients`, see
[what happens to the row](./email.md#what-happens-to-the-row). To send it, fix the address or the mail
server and [queue it](./email.md#queueing-an-email) again.

## Taking a backup again
A backup whose resource failed `BACKUP_MAX_ATTEMPTS` times is `FAILED`, and keeps the `error` of each
resource. What it stored is removed from the transports. Once the transport is reachable again, queue
a new backup, and `delete` the failed one once its record has served you, see
[creating and restoring backups](./backup.md#creating-and-restoring-backups).

A restore is refused when:

- a backup or another restore holds a resource it applies. It answers `409` naming the resource. Try
  again once that one is done.
- a resource of the backup is not marked complete. That backup never finished, so restore another
  one, see [what a restore checks first](./backup.md#what-a-restore-checks-first).
- the backup holds a migration of a newer release. Restore it with a build of that release or a newer
  one, see [a backup of another release](./backup.md#a-backup-of-another-release).

## Finishing a restore that could not be undone
When a resource of a restore fails to apply, the restore puts back every resource it already
touched. When one of them cannot be put back either, the error names the resource and the file its
snapshot is kept in, in `BACKUP_TEMP_FOLDER`.

Fix what kept it from being put back, such as a data source that cannot be reached, and start the
application again. Every start puts back the resources a restore left half applied, from their
snapshots, before anything else, and logs which ones. The snapshot files are on the disk of the
instance that ran the restore, so start that instance, or one with the same disk. See
[a restore of several resources](./backup.md#a-restore-of-several-resources).

## Work held by an instance that is gone
Work that only one instance may do at a time is held with a [lease](./glossary.md#lease). An instance
that was killed renews nothing, and another instance takes the work over once its lease lapses, by the
clock of the data source:

| Work | Taken over after |
|---|---|
| A run of a cron job | `CRON_EXECUTION_LEASE_IN_MS`, five minutes by default |
| A run of an event hook | `EVENT_EXECUTION_LEASE_IN_MS`, a minute by default |
| A thread job | `jobClaimInMs`, 30 seconds by default |
| A resource of a backup | A minute |
| Your own `withLease` | Its `leaseInMs` |

Nothing has to be done but wait. Work taken over runs again from the start, see
[renewing](./leases.md#renewing).

## See also
- [Cron](./cron.md) — scheduling jobs, and what happens when a tick throws
- [Events](./events.md) — retries, failed events and replaying them
- [Multithreading](./multithreading.md) — the thread job queue and its retries
- [Backup](./backup.md) — backups, restores and what a restore checks
- [Leases](./leases.md) — holding work on one instance
- [Logging](./logging.md) — where the errors above are written
