import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { BaseChainedEntity } from './base-chained-entity.model';
import { ChainedNote, describeChain, SecondChainedNote } from './chain.cases';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { Newable } from '../../types/newable.type';
import { DataSource } from '../decorators/data-source.decorator';
import { MigrationEntity } from '../migration/migration-entity.model';
import { RepositoryClass } from '../repository/repository-class.type';

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: [...defaultTestServerEntities, ChainedNote],
    repositories: defaultTestServerRepositories
});

/**
 * Holds the second note and nothing else. The anchors are kept in the first, so a chain here is written
 * in a transaction of another data source than the one its anchor is read from.
 */
@DataSource()
class NotesOnlyDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [MigrationEntity, SecondChainedNote];
    override readonly repositories: RepositoryClass[] = [];
}

const secondDataSourceClass: Newable<InMemoryDataSource> = NotesOnlyDataSource;

let server: StartedTestServer | undefined;

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass, secondDataSourceClass] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

describeChain('the in memory data source', ChainedNote);

describeChain('an in memory data source without the anchors', SecondChainedNote);

describe('declaring a chained entity', () => {
    it('refuses one that does not hold its place and hash in the chain', () => {
        expect(() => {
            @Entity({ tenant: 'shared', allowOrphan: true, chained: true })
            class UnplacedNote extends BaseEntity {

                @Property.string()
                text!: string;
            }
            return UnplacedNote;
        }).toThrow('Extend BaseChainedEntity');
    });

    it('refuses one with an encrypted property, which a key rotation stores anew', () => {
        expect(() => {
            @Entity({ tenant: 'shared', allowOrphan: true, chained: true })
            class SecretNote extends BaseChainedEntity {

                @Property.string({ encryption: {} })
                text!: string;
            }
            return SecretNote;
        }).toThrow('declares "text"');
    });

    it('refuses one kept in several data sources, since a chain is read through one repository', () => {
        expect(() => {
            @Entity({ tenant: 'shared', allowOrphan: true, allowDuplicate: true, chained: true })
            class CopiedNote extends BaseChainedEntity {}
            return CopiedNote;
        }).toThrow('allowDuplicate');
    });
});