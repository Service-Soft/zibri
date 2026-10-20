# Multithreading
Zibri aims to take care of most of your multi threading concerns, including:

- a reusable worker pool that is automatically sized based on the available threads (can be [configured](#configuration))
- support for typescript out of the box
- a way to run worker files, being really close to the original implementation
- a simple way to run a function in a separate thread
- a queue that lives in a data source, so a job queued on one instance is run by whichever one has a worker free
- storing data about your thread jobs like status, error etc. inside a data source
- utility functions to easily update the progress, status, error or result of the job
- configurable timeouts for jobs and self healing capabilities of the worker pool

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `MultithreadingServiceInterface` | interface | Queue, wait for and run thread jobs |
| `ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE` | DI token | Injects `MultithreadingServiceInterface` |
| `BaseThreadJobWorkerData` | type | Base shape of the data passed to a worker file |
| `reportCompletion` | function | Reports a thread job as completed, called from within a worker file |
| `reportError` | function | Reports a thread job as failed, called from within a worker file |
| `reportProgress` | function | Reports the progress (0-100) of a running thread job |
| `getThreadJobTraceContext` | function | The trace a running thread job is recorded under, called from within a worker file |
| `MultithreadingOptions` | type | Options accepted by the `MULTITHREADING_OPTIONS` DI token |
| `ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS` | DI token | Overrides worker pool defaults |
| `ThreadJobEntity` | entity | The queue itself |
| `RunQueuedThreadJobsCronJob` | cron job | Looks for work this instance could take. Registered for you |

## Usage
### Queue and run a thread job
If you have some more complex tasks where you also want to be able to report progress during runtime you will probably queue a thread job.

There are 3 methods provided by the thread job service for that:
- queueThreadJob
- waitForThreadJob
- runThreadJob (a combination of the two methods above)

To queue/run a thread job you need to provide some thread job data:

```ts
// src/services/fibonacci.service.ts
import { FsUtilities, MultithreadingServiceInterface } from 'zibri';

export async function queueFibonacci(multithreadingService: MultithreadingServiceInterface): Promise<string> {
    return await multithreadingService.queueThreadJob({
        workerData: {
            // .ts and .js both work. FsUtilities.getPath resolves it against this file rather than
            // against whichever directory the application was started from
            filePath: FsUtilities.getPath(__dirname, 'fibonacci.worker.ts'),
            startValue: 20
        }
    });
    // const threadJobEntity = await multithreadingService.waitForThreadJob(jobId);
}
```

`waitForThreadJob` inside a request stops waiting when that request's deadline passes — see
[deadlines](./creating-endpoints.md#deadlines). The job itself carries on and still records what it
did, so the row is there to read afterwards.

Let's take a look at the worker file under `fibonacci.worker.ts`:

#### Worker file definition
The provided worker file needs to work a bit different than a normal one:

```ts
/* eslint-disable jsdoc/require-jsdoc */
import { parentPort, workerData as nodeWorkerData } from 'node:worker_threads';
import { BaseThreadJobWorkerData, reportCompletion, reportError } from 'zibri';

type FibonacciWorkerData = BaseThreadJobWorkerData & {
    startValue: number
};

const workerData: FibonacciWorkerData | undefined = nodeWorkerData as FibonacciWorkerData | undefined;

if (!workerData) {
    //@ts-ignore-next-line
    return;
}

function fibonacci(n: number): number {
    if (n <= 1) {
        return n;
    }
    return fibonacci(n - 1) + fibonacci(n - 2);
}

try {
    const res: number = fibonacci(workerData.startValue);
    reportCompletion(res);
}
catch (error) {
    reportError(error as Error);
}
```

The `reportCompletion` and `reportError` parts are really important, as the thread job would run into a timeout without them.

A worker file may be TypeScript, CommonJS or an es module, and may use top level `await`. Its top level code is the job, and one worker thread runs many jobs, so the file is evaluated again for each of them — which is also why a value left in module scope by one job is not there for the next.

A TypeScript worker file (`.ts`, `.mts` or `.cts`) is compiled as it is loaded, which needs the optional peer dependency `oxc-transform` installed. `multithreading.enableTsWorkerFiles` declares whether this application uses such files, and it defaults to `true`. Startup fails when it is `true` and `oxc-transform` is missing, so a deployment that left the compiler out finds out on the way up rather than from the first job that happens to name a `.ts` file.

Set it to `false` for a deployment that ships compiled worker files. Nothing then loads a TypeScript compiler, a `.ts` file is refused the moment it is queued, and `oxc-transform` does not have to be installed.

An error that reaches neither a `try`/`catch` nor `reportError` — thrown from a timer, a callback or a promise nobody awaited — ends the worker. The job is marked `FAILED` with that error, and a fresh worker takes its place in the pool. A thread is reused by every job after it, so anything the throw left half done would otherwise be the state the next one starts from.

The job's `error` is a `LoggedError` — `{ name, paragraphs, stackTrace }`, the same shape a log entry carries, with `paragraphs` holding the message and the `cause` chain beneath it. That is what a row can keep: an `Error`'s own `message`, `stack` and `cause` are non-enumerable, so a column given one stores `{}`. `runThreadJobFunction` still rejects with a real `Error`, rebuilt from what the row holds.

If you have a long running thread job where you want to know about the progress, you can also use the `reportProgress(percentNumber)` to do that.
<br>
Please note that this will result in a job completion when you report 100, so be sure that you round down this value if you set it dynamically.

### The queue is shared
A queued job is a row and nothing else. There is no second copy of the queue in the process that queued it, which is what makes the queue the deployment's rather than one instance's: a job queued on the instance handling a request is run by whichever instance has a worker free, including one that has not handled a request all day.

Jobs are given to workers oldest first, priority jobs before normal ones. A priority job takes a normal worker when no priority worker is free; a normal job never takes a priority worker, which is what reserving one means.

Before an instance runs a job it takes a [lease](./leases.md) on it, and holds that lease for as long as the job runs. That claim is what stops two instances running the same job, and it is renewed underneath, so a job may take as long as it takes without ever losing it.

A `run` call is the exception. Its function never leaves the process that called it, so it waits in that process — ordered against the queued jobs by when it was queued, not before or after them as a class.

A job queued in a [tenant](./tenancy.md#work-outside-a-request) belongs to it, and its `onMessage`, `onComplete`, `onError` and `onCancel` run in that tenant. Waiting for it from another tenant answers like waiting for a job that does not exist.

### Surviving a restart
Shutting down marks every job still running as `INTERRUPTED` before the workers stop, and hands back their claims — a job that ran halfway is not the same as one that never started, and `startedAtMs` and `progress` are kept as the record of how far it got. It is not a drain: a job's default timeout is an hour and a pod's grace period is seconds, so waiting is not on offer. What it is, is a handover: the claim is free the moment the process lets go of it, so another instance takes the job over straight away rather than waiting for anything to lapse.

An instance picks work up when it starts, when it queues something, when one of its workers finishes, and on a poll for everything else. A job is takeable when it is `IN_QUEUE`, `INTERRUPTED`, or `IN_PROGRESS` with no live claim on it — which is what a process that was *killed* leaves behind, since it never got to write anything.

**The claim is what says an instance is still there, not the row.** An `IN_PROGRESS` row left by a killed pod is identical to one another instance is working on right now, so the row cannot answer it. A live owner renews its claim; one that stopped existing lets it lapse, and the job is taken over within `30 seconds` of that.

**Jobs run at least once, not exactly once.** An instance can finish a job and be killed before writing that down, or fail to reach the data source when it tries to, and a job taken over runs again from the beginning — `progress` goes back to zero, because it describes the run rather than the job. A job whose side effects must not happen twice has to be safe to repeat, the same as in any other durable queue.

Work is picked up on start rather than on init deliberately: a pod that comes up and never becomes ready does not work through the backlog.

`run` takes no part in any of this. It keeps its job in the process that called it and never writes a row, so a restart ends it along with the caller awaiting it.

### Callbacks
`onMessage`, `onComplete`, `onError` and `onCancel` are functions, so they stay in the instance that queued the job and fire only if that instance is also the one that runs it. A job picked up elsewhere still runs, still writes its row, and still ends the `runThreadJob` that is waiting for it — it just cannot call back into a process it cannot reach. Anything that has to happen wherever the job runs belongs in the worker file.

### Tracing
The run of a job is a [span](./tracing.md#what-the-framework-records) named `runThreadJob`, recorded under the trace the job was queued in — whenever it runs and on whichever instance. A `run` call is recorded under the trace of its caller. A job that failed is a span that failed.

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

### Run a simple function
You can run simple functions on a separate thread by using the `run` method of the `MultithreadingServiceInterface`.
<br>
This returns the result of the function call or rejects with an error.

> **Restrictions**
> - Only the function's source crosses the thread boundary, so it runs with its arguments and the worker's globals (eg. `console.log`) in scope and nothing else. Imports are not resolved, and a variable captured from around the function is a `ReferenceError` when it runs rather than an error where it was written — pass everything it needs through the second argument
> - The run is not stored in a data source, and the utility functions like `reportProgress` do not work
> - Pass functions your own code wrote. The source is turned back into a function on the worker, so a function assembled from input you did not control runs as code

A function can only be run this way. `queueThreadJob` names a file instead, and throws a `PersistedFunctionJobError` if given a function: a queued job is written to a row and read back by `requeueThreadJob`, so a function there would have to be stored as source and turned back into code to run a second time — which would make write access to that table enough to run code in a worker. Work that has to survive a restart lives in a file.

By default this is also run with priority. This is because the execution time will probably be not that long. (Because you can await the result.)
<br>
You can however also add a fourth parameter to define whether or not it should run with priority.

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
The worker pool is preconfigured with sensible defaults, but can be overwritten via the `MULTITHREADING_OPTIONS` di token:

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
            defaultTimeoutMs: Ms.HOUR,
            defaultTimeoutPriorityMs: Ms.MINUTE * 5,
            jobClaimInMs: Ms.SECOND * 30,
            enableTsWorkerFiles: true
        })
    })
];
```

This accepts the following options:
- `maxThreads`: The number of threads that can be used for normal (non priority) jobs. Defaults to the available parallelism of the machine, minus the threads reserved for libuv and the main thread.
- `maxPriorityThreads`: The number of threads that are reserved for priority jobs, e.g. those queued via `run`. Defaults to `1`.
- `defaultTimeoutMs`: The default timeout for a normal thread job, used when no explicit `timeout` is provided when queueing the job. Defaults to 1 hour.
- `defaultTimeoutPriorityMs`: The default timeout for a priority thread job. Defaults to 5 minutes.
- `jobClaimInMs`: How long the claim on a running job lives before another instance may take that job over. Renewed for as long as the job runs, so it is not a limit on how long a job may take — it decides how quickly work is taken back from an instance that stopped existing. Defaults to 30 seconds.

<br>
Please note that `maxThreads + maxPriorityThreads` needs to be smaller than the available threads of the machine.
<br>
If a worker crashes, the pool automatically spins up a fresh replacement worker of the same priority class, so that the configured pool size is always kept available.

## See also
- [Application lifecycle](./application-lifecycle.md) — hooks like `OnAppInit` for setting up providers such as `MULTITHREADING_OPTIONS` at startup
