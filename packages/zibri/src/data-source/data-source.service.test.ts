import { describe, expect, it } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { DataSource } from './decorators/data-source.decorator';
import { MigrationEntity } from './migration/migration-entity.model';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function';
import { startAndStopTestServerWithout } from '../__testing__/test-server/start-and-stop-test-server-without.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ChangeSetEntity } from '../change-sets/models/change-set-entity.model';
import { ChangeSet } from '../change-sets/models/change-set.model';
import { Change } from '../change-sets/models/change.model';
import { SoftDeleteEntity } from '../change-sets/models/soft-delete-entity.model';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { Newable } from '../types/newable.type';

// every entity and data source below is allowed to go unused, because each case boots only some of them

@Entity({ tenant: 'shared', allowOrphan: true })
class Ledger extends ChangeSetEntity {
    @Property.string()
    name!: string;
}

@Entity({ tenant: 'shared', allowOrphan: true })
class Archive extends ChangeSetEntity {
    @Property.string()
    name!: string;
}

@Entity({ tenant: 'shared', allowOrphan: true })
class Shelf extends BaseEntity {
    @Property.oneToMany({ target: () => Book, inverseSide: 'shelf' })
    books!: Book[];
}

@Entity({ tenant: 'shared', allowOrphan: true })
class Book extends BaseEntity {
    // the decorator forgotten, which is the one way to name an inverse side that is not there and
    // still compile: `inverseSide` is typed by the keys of the class, not by what it declares
    shelf?: Shelf;
}

@Entity({ tenant: 'shared', allowOrphan: true })
class Customer extends BaseEntity {
    @Property.oneToMany({ target: () => CustomerInvoice, inverseSide: 'customer' })
    invoices!: CustomerInvoice[];
}

@Entity({ allowOrphan: true })
class CustomerInvoice extends BaseEntity {
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    @Property.manyToOne({ target: () => Customer, joinColumn: 'customerId', inverseSide: 'invoices' })
    customer!: Customer;

    @Property.string({ format: 'uuid' })
    customerId!: string;
}

@Entity({ tenant: 'shared', allowOrphan: true })
class Member extends SoftDeleteEntity {
    // removed along with the member by default, and a postal address cannot be marked deleted
    @Property.oneToMany({ target: () => PostalAddress, inverseSide: 'member' })
    addresses!: PostalAddress[];
}

@Entity({ tenant: 'shared', allowOrphan: true })
class PostalAddress extends BaseEntity {
    @Property.manyToOne({ target: () => Member, joinColumn: 'memberId', inverseSide: 'addresses' })
    member!: Member;

    @Property.string({ format: 'uuid' })
    memberId!: string;
}

@Entity({ tenant: 'shared', allowOrphan: true })
class Note extends BaseEntity {
    @Property.string()
    text!: string;
}

/**
 * Declares an entity named like {@link Note}, the way a module of its own would.
 * @returns The entity.
 */
function declareImportedNote(): Newable<BaseEntity> {
    @Entity({ tenant: 'shared', allowOrphan: true, tableName: 'imported_note' })
    class Note extends BaseEntity {
        @Property.string()
        body!: string;
    }
    return Note;
}

const ImportedNote: Newable<BaseEntity> = declareImportedNote();

@Entity({ tenant: 'shared', allowOrphan: true, tableName: 'note' })
class Memo extends BaseEntity {
    @Property.string()
    text!: string;
}

@DataSource({ allowOrphan: true })
class NoteDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, Note];
}

@DataSource({ allowOrphan: true })
class ImportedNoteDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [MigrationEntity, ImportedNote];
}

@DataSource({ allowOrphan: true })
class NoteAndMemoDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, Note, Memo];
}

@DataSource({ allowOrphan: true })
class MemoDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [MigrationEntity, Memo];
}

@DataSource({ allowOrphan: true })
class MemberDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, Member, PostalAddress];
}

@DataSource({ allowOrphan: true })
class CustomerDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, Customer, CustomerInvoice];
}

@DataSource({ allowOrphan: true })
class ShelfDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, Shelf, Book];
}

@DataSource({ allowOrphan: true })
class WithoutChangeSetTablesDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [
        ...defaultTestServerEntities.filter(e => e !== Change && e !== ChangeSet),
        Ledger
    ];
}

