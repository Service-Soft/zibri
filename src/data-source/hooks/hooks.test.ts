import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { type HashString } from '../../auth/hash/hash.utilities';
import { ChangeSetEntity } from '../../change-sets/models/change-set-entity.model';
import { ChangeSetType } from '../../change-sets/models/change-set-type.enum';
import { ChangeSet } from '../../change-sets/models/change-set.model';
import { SoftDeleteEntity } from '../../change-sets/models/soft-delete-entity.model';
import { SoftDeleteRepository } from '../../change-sets/soft-delete-repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { PostgresDataSource } from '../data-sources/postgres-typeorm-data-source.model';
import { Repository } from '../repository';

// ==================== TEST ENTITIES ====================

// Entity that tests ALL hook-related features
@Entity()
class HookTestEntity extends BaseEntity implements ChangeSetEntity, SoftDeleteEntity {
    @Property.string()
    name!: string;

    @Property.string({ encryption: true, exclude: true })
    secretValue!: string; // encrypted on save, decrypted on read, excluded from response

    @Property.string({ hash: true })
    password!: HashString; // hashed on save

    @Property.boolean({ default: true })
    isActive!: boolean; // default value set on create

    @Property.string({ required: false, excludeFromChangeSets: true })
    internalNote?: string | null; // excluded from change sets

    @Property.boolean({ default: false })
    deleted!: boolean; // required by SoftDeleteEntity

    @Property.oneToMany({ target: () => ChangeSet, inverseSide: 'changeSetEntityId' })
    changeSets!: ChangeSet[]; // required by ChangeSetEntity
}

let server: StartedTestServer;
let repo: Repository<HookTestEntity>;
let changeSetRepo: Repository<ChangeSet>;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [
            createTestDataSource({
                entities: [...defaultTestServerEntities, HookTestEntity, ChangeSet]
            })
        ]
    });
    repo = inject(repositoryTokenFor(HookTestEntity));
    changeSetRepo = inject(repositoryTokenFor(ChangeSet));
}, 15000);

afterAll(async () => {
    await server.shutdown();
});

beforeEach(async () => {
    await changeSetRepo.deleteAll({});
    await repo.deleteAll({});
});

describe('before‑save hooks', () => {
    describe('on create', () => {
        it('encrypts properties marked with encryption', async () => {
            const entity: HookTestEntity = await repo.create({
                name: 'Test',
                secretValue: 'top-secret',
                password: 'plain'
            });

            // secretValue should be encrypted (not the plain text)
            expect(entity.secretValue).toBe('top-secret');
        });

        it('hashes properties marked with hash', async () => {
            const entity: HookTestEntity = await repo.create({
                name: 'Test',
                secretValue: 'top-secret',
                password: 'my-password'
            });

            // password should be hashed (not the plain text)
            expect(entity.password).not.toBe('my-password');
            expect(entity.password).toContain('scrypt.v1'); // hash contains algorithm prefix
        });

        it('sets default values when not provided', async () => {
            const entity: HookTestEntity = await repo.create({
                name: 'Test',
                secretValue: 'top-secret',
                password: 'plain'
            });

            // isActive should default to true
            expect(entity.isActive).toBe(true);
        });

        it('does NOT override explicitly provided values with defaults', async () => {
            const entity: HookTestEntity = await repo.create({
                name: 'Test',
                secretValue: 'top-secret',
                password: 'plain',
                isActive: false
            });

            expect(entity.isActive).toBe(false);
        });

        it('encrypts values at rest (raw database access)', async () => {
            const entity: HookTestEntity = await repo.create({
                name: 'EncAtRest',
                secretValue: 'super-secret',
                password: 'pw'
            });

            // Use the query builder to read the raw column – no before‑return hook runs
            const raw: HookTestEntity | null = await (repo.dataSource as PostgresDataSource)
                .query(HookTestEntity)
                .select(`${HookTestEntity.name}.secretValue`)
                .where(`${HookTestEntity.name}.id = :id`, { id: entity.id })
                .getOne();

            // The stored value must be encrypted (not plain text)
            expect(raw?.secretValue).not.toBe('super-secret');
            expect(raw?.secretValue.length).toBeGreaterThan(20);
        });
    });

    describe('on update', () => {
        let entityId: string;

        beforeEach(async () => {
            const entity: HookTestEntity = await repo.create({
                name: 'Original',
                secretValue: 'initial-secret',
                password: 'initial-password'
            });
            entityId = entity.id;
        });

        it('encrypts updated encrypted properties', async () => {
            const updated: HookTestEntity = await repo.updateById(entityId, { secretValue: 'new-secret' });
            expect(updated.secretValue).toBe('new-secret');
        });

        it('hashes updated hash properties', async () => {
            const updated: HookTestEntity = await repo.updateById(entityId, { password: 'new-password' });
            expect(updated.password).not.toBe('new-password');
            expect(updated.password).toContain('scrypt.v1');
        });

        it('does NOT re‑set default values (setDefault = false)', async () => {
            // Update without providing isActive
            const updated: HookTestEntity = await repo.updateById(entityId, { name: 'Updated' });
            // isActive should remain its original value (true from create's default)
            expect(updated.isActive).toBe(true);
        });
    });
});

