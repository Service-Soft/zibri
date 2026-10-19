# Cron
Cron jobs in Zibri use the node-cron package and its cron syntax under the hood.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `CronJob` | class | Base class to extend when defining a cron job |
| `InitialCronConfig` | interface | Config shape (`name`, `cron`, `active`, `syncToDataSource`, ...) required by `CronJob.initialConfig` |
| `CronFailurePolicy` | type | What a job does when its ticks throw, see [when a tick throws](#when-a-tick-throws) |
| `CronRetryOptions` | type | How a job runs a failed slot again |
| `CronBackOffOptions` | type | How a job that keeps failing skips slots |
| `CronExpression` | class | Builder for cron expression strings (eg. `CronExpression.every(1, 'seconds').build()`) |
| `ShouldRunExecution` | type | The election contract a cron service provides |
| `CronJobEntity` | entity | The stored state of a cron job |
| `CronSyncCronJob` | cron job | Applies what other instances changed about a job. Registered for you |
| `ZIBRI_DI_TOKENS.CRON_EXECUTION_LEASE_IN_MS` | DI token | How long a claim is held. Defaults to five minutes |
| `ZIBRI_DI_TOKENS.CRON_REGISTRATION_LEASE_IN_MS` | DI token | How long one instance may take to register its jobs at boot. Defaults to thirty seconds |

## Usage
### Defining a cron job
To define a job it needs to extend the `CronJob` class. Below is a simple example that just logs to the console each second:

```ts
// src/cron/status.cron-job.ts
import { CronExpression, CronJob, defineProvider, inject, Injectable, Ms, ZIBRI_DI_TOKENS, InitialCronConfig, ZibriApplication } from 'zibri';

import { version } from '../package.json';
import { providers } from '../providers';

@Injectable()
export class StatusCronJob extends CronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'Status',
        cron: CronExpression.every(1, 'seconds').build(),
        active: false
    };

    async onTick(): Promise<void> {
        await inject(ZIBRI_DI_TOKENS.LOGGER).info(`is running ${this.name}`);
    }
}
```

### Registering the cron job
For Zibri to be actual able to pickup the cron job and start it automatically you need to provide its class at the `index.ts`:

```ts
// src/index.ts
// ...

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
    defaultAuth: 'public',
    providers
});
// ...
```

### Behaviour

The job is first initialized with the given initial config.
Which in this case means that
- its name is 'Status'
- it *would* run every second
- but is not active yet.

At that first startup, the cron job is saved as a cron job entity in a data source.
After that you can programmatically change its configuration, like putting it on the schedule or changing the cron expression.

**Who owns which value.** The schedule and whether the job is running are yours to change while the app runs, so the stored row wins for those — a change you make through the cron service survives every restart, and editing `cron` in the class afterwards has no effect. `runOnInit` and `onFailure` describe what the job *does* rather than when, so the class stays the single source of truth for them: every start brings the row back in line with what it declares, and `onFailure` is read from the class alone. Set `syncToDataSource: false` to keep the whole configuration in the class, at the cost of the row that records `lastRun` and the last error.

**Changing a job while the app runs.** `cronService.enable()`, `disable()` and `changeCron()` change a job on every instance: the row's `source` is `'code'` for a job declared as a class, and `cronService.update()` refuses such a job, since its class declares the rest. Every instance reads the row before each run of a job, so a job disabled, stopped or rescheduled on one instance is skipped from its next run on all of them, and a job runs only at the times of its new schedule. `CronSyncCronJob`, registered for you on every instance, reads the rows every five seconds and puts enabled jobs back on the schedule and moves rescheduled ones. This is how a job that misbehaves is turned off without a deploy, also from its own `onError`.

A job runs outside every [tenant](./tenancy.md#work-outside-a-request), and every tenant shares it.

### What a job is doing

A job is in one of three states, readable as `job.state`:

| State | Meaning |
|---|---|
| `ACTIVE` | On the schedule |
| `INACTIVE` | Off the schedule because that is what was asked for — in `initialConfig`, or through `cronService.disable()` |
| `STOPPED_ON_ERROR` | Off the schedule because its ticks threw as often in a row as its `onFailure.stopAfterFailures` allows |

`active: false` in `initialConfig` says where the job begins; from then on the state is what the row records.

The last two are both "off", and keeping them apart is what lets the next start treat them differently. A job **somebody** turned off stays off — nothing puts it back but `cronService.enable()`. A job the **framework** stopped records where to return to, and the next start puts it there: whatever made that start happen — a deploy, a failover, a configuration change — is the same class of event that would have fixed the failure. The `errorMessage` survives the recovery, so what went wrong is still readable afterwards.

### Which clock a schedule is read on

An expression like `0 3 * * *` names no moment on its own — "03:00" is a different instant in every zone, and a different one in summer than in winter. So a job's schedule is the expression *and* the time zone it is read in.

The zone defaults to **UTC**, not to whatever the machine is set to. A local zone is part of the environment, which would make the same job fire at one moment on a laptop and another in production, and move by an hour twice a year anywhere observing daylight saving.

Change it for the whole deployment through the localize options:

```ts
defineProvider({
    token: ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS_INPUT,
    useValue: { defaultTimezone: 'Europe/Berlin' }
})
```

Or per job, which is what lets one deployment run the same work on the schedule each of its tenants expects:

```ts
// src/cron/nightly-invoices.cron-job.ts
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

`Timezone` is a union of the IANA zone names, so a typo is a compile error rather than a job that never fires.

### Running at startup

`runOnInit` is off by default. Turn it on and the job runs once when the app starts, in addition to its schedule.

For a `distributed` job that startup run is elected the same way a scheduled one is, so a deployment of ten pods runs it once and not ten times. The claim is keyed on the slot the run is happening ahead of, which every replica of one rolling deploy computes identically — and separately from that slot's own claim, so running early does not cancel the scheduled run. That claim is held until the slot arrives, so a pod that becomes ready an hour into a slow deploy still finds it taken. A pod restarting a week later sees a different slot and runs again, which is the point of the option.

For a job with `distributed: false` it runs on every instance, because that is what per-instance work means.

### Catching up a run that was missed

A slot that passes while nothing is running is simply gone — a deployment down from 02:00 to 04:00 skips its 03:00 job and the next one is tomorrow. Whether that matters is a property of the work, so it is something a job asks for:

```ts
// src/cron/catching-up.cron-job.ts
@Injectable()
export class CatchingUpCronJob extends CronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'Nightly invoices',
        cron: CronExpression.daily().at(3, 'hours').build(),
        // still worth running at 06:00 when the outage clears — but not a week later
        catchUpWithinMs: Ms.DAY
    };

    async onTick(): Promise<void> {}
}
```

On start, the job runs **once** for the most recent slot it missed — not once per slot the outage covered, so a week of downtime owes one invoice run rather than seven. `catchUpWithinMs` is also how far back it looks: anything older is left alone, because past some age a make-up run stops being a service and becomes a surprise.

The same limit covers a slot a running process reaches late, for example while a long synchronous computation blocks it: a slot no later than `catchUpWithinMs` still runs, and of several such slots only the most recent one.

Left unset, a missed slot stays missed, and so does a slot reached more than a second late. The app logger warns about each slot left out this way. That is right for work that is only about the moment it was scheduled for — collecting this minute's metrics is not worth doing later.

A job that has never run catches up nothing: there is no point to measure "since" from, and treating a whole schedule as outstanding would fire every job on the first boot of every new environment.

Across replicas the make-up run is claimed exactly like the real one it stands in for, so if any instance did run that slot, nothing happens.

### When a tick throws

The error is logged and recorded on the job's row as `errorMessage`, and the next tick runs as usual. A failure that clears on its own — an smtp server refusing connections for a minute, a database mid-failover — costs you one execution.

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
            // run a failed slot again after 30 s, 60 s and 120 s
            retry: { attempts: 3, delayInMs: 30 * Ms.SECOND },
            // while failing, skip 1, then 3, then 7 slots, at most 15
            backOff: { maxSkippedSlots: 15 },
            // off the schedule after 5 failures in a row
            stopAfterFailures: 5,
            // and back on it an hour after its last run
            restartAfterMs: Ms.HOUR
        }
    };

    async onTick(): Promise<void> {}
}
```

