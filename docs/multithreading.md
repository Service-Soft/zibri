# Multithreading
Zibri aims to take care of most of your multi threading concerns, including:

- a reusable worker pool that is automatically sized based on the available threads (can be [configured](#configuration))
- support for typescript out of the box
- a way to run worker files, being really close to the original implementation
- a simple way to run a function in a separate thread
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
| `MultithreadingOptions` | type | Options accepted by the `MULTITHREADING_OPTIONS` DI token |
| `ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS` | DI token | Overrides worker pool defaults |

## Usage
### Queue and run a thread job
If you have some more complex tasks where you also want to be able to report progress during runtime you will probably queue a thread job.

There are 3 methods provided by the thread job service for that:
- queueThreadJob
- waitForThreadJob
- runThreadJob (a combination of the two methods above)

To queue/run a thread job you need to provide some thread job data:

```ts
const jobId: string = await this.multithreadingService.queueThreadJob({
    workerData: {
        filePath: './fibonacci.worker.ts', // .ts and .js both work
        startValue: 20
    }
});
// const threadJobEntity = await this.multithreadingService.waitForThreadJob(jobId);
```

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

If you have a long running thread job where you want to know about the progress, you can also use the `reportProgress(percentNumber)` to do that.
<br>
Please note that this will result in a job completion when you report 100, so be sure that you round down this value if you set it dynamically.

### Run a simple function
You can run simple functions on a separate thread by using the `run` method of the `MultithreadingServiceInterface`.
<br>
This returns the result of the function call or rejects with an error.

> **Restrictions**
> - It is expected that only known and trusted functions are passed to this method, as `eval` is used under the hood
> -  Imports won't be resolved when the code is executed on the thread, which means that your function should only use things that are globally available (eg. console.log) or passed via the second argument
> -  The run will not be stored inside a data source, and the utility functions like `reportProgress` will not work

By default this is also run with priority. This is because the execution time will probably be not that long. (Because you can await the result.)
<br>
You can however also add a fourth parameter to define whether or not it should run with priority.

```ts
// src/services/fibonacci.service.ts
import { Inject, ZIBRI_DI_TOKENS, MultithreadingServiceInterface } from 'zibri';

function fibonacci(n: number): number {
    if (n <= 1) {
        return n;
    }
    return fibonacci(n - 1) + fibonacci(n - 2);
}

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
            defaultTimeoutPriorityMs: Ms.MINUTE * 5
        })
    })
];
```

This accepts the following options:
- `maxThreads`: The number of threads that can be used for normal (non priority) jobs. Defaults to the available parallelism of the machine, minus the threads reserved for libuv and the main thread.
- `maxPriorityThreads`: The number of threads that are reserved for priority jobs, e.g. those queued via `run`. Defaults to `1`.
- `defaultTimeoutMs`: The default timeout for a normal thread job, used when no explicit `timeout` is provided when queueing the job. Defaults to 1 hour.
- `defaultTimeoutPriorityMs`: The default timeout for a priority thread job. Defaults to 5 minutes.

<br>
Please note that `maxThreads + maxPriorityThreads` needs to be smaller than the available threads of the machine.
<br>
If a worker crashes, the pool automatically spins up a fresh replacement worker of the same priority class, so that the configured pool size is always kept available.

## See also
- [Application lifecycle](./application-lifecycle.md) — hooks like `OnAppInit` for setting up providers such as `MULTITHREADING_OPTIONS` at startup
