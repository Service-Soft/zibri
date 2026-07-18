# Cron
Cron jobs in Zibri use the node-cron package and its cron syntax under the hood.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `CronJob` | class | Base class to extend when defining a cron job |
| `InitialCronConfig` | interface | Config shape (`name`, `cron`, `active`, `syncToDataSource`, ...) required by `CronJob.initialConfig` |
| `CronExpression` | class | Builder for cron expression strings (eg. `CronExpression.every(1, 'seconds').build()`) |

## Usage
### Defining a cron job
To define a job it needs to extend the `CronJob` class. Below is a simple example that just logs to the console each second:

```ts
// src/cron/status.cron-job.ts
import { CronExpression, CronJob, inject, Injectable, ZIBRI_DI_TOKENS, InitialCronConfig } from 'zibri';

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
import { StatusCronJob } from './cron';
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
After that you can programmatically change its configuration, like setting active to true or changing the cron schedule.

While this is pretty useful, it might not always be what you want. A downside of this is for example that changing the initial config after the cron job has already been saved in the data source does not have any effect. If you want the hardcoded configuration inside the cron job to be the single source of truth you can set the `syncToDataSource` flag to false in the initial config.

## Configuration
Each cron job's `initialConfig` (`name`, `cron` schedule, `active`, `syncToDataSource`) is set on the job class itself — see "Defining a cron job" above. There is no separate global configuration object.

## See also
- [Data sources](./data-source.md) — cron jobs are persisted as entities in a data source
- [Application lifecycle](./application-lifecycle.md) — registering cron jobs on the `ZibriApplication`
- [Logging](./logging.md) — the logger injected via `ZIBRI_DI_TOKENS.LOGGER`