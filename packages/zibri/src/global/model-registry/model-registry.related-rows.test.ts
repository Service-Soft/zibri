import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { type HashString } from '../../auth/hash/hash.utilities.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { inject } from '../../di/inject.function.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { OmitClass } from '../../entity/omit-class.model.ts';

// A row of a related entity is a row of its own: its encrypted values are bound to its id rather than
// to the row it was read along with, and writing a row that references it writes none of its columns.
// In memory, as which rows the hooks walk is decided by the repository alone, whichever store holds them

@Entity({ tenant: 'shared' })
class Vault extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.manyToMany({ target: () => Keyholder, inverseSide: 'vaults', joinTable: true })
    keyholders!: Keyholder[];
}

@Entity({ tenant: 'shared' })
class Keyholder extends BaseEntity {
    @Property.string({ encryption: true })
    secret!: string;

    @Property.string({ hash: true })
    password!: HashString;

    @Property.manyToMany({ target: () => Vault, inverseSide: 'keyholders', joinTable: false })
    vaults!: Vault[];
}

// password goes in as plaintext and comes back a hash, the same split as ModelRegistryTestItemCreateData
class KeyholderCreateData extends OmitClass(Keyholder, ['id', 'password']) {
    @Property.string({ hash: true })
    password!: string;
}

describe('model-registry descriptors — rows of related entities', () => {
    let server: StartedTestServer | undefined;
    let vaultRepository: Repository<Vault>;
    let keyholderRepository: Repository<Keyholder, KeyholderCreateData>;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: [...defaultTestServerEntities, Vault, Keyholder] })]
        });
        vaultRepository = inject(repositoryTokenFor(Vault));
        keyholderRepository = inject(repositoryTokenFor(Keyholder));
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('decrypts a row read along with another one against its own row', async () => {
        const vault: Vault = await vaultRepository.create({ name: 'read', keyholders: [] });
        await keyholderRepository.create({ secret: 'read-secret', password: 'read-password', vaults: [vault] });

        const found: Vault = await vaultRepository.findById(vault.id, { relations: ['keyholders'] });

        expect(found.keyholders.map(k => k.secret)).toEqual(['read-secret']);
    });

    it('writes nothing of a row that the written one references, and leaves the caller\'s copy of it as it was', async () => {
        const keyholder: Keyholder = await keyholderRepository.create({ secret: 'write-secret', password: 'write-password', vaults: [] });
        const password: HashString = keyholder.password;

        // a loaded row passed back as the reference: its secret is the value, its password the hash
        const vault: Vault = await vaultRepository.create({ name: 'write', keyholders: [keyholder] });

        expect(keyholder.secret).toBe('write-secret');
        expect(keyholder.password).toBe(password);
        const found: Vault = await vaultRepository.findById(vault.id, { relations: ['keyholders'] });
        expect(found.keyholders.map(k => k.secret)).toEqual(['write-secret']);
        expect((await keyholderRepository.findById(keyholder.id)).secret).toBe('write-secret');
    });
});