| Option | What it does |
|---|---|
| `retry` | Runs a slot whose tick threw again, waiting `delayInMs` before the first attempt and twice as long before each one after it. No attempt starts once the next slot is due, and none after the app began shutting down. Only for work that is safe to run twice |
| `backOff` | After n failures in a row the job skips the next 2^n - 1 slots, at most `maxSkippedSlots` |
| `stopAfterFailures` | After this many failures in a row the job moves to `STOPPED_ON_ERROR`, and comes back at the next start, as above |
| `restartAfterMs` | Puts a job `stopAfterFailures` stopped back on the schedule this long after its last run. Its failures are still counted, so a failure of its next tick stops it again |

Failures are counted in a row across every instance, as `consecutiveFailures` on the job's row, and a slot whose retries all failed counts once. A tick that succeeds sets the count back to 0 and ends a back off.

### Running more than one instance

A scheduled job is work your deployment owes **once**, not once per replica. Three pods would otherwise mean a nightly invoice run bills every customer three times.

Zibri handles this for you, and it is on by default. Before running a job, every instance takes a [lease](./leases.md) on that execution, keyed `cron:<job name>:<scheduled time>`. Exactly one instance can hold a key, so the data source decides the winner and every other instance skips. The key names one *execution*, not the job as a whole, so an instance whose start was jittered into the next second still competes for the tick it was scheduled for.

