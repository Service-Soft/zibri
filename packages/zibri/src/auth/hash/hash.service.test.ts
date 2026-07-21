import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { HashService } from './hash.service';
import { HashString } from './hash.utilities';
import { HashStrategyEntity, HashStrategyStatus } from './strategies/hash-strategy-entity.model';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';

describe('HashService', () => {
    let server: StartedTestServer;
    let hashService: HashService;
    let strategyRepository: Repository<HashStrategyEntity>;

    beforeAll(async () => {
        server = await startTestServer();
        strategyRepository = inject(repositoryTokenFor(HashStrategyEntity));
        hashService = inject(ZIBRI_DI_TOKENS.HASH_SERVICE) as HashService;
    }, 15000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    test('creates strategy metadata on first hash', async () => {
        const strategiesBeforeHash: HashStrategyEntity[] = await strategyRepository.findAll();
        expect(strategiesBeforeHash).toHaveLength(0);

        const hashed: HashString = await hashService.hash('hello');
        expect(hashed).toBeTruthy();

        const strategies: HashStrategyEntity[] = await strategyRepository.findAll();
        expect(strategies).toHaveLength(1);
        expect(strategies[0]).toMatchObject({
            status: HashStrategyStatus.DEFAULT
        });
    });

    test('does not duplicate strategy metadata on subsequent hashes', async () => {
        await hashService.hash('first');
        await hashService.hash('second');

        const strategies: HashStrategyEntity[] = await strategyRepository.findAll();
        expect(strategies).toHaveLength(1);
    });

    test('verifies a hash correctly', async () => {
        const hashed: HashString = await hashService.hash('secret');

        await expect(hashService.equal('secret', hashed)).resolves.toBe(true);
        await expect(hashService.equal('wrong', hashed)).resolves.toBe(false);
    });

    test('detects whether a hash needs rehashing', async () => {
        const hashed: HashString = await hashService.hash('secret');
        expect(await hashService.needsRehash(hashed)).toBe(false);
    });
});