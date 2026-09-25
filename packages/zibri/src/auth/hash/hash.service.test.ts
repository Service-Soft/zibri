import { afterAll, beforeAll, describe, expect, test } from '@jest/globals';

import { HashService } from './hash.service';
import { HashString } from './hash.utilities';
import { HashStrategyEntity, HashStrategyStatus } from './strategies/hash-strategy-entity.model';
import { ScryptHashStrategy } from './strategies/scrypt.hash-strategy';
import { Sha256HashStrategy } from './strategies/sha256.hash-strategy';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';

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

    describe('Sha256HashStrategy', () => {
        test('hashes the same value to the same hash', async () => {
            const token: string = 'b8f2c1a0d3e4f5061728394a5b6c7d8e';

            const first: HashString = await hashService.hash(token, { strategy: Sha256HashStrategy });
            const second: HashString = await hashService.hash(token, { strategy: Sha256HashStrategy });

            // the entire point: a token arrives with nothing else to find its row by, so the stored
            // value has to be reproducible from the presented one
            expect(first).toBe(second);
            await expect(hashService.equal(token, first)).resolves.toBe(true);
            await expect(hashService.equal('not the token', first)).resolves.toBe(false);
        });

        test('is not what an unqualified hash uses', async () => {
            const first: HashString = await hashService.hash('a password');
            const second: HashString = await hashService.hash('a password');

            // an unqualified hash is a password in every case that matters, so it has to land on a
            // salted strategy - two hashes of one value differing is what proves it did
            expect(first).not.toBe(second);
        });

        test('is refused as the default even when it is registered first', async () => {
            await server.reInit({
                providers: [
                    ...defaultTestServerProviders.filter(p => p.token !== ZIBRI_DI_TOKENS.HASH_STRATEGIES),
                    defineProvider({
                        token: ZIBRI_DI_TOKENS.HASH_STRATEGIES,
                        useValue: [Sha256HashStrategy, ScryptHashStrategy]
                    })
                ]
            });
            const reInitialized: HashService = inject(ZIBRI_DI_TOKENS.HASH_SERVICE) as HashService;

            const first: HashString = await reInitialized.hash('a password');
            const second: HashString = await reInitialized.hash('a password');

            // the hazard the deterministic flag exists for. findDefaultStrategy used to take
            // strategies[0], so registration order alone decided what every password was hashed
            // with - and getting it wrong is silent, because the hashes still look like hashes.
            expect(first).not.toBe(second);
        }, 30000);
    });
});