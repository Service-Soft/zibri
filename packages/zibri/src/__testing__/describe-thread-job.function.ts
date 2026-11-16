import { Repository } from '../data-source/repository/repository';
import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from '../multithreading/models/base-thread-job-worker-data.model';
import { ThreadJobEntity } from '../multithreading/models/thread-job-entity.model';

/**
 * Says what a thread job's row holds, for a test that waited for it to end otherwise.
 * @param jobs - Where the row is.
 * @param id - The job.
 * @returns Its status, how often it was started, and its error if it has one.
 */
export async function describeThreadJob(
    jobs: Repository<ThreadJobEntity<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>>,
    id: string
): Promise<string> {
    const row: ThreadJobEntity<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown> = await jobs.findById(id);
    const error: string = row.error == undefined ? '' : `, failing with "${row.error.paragraphs.join(' ')}"`;
    return `the thread job ${id} is ${row.status} after ${row.attempts} starts${error}`;
}