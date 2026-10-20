import { createInMemoryDataSource, defaultClusterProviders, StartTestServerOptions } from 'zibri-testing';

import { DataSourceInterface } from '../../data-source/data-sources/data-source.interface.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { BaseThreadJobWorkerData } from '../../multithreading/models/base-thread-job-worker-data.model.ts';
import { ThreadJobEntity } from '../../multithreading/models/thread-job-entity.model.ts';
import { type MultithreadingServiceInterface } from '../../multithreading/services/multithreading-service.interface.ts';
import { Controller } from '../../routing/decorators/controller.decorator.ts';
import { Get } from '../../routing/decorators/get.decorator.ts';
import { Post } from '../../routing/decorators/post.decorator.ts';
import { Newable } from '../../types/newable.type.ts';
import { FsUtilities, type FsPath } from '../../utilities/fs.utilities.ts';

/**
 * What an instance of a cluster that needs no container boots with: each replica keeps its data in
 * its own process, which is useless for anything shared and enough to show which files it runs.
 *
 * Like every instance options module this is imported by the parent as well, so nothing at the top
 * level may assume it is running inside an instance.
 */

/**
 * The worker file that reports which files the shared packages resolve to inside a worker thread.
 */
const workerFilePath: FsPath = FsUtilities.getPath(import.meta.dirname, 'module-paths.test.worker.ts');

/**
 * The data sources every instance boots on, a module level constant so the parent and each instance
 * agree on them.
 */
const dataSources: Newable<DataSourceInterface>[] = [createInMemoryDataSource()];

/**
 * Answers with the files the shared packages resolve to, in the instance and in one of its threads.
 */
@Controller('/cluster-module-paths')
class ModulePathsController {
    /**
     * The files the shared packages resolve to in the instance's main thread.
     * @returns Their urls, `zibri` first.
     */
    @Get('/instance')
    readInstanceModulePaths(): string {
        return [import.meta.resolve('zibri'), import.meta.resolve('zibri-testing')].join(' ');
    }

    /**
     * The files the shared packages resolve to in a worker thread of the instance.
     * @returns Their urls, `zibri` first.
     */
    @Post('/thread')
    async readThreadModulePaths(): Promise<string> {
        const multithreadingService: MultithreadingServiceInterface = inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE);
        const job: ThreadJobEntity<BaseThreadJobWorkerData, string> = await multithreadingService.runThreadJob({
            workerData: { filePath: workerFilePath }
        });
        return job.result ?? `the job ended ${job.status}: ${job.error?.paragraphs.join(' ') ?? ''}`;
    }
}

const options: StartTestServerOptions = {
    dataSources,
    controllers: [ModulePathsController],
    providers: defaultClusterProviders
};

export default options;
