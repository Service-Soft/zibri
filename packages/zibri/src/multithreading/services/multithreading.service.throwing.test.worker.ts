// Fixture: throws synchronously when required. thread-job.worker.ts's importWorkerFile catches this
// and reports it as a 'error' ThreadJobMessage — the worker thread itself survives, only the job fails.
throw new Error('worker fixture: intentional failure');