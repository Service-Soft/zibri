# Multithreading
Zibri aims to take care of most of your multi threading concerns, including:

- a reusable worker pool that is automatically sized based on the available threads (can be [configured](#optional-configuration))
- support for typescript out of the box
- a way to run worker files, being really close to the original implementation
- a simple way to run a function in a separate thread
- storing data about your thread jobs like status, error etc. inside a data source
- utility functions to easily update the progress, status, error or result of the job
- configurable timeouts for jobs and self healing capabilities of the worker pool

# Usage
## Queue and run a thread job
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

### Worker file definition
The provided worker file needs to work a bit different than a normal one:

```ts
/* eslint-disable jsdoc/require-jsdoc */
import { parentPort, workerData as nodeWorkerData } from 'node:worker_threads';
import { BaseWorkerData, reportCompletion, reportError } from 'zibri';

type FibonacciWorkerData = BaseWorkerData & {
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

## Run a simple function
You can run simple functions on a separate thread by using the `run` method of the `MultithreadingService`.
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
import { Inject, ZIBRI_DI_TOKENS, MultithreadingService } from 'zibri';

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
        private readonly multithreadingService: MultithreadingService
    ) {}

    async runFibonacci(): Promise<number> {
        const res: number = await this.multithreadingService.run(fibonacci, 20);
        return res;
    }

}
//...

```