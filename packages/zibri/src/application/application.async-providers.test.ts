import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource, zibriFrameworkEntities } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { Repository } from '../data-source/repository/repository';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { InjectionToken } from '../di/models/injection-token.model';
import { BaseEntity } from '../entity/base-entity.model';
import { type OnAppInit } from '../global/on-app-init.interface';
import { Newable } from '../types/newable.type';

/**
 * An application's asynchronous providers are registered after its classes, and a class reaching
 * for one anywhere but a constructor parameter failed the boot.
 */

const vaultSecret: InjectionToken<string> = new InjectionToken<string>('vault-secret');

const nobodyRegistered: InjectionToken<boolean> = new InjectionToken<boolean>('nobody-registered');

let secretAtInit: string | undefined;

@Injectable()
class WarmIndexService implements OnAppInit {
    private readonly password: string = inject(vaultSecret);

    onAppInit(): void {
        secretAtInit = this.password;
    }
}

@DataSource()
class VaultDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...new Set([...zibriFrameworkEntities, ...defaultTestServerEntities])];
    override readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
    // where a connection password would be read from
    readonly password: string = inject(vaultSecret);
}

describe('an application with asynchronous providers', () => {
    let server: StartedTestServer | undefined;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [VaultDataSource],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: vaultSecret,
                    useAsyncFactory: async () => Promise.resolve('hunter2')
                }),
                // what has to keep working: a factory that reads through a repository runs after the
                // data sources that provide it
                defineProvider({
                    token: nobodyRegistered,
                    deps: [repositoryTokenFor(JwtUser)],
                    useAsyncFactory: async (users: Repository<JwtUser>) => !await users.exists({ where: { email: 'nobody@example.com' } })
                })
            ]
        });
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    });

    it('hands the awaited value to a field initializer of a class with a lifecycle hook', () => {
        expect(secretAtInit).toBe('hunter2');
        expect(WarmIndexService).toBeDefined();
    });

    it('hands the awaited value to a field initializer of a data source', () => {
        expect(inject(VaultDataSource).password).toBe('hunter2');
    });

    it('runs a factory that reads through a repository once the data sources are up', () => {
        expect(inject(nobodyRegistered)).toBe(true);
    });
});