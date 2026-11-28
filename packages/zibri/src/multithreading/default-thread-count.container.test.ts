import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { ExecResult, GenericContainer, StartedTestContainer } from 'testcontainers';

import { TestTimeouts } from '../__testing__/constants';

let container: StartedTestContainer | undefined;

beforeAll(async () => {
    // the major the package requires at least, which is the oldest node an application runs on
    container = await new GenericContainer('node:24-alpine')
        .withResourcesQuota({ cpu: 1 })
        .withCommand(['sleep', 'infinity'])
        .start();
}, TestTimeouts.postgres.start);

afterAll(async () => {
    await container?.stop();
}, TestTimeouts.postgres.shutdown);

// the default worker pool is sized from os.availableParallelism(), which was
// filed as reading the cpus of the machine rather than the cpu limit of the container. Since libuv
// 1.49 it reads the limit, and node 24 ships a later one - this holds the default to that
describe('the default size of the worker pool', () => {
    it('is sized from the cpu limit of the container rather than the cpus of the machine', async () => {
        const result: ExecResult = await (container?.exec(['node', '-p', 'require("node:os").availableParallelism()'])
            ?? Promise.reject(new Error('The container did not start.')));

        expect(result.exitCode).toBe(0);
        expect(result.output.trim()).toBe('1');
    });
});