import { defaultClusterProviders, StartTestServerOptions } from 'zibri-testing';

import { Repository } from '../../../data-source/repository/repository';
import { InjectRepository } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BaseThreadJobWorkerData } from '../../../multithreading/models/base-thread-job-worker-data.model';
import { ThreadJobEntity } from '../../../multithreading/models/thread-job-entity.model';
import { type MultithreadingServiceInterface } from '../../../multithreading/services/multithreading-service.interface';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Get } from '../../../routing/decorators/get.decorator';
import { Param } from '../../../routing/decorators/param.decorator';
import { Post } from '../../../routing/decorators/post.decorator';
import { FsUtilities, type FsPath } from '../../../utilities/fs.utilities';

/**
 * What every instance of the thread job cluster boots with.
 *
 * Every replica runs identical code and has the same one worker, which is what makes the queue's
 * behavior visible: a replica that is busy cannot run what it queues, so whether the work happens at
 * all is a question about the other replica.
 *
 * Like every instance options module this is imported by the parent as well, so nothing at the top
 * level may assume it is running inside an instance.
 */

/**
 * The worker file every job in this cluster runs.
 *
 * It reports the id of the instance it ran on, taken from that process's environment - so the
 * result of a job names the replica that did the work rather than the one that asked for it.
 */
const workerFilePath: FsPath = FsUtilities.getPath(__dirname, 'thread-jobs.test.worker.ts');

/**
 * The data the fixture is given.
 */
type ThreadJobClusterWorkerData = BaseThreadJobWorkerData & {
    /**
     * How long the job stays busy for, in milliseconds.
     */
    durationInMs: number
};

/**
 * Queues jobs and reports what became of them.
 */
@Controller('/cluster-jobs')
class ClusterThreadJobController {
    constructor(
        @InjectRepository(ThreadJobEntity)
        private readonly threadJobRepository: Repository<ThreadJobEntity<ThreadJobClusterWorkerData, string>>
    ) {}

    /**
     * Queues a job that stays busy for the given time.
     * @param durationInMs - How long the job should take.
     * @returns The id of the queued job.
     */
    @Post('/queue/:durationInMs')
    async queue(
        @Param.path('durationInMs', { type: 'number' })
        durationInMs: number
    ): Promise<string> {
        const multithreadingService: MultithreadingServiceInterface = inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE);
        return await multithreadingService.queueThreadJob<ThreadJobClusterWorkerData>({
            workerData: { filePath: workerFilePath, durationInMs }
        });
    }

    /**
     * Reads what a job's row currently says.
     * @param id - The job to read.
     * @returns Its status and, once it has one, the id of the instance that ran it.
     */
    @Get('/:id')
    async read(
        @Param.path('id')
        id: string
    ): Promise<string> {
        const job: ThreadJobEntity<ThreadJobClusterWorkerData, string> = await this.threadJobRepository.findById(id);
        return `${job.status}:${job.result ?? ''}`;
    }
}

const options: StartTestServerOptions = {
    controllers: [ClusterThreadJobController],
    providers: defaultClusterProviders
};

export default options;