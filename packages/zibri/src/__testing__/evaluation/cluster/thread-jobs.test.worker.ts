// Fixture: waits for as long as it is told and then reports which instance ran it.
//
// The id comes out of the environment rather than out of workerData, because that is the one thing
// the queueing instance cannot fake: a worker thread inherits the environment of the process that
// started it, so the answer names whoever actually ran the job rather than whoever wrote the row.
import { workerData } from 'node:worker_threads';

import { CLUSTER_INSTANCE_ID_ENV } from 'zibri-testing';

import { reportCompletion, reportError } from '../../../multithreading/services/worker/helpers';

/**
 * What this fixture is given.
 */
type ThreadJobClusterWorkerData = {
    /**
     * How long to stay busy for, in milliseconds.
     */
    durationInMs: number
};

const data: ThreadJobClusterWorkerData = workerData as ThreadJobClusterWorkerData;
const instanceId: string | undefined = process.env[CLUSTER_INSTANCE_ID_ENV];

if (instanceId == undefined) {
    reportError(new Error('the worker was not started inside a cluster instance'));
}
else {
    setTimeout(() => reportCompletion(instanceId), data.durationInMs);
}