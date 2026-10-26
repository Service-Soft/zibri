# Multithreading
Multithreading runs work on worker threads, so it does not hold up the requests your application answers. It gives you:

- a pool of workers, sized to the threads of the machine by default, see [configuration](#configuration)
- worker files in TypeScript as well as JavaScript
- worker files written like any other node worker file
- a way to run a single function on a separate thread
- a queue that lives in a data source, so a job queued on one instance is run by whichever one has a worker free
- the status, progress, error and result of every job, stored in a data source
- functions to report the progress, error or result of a job from inside its worker file
- timeouts per job, and a pool that replaces a worker that crashed

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `MultithreadingServiceInterface` | interface | Queue, wait for and run thread jobs |
| `ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE` | DI token | Injects `MultithreadingServiceInterface` |
| `MultithreadingService` | class | Default implementation of `MultithreadingServiceInterface`. Replaceable through ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE |
| `ThreadJobData`, `ThreadJobDataFunctions` | type, type | What queuing or running a thread job takes: its `workerData`, `priority` and `timeoutInMs`, and the `onMessage`, `onComplete`, `onCancel` and `onError` callbacks, which stay in this process |
| `BaseThreadJobWorkerData` | type | Base shape of the data passed to a worker file |
| `ThreadJobFunction`, `BaseFunctionThreadJobWorkerData` | type, type | A function `run` executes on a worker thread, and the worker data it is sent there in |
| `ThreadJobStatus` | enum | Where a thread job stands: `IN_QUEUE`, `IN_PROGRESS`, `INTERRUPTED`, `COMPLETED`, `FAILED` or `CANCELLED` |
| `reportCompletion` | function | Reports a thread job as completed, called from within a worker file |
| `reportError` | function | Reports a thread job as failed, called from within a worker file |
| `reportProgress` | function | Reports the progress (0-100) of a running thread job |
| `getThreadJobTraceContext` | function | The trace a running thread job is recorded under, called from within a worker file |
| `MultithreadingOptions` | type | Options accepted by the `MULTITHREADING_OPTIONS` DI token |
| `ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS` | DI token | Overrides worker pool defaults |
| `ThreadJobEntity` | entity | The queue itself |
| `RunQueuedThreadJobsCronJob` | cron job | Looks for work this instance could take. Registered for you |
| `ThreadJobCleanupCronJob` | cron job | Deletes the jobs that are over and older than the retention. Registered for you |
| `ZIBRI_DI_TOKENS.THREAD_JOB_RETENTION_IN_MS` | DI token | How long a job that is over is kept, counted from when it was queued, or `'forever'`. Required |
| `ThreadJobAttemptsExhaustedError` | error | What a job is failed with once it was started `maxAttempts` times |
| `PersistedFunctionJobError` | error | Thrown when a queued job is handed a function, which a job that is stored cannot carry |

## Queueing and running a thread job
Queue a thread job for work that runs longer, or that reports its progress while it runs. `MultithreadingServiceInterface` has three methods for it:
- `queueThreadJob` queues the job and returns its id
- `waitForThreadJob` waits for the job to end
- `runThreadJob` does both

A thread job names the worker file it runs, and carries the data that file reads:

```ts
// src/services/fibonacci.service.ts
import { FsUtilities, MultithreadingServiceInterface } from 'zibri';

export async function queueFibonacci(multithreadingService: MultithreadingServiceInterface): Promise<string> {
    return await multithreadingService.queueThreadJob({
        workerData: {
            filePath: FsUtilities.getPath(__dirname, 'fibonacci.worker.ts'),
            startValue: 20
        }
    });
}
```

`filePath` may name a `.ts` or a `.js` file. `FsUtilities.getPath` resolves it against the file that queues the job, whichever directory the application was started from. `waitForThreadJob` with the returned id resolves to the job once it has ended.

`waitForThreadJob` inside a request stops waiting when that request's deadline passes, see
[deadlines](./creating-endpoints.md#deadlines). The job carries on and records what it did on its
row, to read afterwards.

### Writing the worker file
A worker file reads its data from `workerData`, and ends with `reportCompletion` or `reportError`:

```ts
// src/services/fibonacci.worker.ts
import { workerData as nodeWorkerData } from 'node:worker_threads';
import { BaseThreadJobWorkerData, reportCompletion, reportError } from 'zibri';

import { fibonacci } from './fibonacci.function';

type FibonacciWorkerData = BaseThreadJobWorkerData & {
    startValue: number
};

const workerData: FibonacciWorkerData = nodeWorkerData;

try {
    const result: number = fibonacci(workerData.startValue);
    reportCompletion(result);
}
catch (error) {
    reportError(error);
}
```

A job whose worker file calls neither `reportCompletion` nor `reportError` runs until its timeout.

A worker file may be TypeScript, CommonJS or an ES module, and may use top level `await`. Its top level code is the job. One worker thread runs many jobs and evaluates the file again for each of them, so a value one job leaves in module scope is gone for the next.

A TypeScript worker file is compiled as it is loaded, which needs `ts-node`. `multithreading.enableTsWorkerFiles` declares whether this application uses such files, and defaults to `true`. While it is `true`, `ts-node` is required.

Set it to `false` for a deployment that ships compiled worker files. No TypeScript compiler is loaded then, and neither `ts-node` nor the TypeScript compiler behind it has to be installed. A `.ts` file is refused when it is queued.

An error that reaches neither a `try`/`catch` nor `reportError`, such as one thrown from a timer, a callback or a promise nobody awaited, ends the worker. The job is `FAILED` with that error, and a fresh worker takes its place in the pool. The next job starts on a clean thread.

A worker that takes more memory than `multithreading.workerResourceLimits` allows ends the same way: the job is `FAILED` with the out of memory error, and the pool replaces the worker. The limit is per worker. By default it is an even share of the memory the process may use, split between the workers and the main thread. A job that allocates without end ends its own worker, and the process keeps running.

The job's `error` is a `LoggedError`: `{ name, paragraphs, stackTrace }`, the same shape a log entry carries. `paragraphs` holds the message and the `cause` chain beneath it. `run` rejects with a real `Error` rebuilt from it, and `onError` is handed one too.

`reportProgress(percentNumber)` reports how far a long running job has got. Reporting `100` completes the job, so round a computed value down.

## The queue is shared
A queued job is a row in the data source. A job queued on the instance handling a request is run by whichever instance has a worker free, including one that has not handled a request all day.

Jobs are given to workers oldest first, priority jobs before normal ones. A priority job takes a normal worker when no priority worker is free. A normal job never takes a priority worker.

Before an instance runs a job it takes a [lease](./leases.md) on it, and holds that lease for as long as the job runs. No other instance starts the job while the lease is held. The lease is renewed for as long as the job runs, so a job may take as long as it needs.

A `run` call waits in the process that called it, because its function never leaves that process. It is ordered against the queued jobs by when it was queued.

A job queued in a [tenant](./tenancy.md#work-outside-a-request) belongs to it, and its `onMessage`, `onComplete`, `onError` and `onCancel` run in that tenant. Waiting for it from another tenant answers like waiting for a job that does not exist.

## Surviving a restart
Shutting down marks every job still running as `INTERRUPTED` before the workers stop, and hands back their claims. `startedAtMs` and `progress` are kept as the record of how far each job got. Shutting down hands running jobs over without waiting for them: another instance takes each one over straight away.

An instance looks for work when it starts, when it queues something, when one of its workers finishes, and on a regular poll. A job can be taken when it is `IN_QUEUE`, `INTERRUPTED`, or `IN_PROGRESS` with no live claim on it. A killed process leaves its jobs `IN_PROGRESS`.

An instance running a job renews its claim on it. An instance that stopped existing stops renewing, and the job is taken over once its claim lapses, `jobClaimInMs` after the last renewal, 30 seconds by default.

An instance that loses its claim stops its worker. When the data source is unreachable for longer than `jobClaimInMs`, every claim lapses, and another instance may take a job over while the first worker is still running it. The first instance notices at its next renewal: it stops that worker and writes nothing more to the row, which belongs to whoever took the job over. A fresh worker takes its place in the pool, and a `runThreadJob` waiting there goes on waiting for the row.

> [!WARNING]
> Jobs run at least once. An instance can finish a job and be killed before it writes that down, or fail to reach the data source when it tries. A job taken over runs again from the beginning, with `progress` back at zero. Make a job whose side effects must not happen twice safe to repeat.

`attempts` on the row counts the starts of a job: the first one, and every takeover since. At `multithreading.maxAttempts` starts the job is not started again. It ends `FAILED` with a `ThreadJobAttemptsExhaustedError`, which names the count. This keeps a job that takes its host down, through a native crash or a kill from outside the process, from taking down one instance after another. `requeueThreadJob` starts the count over.

An instance picks up work only once the application has started, so an instance that never becomes ready runs no jobs.

`run` takes no part in any of this. Its job stays in the process that called it and has no row, so a restart ends it along with the caller awaiting it.

## What happens to a finished job
A job that is over, `COMPLETED`, `FAILED` or `CANCELLED`, keeps its row with its `result` or its `error` for `ZIBRI_DI_TOKENS.THREAD_JOB_RETENTION_IN_MS`, counted from when it was queued. `ThreadJobCleanupCronJob` deletes it after that, once a day. Provide the token:

```ts
// src/providers.ts
import { defineProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({ token: ZIBRI_DI_TOKENS.THREAD_JOB_RETENTION_IN_MS, useValue: Ms.DAY * 30 })
```

With `'forever'`, the rows are kept until you delete them. A job that is still queued or running is never deleted, however old.

## Callbacks
`onMessage`, `onComplete`, `onError` and `onCancel` are functions. They stay in the instance that queued the job, and fire only when that instance also runs it. A job picked up elsewhere still runs, writes its row and ends the `runThreadJob` waiting for it, without calling back. Put anything that has to happen wherever the job runs in the worker file.

## Tracing
The run of a job is a [span](./tracing.md#what-the-framework-records) named `runThreadJob`, recorded under the trace the job was queued in, whenever it runs and on whichever instance. A `run` call is recorded under the trace of its caller. A job that failed is a span that failed.

The worker records no spans itself. `getThreadJobTraceContext` gives the worker file the span of its run, to pass on to whatever the job calls:

```ts
// src/services/report.worker.ts
import { getThreadJobTraceContext, reportCompletion, TraceContextUtilities, TraceSpanContext } from 'zibri';

async function render(): Promise<void> {
    const context: TraceSpanContext | undefined = getThreadJobTraceContext();
    const headers: Record<string, string> = context == undefined ? {} : TraceContextUtilities.resolveHeaders(context);

    const response: Response = await fetch('https://reports.example.com/render', { method: 'POST', headers });
    reportCompletion(response.status);
}

void render();
```

## Running a function
`run` on `MultithreadingServiceInterface` runs a function on a separate thread. It returns what the function returns, or rejects with its error.

> [!NOTE]
> Only the function's source crosses to the worker. It runs with its arguments and the worker's globals, such as `console`, in scope, and nothing else. Imports are not resolved, and a variable captured from around the function is a `ReferenceError` when it runs. Pass everything it needs through the second argument.
>
> A `run` has no row in a data source, so `reportProgress` and the other report functions do not apply to it.

> [!WARNING]
> Pass only functions your own code wrote. The source is turned back into a function on the worker, so a function assembled from input you did not control runs as code.

A function runs only this way. `queueThreadJob` names a file, and throws a `PersistedFunctionJobError` when given a function: a stored function would let anyone who can write the job table run code. Work that has to survive a restart lives in a file.

`run` uses a priority worker by default. Pass `false` as its fourth argument to run the function on a normal worker.

The function the worker file above computes with:

```ts
// src/services/fibonacci.function.ts
export function fibonacci(n: number): number {
    if (n <= 1) {
        return n;
    }
    return fibonacci(n - 1) + fibonacci(n - 2);
}
```

```ts
// src/services/fibonacci.service.ts
import { Inject, ZIBRI_DI_TOKENS, MultithreadingServiceInterface } from 'zibri';

import { fibonacci } from './fibonacci.function';

//...
export class FibonacciService {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE)
        private readonly multithreadingService: MultithreadingServiceInterface
    ) {}

    async runFibonacci(): Promise<number> {
        const res: number = await this.multithreadingService.run(fibonacci, 20);
        return res;
    }

}
//...

```

## Configuration
Every option of the worker pool has a default. Override them through the `MULTITHREADING_OPTIONS` DI token:

```ts
// src/providers.ts
import { defineProvider, DiProvider, Ms, MultithreadingOptions, ZIBRI_DI_TOKENS } from 'zibri';

export const providers: DiProvider<unknown>[] = [
    //...
    defineProvider<MultithreadingOptions>({
        token: ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS,
        useFactory: () => ({
            maxThreads: 4,
            maxPriorityThreads: 2,
            defaultTimeoutInMs: Ms.HOUR,
            defaultPriorityTimeoutInMs: Ms.MINUTE * 5,
            jobClaimInMs: Ms.SECOND * 30,
            maxAttempts: 3,
            workerResourceLimits: { maxOldGenerationSizeMb: 512 },
            enableTsWorkerFiles: true
        })
    })
];
```

The options:
- `maxThreads`: The number of threads for normal (non priority) jobs. Defaults to the available parallelism of the machine, minus the libuv thread pool (`UV_THREADPOOL_SIZE`, 4 by default), the main thread and one priority thread, and at least `1`.
- `maxPriorityThreads`: The number of threads reserved for priority jobs, such as those started with `run`. Defaults to `1`, or `0` on a machine with no thread to spare for one.
- `defaultTimeoutInMs`: The timeout for a normal thread job queued without a `timeoutInMs` of its own. Defaults to 1 hour.
- `defaultPriorityTimeoutInMs`: The default timeout for a priority thread job. Defaults to 5 minutes.
- `jobClaimInMs`: How long the claim on a running job lives before another instance may take that job over. It is renewed for as long as the job runs, so it does not limit how long a job takes. It sets how quickly work is taken back from an instance that stopped existing. Defaults to 30 seconds.
- `maxAttempts`: How many times a job may be started, its first start and every takeover counted, before it is failed instead of taken over again. Defaults to 3.
- `workerResourceLimits`: The memory a worker thread may take, as node's `Worker` takes its `resourceLimits`. Defaults to a `maxOldGenerationSizeMb` of an even share of the memory the process may use, split between the workers and the main thread. `{}` leaves node's own limits in place.
- `enableTsWorkerFiles`: Whether a worker file may be TypeScript, see [the worker file](#writing-the-worker-file). Defaults to `true`.

`maxThreads + maxPriorityThreads` may be at most the available parallelism of the machine.

A worker that crashes is replaced with a fresh worker of the same priority class, so the pool keeps its configured size.

## Requirements
| Package | Used for |
|---|---|
| `rxjs` | Waiting for a worker to be ready and for a job to end |
| `ts-node` | Running worker files written in TypeScript. You install it |

Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `ThreadJobEntity` | Every application |

How large each table grows, and what deletes its rows, is in [framework tables](./framework-tables.md).

## See also
- [Application lifecycle](./application-lifecycle.md) — hooks like `OnAppInit` for setting up providers such as `MULTITHREADING_OPTIONS` at startup
- [Background work](./background-work.md) — choosing between thread jobs, events, cron jobs and the other tools