@DataSource({ allowOrphan: true })
class LedgerDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, Ledger];
}

@DataSource({ allowOrphan: true })
class ArchiveDataSource extends InMemoryDataSource {
    override readonly entities: Newable<BaseEntity>[] = [MigrationEntity, Change, ChangeSet, Archive];
}

describe('DataSourceService — starting', () => {
    it('refuses a data source that records change sets without Change and ChangeSet, and names all of it', async () => {
        const start: Promise<StartedTestServer> = startTestServer({ dataSources: [WithoutChangeSetTablesDataSource] });

        await expect(start).rejects.toThrow(/WithoutChangeSetTablesDataSource[\S\s]*Ledger[\S\s]*ChangeSet and Change/);
    }, 30000);

    it('refuses a relation whose inverse side the target does not declare, and names it', async () => {
        // on every store, and before any of them is initialized: postgres used to fail building its
        // schema on a property of undefined, and the others only once a query crossed the relation
        const start: Promise<StartedTestServer> = startTestServer({ dataSources: [ShelfDataSource] });

        await expect(start).rejects.toThrow(/ShelfDataSource[\S\s]*Shelf\.books names "shelf", which Book does not declare/);
    }, 30000);

    it('refuses a relation between a tenant\'s entity and a shared one, both ways, and names it', async () => {
        // no write could ever set it: a row only points at rows of its own tenant, and a shared row
        // belongs to none
        const start: Promise<StartedTestServer> = startTestServer({ dataSources: [CustomerDataSource] });

        await expect(start).rejects.toThrow(
            /CustomerDataSource[\S\s]*Customer\.invoices points at CustomerInvoice[\S\s]*CustomerInvoice\.customer points at Customer/
        );
    }, 30000);

    it('refuses an entity that soft deletes, whose rows of a relation removed along with it cannot be, and names it', async () => {
        // soft deleting a member would leave its addresses counted, and deleting them for good would
        // leave nothing to restore
        const start: Promise<StartedTestServer> = startTestServer({ dataSources: [MemberDataSource] });

        await expect(start).rejects.toThrow(/MemberDataSource[\S\s]*Member\.addresses points at PostalAddress/);
    }, 30000);

    it('refuses two entities of the same name, in whichever data sources they are, and names them', async () => {
        // a repository is found by its entity's name, so the second would answer for both
        const start: Promise<StartedTestServer> = startTestServer({ dataSources: [NoteDataSource, ImportedNoteDataSource] });

        await expect(start).rejects.toThrow(/"Note"[\S\s]*NoteDataSource and ImportedNoteDataSource/);
    }, 30000);

    it('refuses two entities of one data source stored in the same table, and names them', async () => {
        const start: Promise<StartedTestServer> = startTestServer({ dataSources: [NoteAndMemoDataSource] });

        await expect(start).rejects.toThrow(/NoteAndMemoDataSource[\S\s]*"note": Note and Memo/);
    }, 30000);

    it('starts with two entities of one table name in different data sources', async () => {
        // each data source is a store of its own, so the names never meet
        const server: StartedTestServer = await startTestServer({ dataSources: [NoteDataSource, MemoDataSource] });
        await server.shutdown();
    }, 30000);

    it('starts without Change and ChangeSet when nothing records change sets', async () => {
        await expect(startAndStopTestServerWithout([Change, ChangeSet])).resolves.toBeUndefined();
    }, 30000);

    it('keeps the change sets of each data source in that data source', async () => {
        const server: StartedTestServer = await startTestServer({ dataSources: [LedgerDataSource, ArchiveDataSource] });
        try {
            const ledger: Ledger = await inject(repositoryTokenFor(Ledger)).create({ name: 'ledger' });
            const archive: Archive = await inject(repositoryTokenFor(Archive)).create({ name: 'archive' });

            const ledgerChangeSets: ChangeSet[] = await inject(repositoryTokenFor(ChangeSet, LedgerDataSource)).findAll({});
            const archiveChangeSets: ChangeSet[] = await inject(repositoryTokenFor(ChangeSet, ArchiveDataSource)).findAll({});
            expect(ledgerChangeSets.map(c => c.changeSetEntityId)).toEqual([ledger.id]);
            expect(archiveChangeSets.map(c => c.changeSetEntityId)).toEqual([archive.id]);
        }
        finally {
            await server.shutdown();
        }
    }, 30000);
});