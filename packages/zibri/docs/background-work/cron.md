---
keywords: [schedule, scheduled jobs, timer, periodic, recurring, cron job]
---

# Cron
A cron job runs a piece of work on a schedule. The schedule is a cron expression, with an optional first field for seconds, and `CronExpression` builds one for you.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `CronJob` | class | Base class to extend when defining a cron job |
| `InitialCronConfig` | interface | Config shape (`name`, `cron`, `active`, `syncToDataSource`, ...) required by `CronJob.initialConfig` |
| `CronConfig` | type | The configuration of a job with every option of `InitialCronConfig` filled in |
| `CronFailurePolicy` | type | What a job does when its ticks throw, see [when a tick throws](#when-a-tick-throws) |
| `CronRetryOptions` | type | How a job runs a failed [slot](../glossary.md#slot) again |
| `CronBackOffOptions` | type | How a job that keeps failing skips slots |
| `RunsOn` | type | On how many instances a job runs each scheduled execution: `'oneInstance'` or `'everyInstance'`. An [event subscriber](./events.md#running-on-every-instance) takes it too |
| `CronExpression` | class | Builder for cron expression strings (such as `CronExpression.every(1, 'seconds').build()`) |
| `CronExpressionString` | type | A cron expression, as `CronExpression.build` and `CronExpression.fromString` return it |
| `CronUnit`, `DayOfWeek`, `MonthName` | type, type, type | What `CronExpression` counts in, from `'seconds'` to `'months'`, and the days and months `on` and `in` take |
| `CronServiceInterface` | interface | Schedules the jobs and changes them while the app runs: `schedule`, `enable`, `disable`, `changeCron`, `update` |
| `CronUpdateData` | type | What `update` changes about a job |
| `CronService` | class | Default implementation of `CronServiceInterface`. Replaceable through ZIBRI_DI_TOKENS.CRON_SERVICE |
| `RunExecution` | type | The election contract a cron service provides: runs an execution on the instance that holds its claim |
| `CronJobEntity` | entity | The stored state of a cron job |
| `CronJobState` | enum | `ACTIVE`, `INACTIVE` or `STOPPED_ON_ERROR`: whether a job is on the schedule, and why not, see [what a job is doing](#what-a-job-is-doing) |
| `CronSyncCronJob` | cron job | Applies what other instances changed about a job. Registered for you |
| `PollingCronJob` | class | Base class for a job that looks for work kept in a data source, see [polling for work](#polling-for-work) |
| `WakeUpServiceInterface` | interface | Tells the instances that something a poll looks for changed |
| `WakeUpListener` | type | Listens for the wake ups of one topic, returned by `WakeUpServiceInterface.listen` |
| `WakeUpService` | class | Default implementation of `WakeUpServiceInterface` |
| `ZIBRI_DI_TOKENS.WAKE_UP_SERVICE` | DI token | The wake up service |
| `ZIBRI_DI_TOKENS.CRON_EXECUTION_LEASE_IN_MS` | DI token | How long a claim is held. Defaults to five minutes |
| `ZIBRI_DI_TOKENS.CRON_REGISTRATION_LEASE_IN_MS` | DI token | How long one instance may take to register its jobs at boot. Defaults to thirty seconds |

## Defining a cron job
A job extends `CronJob`. This one logs its name every second, once it is active:

```ts
// src/cron/status.cron-job.ts
import { CronExpression, CronJob, InitialCronConfig, inject, Injectable, ZIBRI_DI_TOKENS } from 'zibri';

@Injectable()
export class StatusCronJob extends CronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'Status',
        cron: CronExpression.every(1, 'seconds').build(),
        active: false
    };

    async onTick(): Promise<void> {
        inject(ZIBRI_DI_TOKENS.LOGGER).info(`is running ${this.name}`);
    }
}
```

## Registering the cron job
Add the job class to `cronJobs` in `index.ts`, and it starts with the application:

```ts
// src/index.ts
import { SemVerUtilities, ZibriApplication } from 'zibri';

import { version } from '../package.json';
import { StatusCronJob } from './cron/status.cron-job';
import { providers } from './providers';
// ...

if (!SemVerUtilities.isSemVerVersion(version)) {
    throw new Error('The version of the package.json is not valid.');
}

const app: ZibriApplication = new ZibriApplication({
    name: 'Api',
    baseUrl: 'http://localhost:3000',
    plugins: [
        // ...
    ],
    controllers: [
        // ...
    ],
    websocketControllers: [
        // ...
    ],
    dataSources: [
        // ...
    ],
    cronJobs: [StatusCronJob],
    version,
    environment: 'development',
    defaultAuth: 'public',
    twoFactorAtLogin: 'never',
    providers
});
// ...
```

## Storing the configuration of a job

The job starts with its initial config. Here that means:
- its name is 'Status'
- it *would* run every second
- but is not active yet.

At its first start, the job is saved as a cron job entity in a data source. From then on you change its configuration through the cron service, for example to put it on the schedule or to change its cron expression.

The schedule and whether the job is on it can change in two places: in the class, and through the cron service while the app runs. The newer change wins. A start whose class declares a different `cron` or `active` than at the last start takes the value of the class and logs the change. Otherwise the row keeps what the cron service set, across every restart. The class wins for `runOnInit`, `timezone`, `catchUpWithinInMs` and `onFailure`: every start brings the row back in line with what the class declares, and `onFailure` is read from the class alone. Set `syncToDataSource: false` to keep the whole configuration in the class. The job then has no row to record `lastRun` and the last error.

### Changing a job while the app runs

`cronService.enable()`, `disable()` and `changeCron()` change a job on every instance. The row's `source` is `'code'` for a job declared as a class, and `cronService.update()` refuses such a job, since its class declares the rest.

Every instance reads the row before each run of a job. A job disabled, stopped or rescheduled on one instance is skipped from its next run on all of them, and runs only at the times of its new schedule. `CronSyncCronJob`, registered for you on every instance, reads the rows at its next tick once another instance changed one, and at least every 30 seconds otherwise. It puts enabled jobs back on the schedule and moves rescheduled ones. Use this to turn off a job that misbehaves without a deploy, also from its own `onError`. A job with `syncToDataSource: false` has no row, so the cron service changes it only on the instance it is called on.

A job runs outside every [tenant](../data/tenancy.md#work-outside-a-request), and every tenant shares it.

## What a job is doing

A job is in one of three states, readable as `job.state`:

| State | Meaning |
|---|---|
| `ACTIVE` | On the schedule |
| `INACTIVE` | Off the schedule because that is what was asked for, in `initialConfig` or through `cronService.disable()` |
| `STOPPED_ON_ERROR` | Off the schedule because its ticks threw as often in a row as its `onFailure.stopAfterFailures` allows |

`active: false` in `initialConfig` takes the job off the schedule, at its first start and at every start after you change `active`. Between two such changes the state is what the row records.

A job you turned off stays off until `cronService.enable()`. A job stopped on error returns to the state it had at the next start of the application. Its `errorMessage` stays, so what went wrong is still readable afterwards.

## Which clock a schedule is read on

A schedule is a cron expression and the time zone it is read in. `0 3 * * *` fires at 03:00 in that zone.

The zone defaults to UTC, whatever zone the machine is set to, so a job fires at the same moment on every machine.

Change it for the whole deployment through the localize options:

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT,
    useValue: { defaultTimezone: 'Europe/Berlin' }
})
```

Or per job, for example to run the same work on the schedule each of your tenants expects:

```ts
// src/cron/nightly-invoices.cron-job.ts
import { CronExpression, CronJob, InitialCronConfig, Injectable } from 'zibri';

@Injectable()
export class NightlyInvoicesCronJob extends CronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'Nightly invoices',
        cron: CronExpression.daily().at(3, 'hours').build(),
        timezone: 'America/New_York'
    };

    async onTick(): Promise<void> {}
}
```

`Timezone` is a union of the IANA zone names, so a typo is a compile error.

> [!NOTE]
> In a zone that changes its clocks, a schedule naming an hour follows the clock. On the day the clocks go forward, a time inside the skipped hour does not come, so a job at 02:30 in `Europe/Berlin` does not run that day. On the day they go back, it runs once. A schedule naming no hour, such as every ten seconds, runs through both days without a gap.

`CronExpression.every` counts within its unit's own range, the way cron does: `every(2, 'days')` runs on the 1st, 3rd, … of each month, so on the 31st and again on the 1st, and `every(5, 'hours')` runs at 0, 5, … 20 and again at 0.

## Running at startup

`runOnInit` is off by default. Turn it on and the job runs once when the app starts, in addition to its schedule.

For a job with `runsOn: 'oneInstance'`, one instance runs that startup run ahead of each upcoming slot. A deployment of ten pods runs it once. A pod that becomes ready later in the same rolling deploy finds it taken, even an hour later. The scheduled run of that slot still happens. A pod that starts after the slot has passed runs it again.

For a job with `runsOn: 'everyInstance'` it runs on every instance.

## Catching up a run that was missed

A slot that passes while no instance is running is skipped: a deployment down from 02:00 to 04:00 skips its 03:00 job, and the next run is tomorrow. Set `catchUpWithinInMs` on a job whose work is still worth doing later:

```ts
// src/cron/catching-up.cron-job.ts
import { CronExpression, CronJob, InitialCronConfig, Injectable, Ms } from 'zibri';

@Injectable()
export class CatchingUpCronJob extends CronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'Nightly invoices',
        cron: CronExpression.daily().at(3, 'hours').build(),
        catchUpWithinInMs: Ms.DAY
    };

    async onTick(): Promise<void> {}
}
```

The invoice run is still worth doing at 06:00 when the outage clears, up to a day after its slot.

On start, the job runs once for the most recent slot it missed. A week of downtime owes one invoice run, not seven. `catchUpWithinInMs` is also how far back it looks: an older slot stays missed.

The same limit covers a slot a running process reaches late, for example while a long synchronous computation blocks it. A slot no later than `catchUpWithinInMs` still runs, and of several such slots only the most recent one.

Left unset, a missed slot stays missed, and so does a slot reached more than a second late. The app logger warns about each slot left out this way. Leave it unset for work that only matters at its moment, such as collecting this minute's metrics.

A job that has never run catches up nothing, so a new environment does not fire every job on its first boot.

Across replicas, one instance runs the make-up run, and none does when an instance already ran that slot.

## When a tick throws

The error is logged and recorded on the job's row as `errorMessage`, and the next tick runs as usual. A failure that clears on its own, such as an SMTP server refusing connections for a minute or a database in a failover, costs you one execution.

`onFailure` says what else happens. Each part is off when you leave it out:

```ts
// src/cron/careful-invoices.cron-job.ts
import { CronExpression, CronJob, InitialCronConfig, Injectable, Ms } from 'zibri';