The grant is **retained** rather than handed back when the job finishes — it is not only the exclusion but the record that this tick has been dealt with. Handing it back would let a replica arriving a moment later win the same key and run the job a second time.

A claim is held for `ZIBRI_DI_TOKENS.CRON_EXECUTION_LEASE_IN_MS` (five minutes by default). This exists so that an instance which *dies* mid-run does not block that job forever — once the claim expires another instance takes the execution over.

> **This is the one lease Zibri does not renew underneath you.** node-cron owns the job body and only asks the framework *who should run*, so there is no work here to renew across. Everywhere else the grant follows the work; here the work has to fit the grant. Raise it for jobs that legitimately run longer than the default, or a second instance may pick up an execution while the first is still working on it:

```ts
defineProvider({ token: ZIBRI_DI_TOKENS.CRON_EXECUTION_LEASE_IN_MS, useFactory: () => Ms.MINUTE * 30 })
```

To elect differently — through a lock your infrastructure already provides, say — replace the cron service and implement `shouldRunExecution`. Returning `true` everywhere restores the unsafe once-per-replica behavior; returning `false` everywhere stops the job running at all.

#### Jobs that must run everywhere

Not every job is work the deployment owes once. Some act on state that belongs to the instance itself and that nothing else can see. Those set `distributed: false` and run on every instance:

```ts
// src/cron/clear-local-cache.cron-job.ts
@Injectable()
export class ClearLocalCacheCronJob extends CronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'Clear local cache',
        cron: CronExpression.every(5, 'minutes').build(),
        distributed: false
    };

    async onTick(): Promise<void> {}
}
```

The test is **who owns the state the job touches**. A shared data source, a payment provider, an outbound mail queue → leave it `true`, or three replicas do it three times. This process's memory, this container's filesystem → `false`, or two of your three replicas are never cleaned up.

Zibri's own jobs follow the same rule: `CollectMetricsCronJob` (each instance has its own registry and host), `FormDataBodyParserCleanupCronJob` (each container has its own temp folder) and `RateLimitingCleanupCronJob` (the default limiter store is in memory) are `distributed: false`. Everything that cleans up rows in a data source is not.

#### What `distributed: true` does not promise

It elects one replica per **scheduled execution**. It does not mean only one execution is running at a time.

The claim is keyed by the job and the slot it fired for, so the next slot is a different claim that another replica may win freely — including while this one is still working. A job whose `onTick` can outlive its own interval will therefore overlap itself, and the second run reads the same not-yet-updated rows as the first.

If that is possible for your job, claim the individual work items it processes rather than relying on the slot. `SendQueuedEmailsCronJob` is the worked example: it claims each mail before sending it, because a slow smtp server makes a send outlast the interval easily. See [leases.md](./leases.md).

## Configuration
Each cron job's `initialConfig` (`name`, `cron` schedule, `active`, `runOnInit`, `onFailure`, `distributed`, `syncToDataSource`) is set on the job class itself — see "Defining a cron job" above. There is no separate global configuration object.
<br>
Cluster-wide behaviour is configured through DI: `ZIBRI_DI_TOKENS.CRON_EXECUTION_LEASE_IN_MS` for how long a claim is held, `ZIBRI_DI_TOKENS.CRON_REGISTRATION_LEASE_IN_MS` for how long one instance may take to register its jobs at boot, or `ZIBRI_DI_TOKENS.CRON_SERVICE` to replace election entirely.

### Registering jobs when several instances boot together

Nothing to configure, but worth knowing it happens. A job's row is looked up by name and created when it is missing, and every instance does that for the same names — so registration runs under a lease and the instances take their turn. The first one through creates the rows and the rest find them already there.

Without it they would all look, all find nothing, and all insert; `name` is unique, so the instances that lost would not merely skip the row, they would **fail to boot**. Only visible when the table is empty, which is the first deploy, a restore, and every fresh environment.

Raise `CRON_REGISTRATION_LEASE_IN_MS` if you have enough jobs that one instance cannot get through them in thirty seconds. An instance that dies mid-registration does not block the others past the lease.

## See also
- [Replication](./replication.md) — running more than one instance, and what else changes when you do
- [Leases](./leases.md) — claiming individual work items, for jobs that outlive their own interval
- [Data sources](./data-source.md) — cron jobs are persisted as entities in a data source
- [Application lifecycle](./application-lifecycle.md) — registering cron jobs on the `ZibriApplication`
- [Logging](./logging.md) — the logger injected via `ZIBRI_DI_TOKENS.LOGGER`