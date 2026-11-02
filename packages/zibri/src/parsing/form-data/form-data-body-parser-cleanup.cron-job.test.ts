import { tmpdir } from 'node:os';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { FormDataBodyParserCleanupCronJob } from './form-data-body-parser-cleanup.cron-job';
import { CLEANUP_AT_FILE_NAME } from './form-data.model';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { initDiContainer } from '../../di/init-di-container.function';
import { inject } from '../../di/inject.function';
import { type LoggerInterface } from '../../logging/logger.interface';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { Ms } from '../../utilities/ms';
import { UUIDUtilities } from '../../utilities/uuid.utilities';

/**
 * The job, with the logger its init would otherwise have handed it: what is under test is the
 * untouched `onTick` of the class it extends, not the scheduling around it.
 */
class TestCleanupCronJob extends FormDataBodyParserCleanupCronJob {
    constructor(tempPath: FsPath, logger: LoggerInterface) {
        super(tempPath);
        this.logger = logger;
    }
}

describe('FormDataBodyParserCleanupCronJob', () => {
    const root: FsPath = FsUtilities.getPath(tmpdir(), `zibri-upload-cleanup-${process.pid}`);

    beforeAll(() => {
        initDiContainer();
    });

    afterAll(async () => {
        await FsUtilities.rm(root);
    });

    // the comparison ran the wrong way round in both directions: an expired folder was kept forever,
    // and a live one - an upload still being written among them - deleted under the request
    // handling it
    it('removes an expired upload folder and leaves a live one alone', async () => {
        const expired: FsPath = FsUtilities.getPath(root, `temp-${UUIDUtilities.generate()}`);
        const live: FsPath = FsUtilities.getPath(root, `temp-${UUIDUtilities.generate()}`);
        await FsUtilities.createFile(FsUtilities.getPath(expired, CLEANUP_AT_FILE_NAME), `${Date.now() - Ms.HOUR}`);
        await FsUtilities.createFile(FsUtilities.getPath(live, CLEANUP_AT_FILE_NAME), `${Date.now() + Ms.HOUR}`);

        await new TestCleanupCronJob(root, inject(ZIBRI_DI_TOKENS.LOGGER)).onTick();

        expect(await FsUtilities.exists(expired)).toBe(false);
        expect(await FsUtilities.exists(live)).toBe(true);
    });
});