@Injectable()
export class CarefulInvoicesCronJob extends CronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'Careful invoices',
        cron: CronExpression.daily().at(3, 'hours').build(),
        onFailure: {
            retry: { attempts: 3, delayInMs: 30 * Ms.SECOND },
            backOff: { maxSkippedSlots: 15 },
            stopAfterFailures: 5,
            restartAfterInMs: Ms.HOUR
        }
    };

    async onTick(): Promise<void> {}
}
```

This job runs a failed slot again after 30, 60 and 120 seconds. While it keeps failing, it skips 1, then 3, then 7 slots, at most 15. After 5 failures in a row it is off the schedule, and an hour after its last run it is back on it.

| Option | What it does |
|---|---|
| `retry` | Runs a slot whose tick threw again, waiting `delayInMs` before the first attempt and twice as long before each one after it. No attempt starts once the next slot is due, and none after the app began shutting down. Only for work that is safe to run twice |
| `backOff` | After n failures in a row the job skips the next 2^n - 1 slots, at most `maxSkippedSlots` |
| `stopAfterFailures` | After this many failures in a row the job moves to `STOPPED_ON_ERROR`, and comes back at the next start, as above |
| `restartAfterInMs` | Puts a job `stopAfterFailures` stopped back on the schedule this long after its last run. Its failures are still counted, so a failure of its next tick stops it again |

Failures are counted in a row across every instance, as `consecutiveFailures` on the job's row, and a slot whose retries all failed counts once. A tick that succeeds sets the count back to 0 and ends a back off.

## Running more than one instance

One instance runs each scheduled execution of a job. This is on by default. Each execution is claimed through a [lease](../data/leases.md) on the job and its scheduled time. The instance that wins runs the job, and every other instance skips. A run starts up to `maxRandomDelayInMs` after its slot, at random, a second by default, so the jobs sharing a slot do not all start at once. Set it to `0` to start every run on its slot. An instance whose start was delayed into the next second still competes for the slot it was scheduled for.

The claim stays after the job finishes, so an instance arriving later does not run the same slot again.

The claim is renewed for as long as the job runs, so the lease puts no deadline on your code. `ZIBRI_DI_TOKENS.CRON_EXECUTION_LEASE_IN_MS`, five minutes by default, is how long an execution whose instance died mid-run waits before another instance takes it over, and how long a finished execution stays claimed. An instance that starts while a run is under way finds the slot held, and does not [catch it up](#catching-up-a-run-that-was-missed) beside the run.

```ts
// src/providers.ts
import { defineProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({ token: ZIBRI_DI_TOKENS.CRON_EXECUTION_LEASE_IN_MS, useFactory: () => Ms.MINUTE * 30 })
```

To elect through something else, such as a lock your infrastructure provides, replace the cron service and implement `runExecution`. It runs the execution it is handed on the instance that holds the claim, for as long as the run lasts.

### Jobs that must run everywhere

Some jobs act on state that belongs to one instance, which no other instance can see. Those set `runsOn: 'everyInstance'`:

```ts
// src/cron/clear-local-cache.cron-job.ts
import { CronExpression, CronJob, InitialCronConfig, Injectable } from 'zibri';

@Injectable()
export class ClearLocalCacheCronJob extends CronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'Clear local cache',
        cron: CronExpression.every(5, 'minutes').build(),
        runsOn: 'everyInstance'
    };

    async onTick(): Promise<void> {}
}
```

| `runsOn` | When the job touches |
|---|---|
| `'oneInstance'` | Shared state: a shared data source, a payment provider, an outbound mail queue. With `'everyInstance'`, three replicas do the work three times |
| `'everyInstance'` | State of the instance: this process's memory, this container's filesystem. With `'oneInstance'`, two of three replicas are never cleaned up |

The framework's own jobs follow the same rule. These run on every instance:

| Job | What it acts on |
|---|---|
| `CollectMetricsCronJob` | The instance's own registry and host |
| `FormDataBodyParserCleanupCronJob` | The container's temp folder |
| `BackupStagingCleanupCronJob` | The container's backup staging folder |
| `RateLimitingCleanupCronJob` | The default limiter store, in memory |
| `CacheExpiryCleanupCronJob` | The instance's local caches |
| `CacheInvalidationCronJob` | Work for its own instance |
| `EventDispatchCronJob` | Work for its own instance |
| `RunQueuedThreadJobsCronJob` | Work for its own instance |
| `CronSyncCronJob` | The jobs of its own instance |

All of them except `FormDataBodyParserCleanupCronJob`, `BackupStagingCleanupCronJob` and `CacheExpiryCleanupCronJob` also set `syncToDataSource: false`. Every job that cleans up rows in a data source runs on one instance.

### Runs that outlast their interval

`runsOn: 'oneInstance'` elects one instance per scheduled execution. The next slot is a separate claim, which another instance may win while this one is still working. A job whose `onTick` can outlast its interval overlaps itself, and the second run reads the same rows as the first, before the first updated them.

For such a job, claim each work item it processes, see [leases](../data/leases.md). `SendQueuedEmailsCronJob` claims each mail before it sends it, since a slow SMTP server can make a send outlast the interval.

## Polling for work

A job that looks for work kept in a data source, in rows any instance may add, extends `PollingCronJob`. Its schedule is how often it looks at most. Every look that finds nothing makes the next one later, up to every `ZIBRI_DI_TOKENS.POLL_MAX_INTERVAL_IN_MS`, 30 seconds by default, and a tick it skips costs nothing, not even the claim of its slot. Whoever adds work wakes it, and it looks again at its next tick.

```ts
// src/cron/send-invoices.cron-job.ts
import { BaseEntity, CronExpression, inject, InitialCronConfig, Injectable, Newable, PollingCronJob, Repository, repositoryTokenFor, ZIBRI_DI_TOKENS } from 'zibri';