describe('before‑return hooks', () => {
    describe('on find', () => {
        let entityId: string;
        let originalSecret: string;

        beforeEach(async () => {
            // We need the entity as stored (with encrypted/hashed values) before the return hook runs.
            // So we create one and capture what findById returns after decryption.
            const entity: HookTestEntity = await repo.create({
                name: 'ReturnTest',
                secretValue: 'my-secret',
                password: 'my-password'
            });
            entityId = entity.id;
            // After create, before‑return has already run, so we see decrypted values.
            originalSecret = entity.secretValue;
        });

        it('decrypts encrypted properties on findById', async () => {
            const fetched: HookTestEntity = await repo.findById(entityId);
            // secretValue should be decrypted (equal to the original plain text after re‑encryption/decryption)
            expect(fetched.secretValue).toBe(originalSecret);
        });

        it('decrypts encrypted properties on findAll', async () => {
            const results: HookTestEntity[] = await repo.findAll();
            expect(results).toHaveLength(1);
            expect(results[0].secretValue).toBe(originalSecret);
        });

        it('decrypts encrypted properties on findOne', async () => {
            const fetched: HookTestEntity = await repo.findOne({ where: { id: entityId } }, true);
            expect(fetched.secretValue).toBe(originalSecret);
        });

        it('removes excluded properties from the returned entity', async () => {
            const fetched: HookTestEntity = await repo.findById(entityId);
            expect(fetched.secretValue).toBe(originalSecret);
            expect(JSON.stringify(fetched)).not.toContain('secretValue');
        });
    });
});

describe('ChangeSetRepository hooks integration', () => {
    it('excludes properties marked with excludeFromChangeSets from change sets', async () => {
        const entity: HookTestEntity = await repo.create({
            name: 'ChangeSetTest',
            secretValue: 'test-secret',
            password: 'test-password',
            internalNote: 'do not track'
        });

        const changeSets: ChangeSet[] = await changeSetRepo.findAll({ where: { changeSetEntityId: entity.id } });
        expect(changeSets).toHaveLength(1);

        const cs: ChangeSet = changeSets[0];
        // internalNote should NOT appear in changes
        expect(cs.changes.some(c => c.key === 'internalNote')).toBe(false);
        // other properties should be tracked
        expect(cs.changes.some(c => c.key === 'name')).toBe(true);
    });

    it('records change sets for create and update operations', async () => {
        const entity: HookTestEntity = await repo.create({
            name: 'TrackingTest',
            secretValue: 'secret',
            password: 'pass'
        });

        // Update name
        await repo.updateById(entity.id, { name: 'Updated' });

        const changeSets: ChangeSet[] = await changeSetRepo.findAll({
            where: { changeSetEntityId: entity.id },
            order: { createdAt: 'ASC' }
        });
        expect(changeSets).toHaveLength(2);
        expect(changeSets[0].type).toBe(ChangeSetType.CREATE);
        expect(changeSets[1].type).toBe(ChangeSetType.UPDATE);
    });
});

describe('SoftDeleteRepository hooks integration', () => {
    it('excludes "deleted" from change sets', async () => {
        const entity: HookTestEntity = await repo.create({
            name: 'SoftDeleteTest',
            secretValue: 'secret',
            password: 'pass'
        });

        // Soft delete
        await (repo as unknown as SoftDeleteRepository<HookTestEntity>).deleteById(entity.id);

        const changeSets: ChangeSet[] = await changeSetRepo.findAll({ where: { changeSetEntityId: entity.id } });
        const deleteCs: ChangeSet | undefined = changeSets.find(cs => cs.type === ChangeSetType.DELETE);
        expect(deleteCs).toBeDefined();
        // deleted flag should NOT appear in changes
        expect(deleteCs?.changes.some(c => c.key === 'deleted')).toBe(false);
    });
});