import { Invoice, InvoiceStatus } from '../models';

@Injectable()
export class SendInvoicesCronJob extends PollingCronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'Send invoices',
        cron: CronExpression.every(5, 'seconds').build()
    };

    protected readonly wakeUpTopic: string = 'invoices';

    protected readonly polledEntity: Newable<BaseEntity> = Invoice;

    protected async poll(): Promise<boolean> {
        const invoices: Repository<Invoice> = inject(repositoryTokenFor(Invoice));
        const due: Invoice[] = await invoices.findAll({ where: { status: InvoiceStatus.DUE }, limit: 50 });
        // send them, each under a claim of its own
        return due.length > 0;
    }
}

// where an invoice falls due
export async function markDue(invoice: Invoice): Promise<void> {
    const invoices: Repository<Invoice> = inject(repositoryTokenFor(Invoice));
    await invoices.updateById(invoice.id, { status: InvoiceStatus.DUE });
    await inject(ZIBRI_DI_TOKENS.WAKE_UP_SERVICE).wake(invoices.dataSource, 'invoices');
}
```

`poll` returns whether it found anything, and a poll that did looks again at the next tick. A wake up travels through the data source `polledEntity` is kept in. It reaches every instance when that data source carries messages between them, as a `PostgresDataSource` and a `ValKeyDataSource` do. On one that carries none, the job looks at every tick of its schedule. `wakeAt` wakes the job of this instance at a time, for work that falls due later.

Work nobody announces, such as work an instance that stopped existing left unfinished, is found at the pace of an idle poll, within about `POLL_MAX_INTERVAL_IN_MS`.

## Configuration
Each cron job's `initialConfig` (`name`, `cron` schedule, `active`, `runOnInit`, `onFailure`, `runsOn`, `syncToDataSource`, `maxRandomDelayInMs`) is set on the job class itself, see [defining a cron job](#defining-a-cron-job).

Behavior across instances is configured through DI: `ZIBRI_DI_TOKENS.CRON_EXECUTION_LEASE_IN_MS` for how long a claim is held, `ZIBRI_DI_TOKENS.CRON_REGISTRATION_LEASE_IN_MS` for how long one instance may take to register its jobs at boot, or `ZIBRI_DI_TOKENS.CRON_SERVICE` to replace election entirely.

### Registering jobs when several instances boot together

Instances that boot together register their jobs one at a time, under a lease. The first one creates the rows, and the others find them. This also holds when the table is empty: on the first deploy, after a restore, and in every fresh environment.

Raise `CRON_REGISTRATION_LEASE_IN_MS` if one instance cannot register all of your jobs in thirty seconds. An instance that dies mid-registration blocks the others for at most the lease.

## Requirements
| Package | Used for |
|---|---|
| `node-cron` | Running each job at the times of its cron expression |

Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `CronJobEntity` | Every application |

How large each table grows, and what deletes its rows, is in [framework tables](../data/framework-tables.md).

## See also
- [Replication](../data/replication.md) — running more than one instance, and what else changes when you do
- [Leases](../data/leases.md) — claiming individual work items, for jobs that outlive their own interval
- [Data sources](../data/data-source.md) — cron jobs are persisted as entities in a data source
- [Application lifecycle](../application/application-lifecycle.md) — registering cron jobs on the `ZibriApplication`
- [Logging](../operations/logging.md) — the logger injected via `ZIBRI_DI_TOKENS.LOGGER`
- [Background work](./background-work.md) — choosing between cron jobs, events, thread jobs and the other tools
