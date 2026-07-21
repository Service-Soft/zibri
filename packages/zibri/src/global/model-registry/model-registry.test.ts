import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { type Relation } from 'typeorm';

import { DefaultDescriptor } from './default-descriptor';
import { ModelRegistry } from './model.registry';
import { createTestDataSource, defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { AesGcmEncryptionStrategy } from '../../auth/encryption/strategies/aes-gcm.encryption-strategy';
import { type HashServiceInterface } from '../../auth/hash/hash-service.interface';
import { type HashString } from '../../auth/hash/hash.utilities';
import { Repository } from '../../data-source/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { OmitClass } from '../../entity/omit-class.model';

// This entity exercises all four model-registry descriptors together (exclude, default, hash,
// encryption), created/read through a real repository. These descriptors are wired as the default
// beforeSave/beforeReturn hooks applied to every repository (see hooks.default.ts), so a real
// repository round trip is the only way to catch a break in how they actually compose — a unit test
// per descriptor could all pass while, say, exclusion still ran before defaults were filled in.
@Entity()
class ModelRegistryTestItem extends BaseEntity {
    @Property.string()
    plain!: string;

    @Property.string({ default: 'the default value' })
    withDefault!: string;

    @Property.string({ exclude: true })
    secret!: string;

    @Property.string({ hash: true })
    password!: HashString;

    @Property.string({ encryption: true })
    sensitive!: string;
}

// password is a plain string going in (hashed by the beforeSave hook) but a branded HashString coming
// back out, so the create data needs its own un-hashed, un-branded type — same split as
// JwtCredentials/JwtCredentialsCreateData in src/auth/strategies/jwt/jwt-credentials.model.ts.
class ModelRegistryTestItemCreateData extends OmitClass(ModelRegistryTestItem, ['id', 'withDefault', 'password']) {
    @Property.string({ required: false })
    withDefault?: string;

    @Property.string({ hash: true })
    password!: string;
}

// A plain (non-entity) embedded class whose own default/exclude/encryption properties must propagate
// through a parent entity's `nestedKeys`, both for a single embedded object and for an array of them.
class NestedSecret {
    @Property.string({ default: 'nested-default', required: false })
    withDefault?: string;

    @Property.string({ encryption: true })
    nestedSensitive!: string;

    @Property.string({ exclude: true })
    nestedSecret!: string;
}

@Entity()
class PropagationTestItem extends BaseEntity {
    @Property.string()
    plain!: string;

    @Property.object({ cls: () => NestedSecret, required: false })
    nested?: NestedSecret;

    @Property.array({ items: { type: 'object', cls: () => NestedSecret }, required: false })
    nestedArray?: NestedSecret[];
}

type DynamicOptionsCreateData = { shouldEncrypt: boolean, conditionallySensitive: string };

@Entity()
class DynamicOptionsTestItem extends BaseEntity {
    @Property.boolean()
    shouldEncrypt!: boolean;

    // encrypt/decrypt are independent options — a caller conditionally skipping encryption on save must
    // symmetrically skip decryption on read too, or a plaintext value ends up being run through decrypt().
    @Property.string({
        encryption: (data: DynamicOptionsCreateData) => ({
            strategy: AesGcmEncryptionStrategy,
            encrypt: data.shouldEncrypt,
            decrypt: data.shouldEncrypt
        })
    })
    conditionallySensitive!: string;

    @Property.string({
        default: (data: DynamicOptionsCreateData) => `computed-${data.shouldEncrypt ? 'yes' : 'no'}`,
        required: false
    })
    computedDefault?: string;
}

// All @Entity()-decorated classes in this file must share one data source: validateEntitiesRegistered
// checks every @Entity() seen at module-load time against whatever data source(s) are actually passed
// to startTestServer, regardless of which describe block declared them — so one server for the whole
// file (rather than one per describe block) is required, not just an optimization.
let server: StartedTestServer;
let modelRegistryTestItemRepo: Repository<ModelRegistryTestItem, ModelRegistryTestItemCreateData>;
let propagationTestItemRepo: Repository<PropagationTestItem>;
let dynamicOptionsTestItemRepo: Repository<DynamicOptionsTestItem>;
let hashService: HashServiceInterface;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [
            createTestDataSource({
                entities: [...defaultTestServerEntities, ModelRegistryTestItem, PropagationTestItem, DynamicOptionsTestItem]
            })
        ]
    });
    modelRegistryTestItemRepo = inject(repositoryTokenFor(ModelRegistryTestItem));
    propagationTestItemRepo = inject(repositoryTokenFor(PropagationTestItem));
    dynamicOptionsTestItemRepo = inject(repositoryTokenFor(DynamicOptionsTestItem));
    hashService = inject(ZIBRI_DI_TOKENS.HASH_SERVICE);
}, 15000);

afterAll(async () => {
    await server?.shutdown();
}, 15000);

describe('model-registry descriptors — real repository round trip', () => {
    let repo: Repository<ModelRegistryTestItem, ModelRegistryTestItemCreateData>;

    beforeAll(() => {
        repo = modelRegistryTestItemRepo;
    });

    it('fills in the default value when omitted on create', async () => {
        const created: ModelRegistryTestItem = await repo.create({
            plain: 'plain value',
            secret: 'top secret',
            password: 'my-password',
            sensitive: 'sensitive data'
        });

        expect(created.withDefault).toBe('the default value');
    });

    it('keeps an explicitly provided value instead of overriding it with the default', async () => {
        const created: ModelRegistryTestItem = await repo.create({
            plain: 'plain value',
            withDefault: 'explicit value',
            secret: 'top secret',
            password: 'my-password',
            sensitive: 'sensitive data'
        });

        expect(created.withDefault).toBe('explicit value');
    });

    it('hashes the password so it is never stored or returned as plaintext, but still verifies correctly', async () => {
        const created: ModelRegistryTestItem = await repo.create({
            plain: 'plain value',
            secret: 'top secret',
            password: 'my-password',
            sensitive: 'sensitive data'
        });

        expect(created.password).not.toBe('my-password');
        await expect(hashService.equal('my-password', created.password)).resolves.toBe(true);
        await expect(hashService.equal('wrong-password', created.password)).resolves.toBe(false);

        const found: ModelRegistryTestItem = await repo.findById(created.id);
        expect(found.password).toBe(created.password);
    });

    it('encrypts the sensitive field at rest but transparently decrypts it back on read', async () => {
        const created: ModelRegistryTestItem = await repo.create({
            plain: 'plain value',
            secret: 'top secret',
            password: 'my-password',
            sensitive: 'sensitive data'
        });

        // decrypted immediately on create() since the beforeReturn hook also runs on the create response
        expect(created.sensitive).toBe('sensitive data');

        const found: ModelRegistryTestItem = await repo.findById(created.id);
        expect(found.sensitive).toBe('sensitive data');
    });

    it('hides the excluded field from JSON serialization but keeps it queryable through the repository', async () => {
        const created: ModelRegistryTestItem = await repo.create({
            plain: 'plain value',
            secret: 'top secret',
            password: 'my-password',
            sensitive: 'sensitive data'
        });

        const found: ModelRegistryTestItem = await repo.findById(created.id);

        expect(JSON.stringify(found)).not.toContain('top secret');
        expect(Object.keys(found)).not.toContain('secret');
        // the value is still retrievable directly, it's just hidden from enumeration/serialization
        expect(found.secret).toBe('top secret');
    });
});

describe('model-registry descriptors — nested object and array propagation', () => {
    let repo: Repository<PropagationTestItem>;

    beforeAll(() => {
        repo = propagationTestItemRepo;
    });

    it('fills in a default inside a nested embedded object', async () => {
        const created: PropagationTestItem = await repo.create({
            plain: 'x',
            nested: { nestedSensitive: 'a', nestedSecret: 'b' }
        });

        expect(created.nested?.withDefault).toBe('nested-default');
    });

    it('fills in a default inside each item of a nested array, keeping explicit values as-is', async () => {
        const created: PropagationTestItem = await repo.create({
            plain: 'x',
            nestedArray: [
                { nestedSensitive: 'a', nestedSecret: 'b' },
                { nestedSensitive: 'c', nestedSecret: 'd', withDefault: 'explicit' }
            ]
        });

        expect(created.nestedArray?.[0]?.withDefault).toBe('nested-default');
        expect(created.nestedArray?.[1]?.withDefault).toBe('explicit');
    });

    it('encrypts and transparently decrypts a field inside a nested embedded object and array items', async () => {
        const created: PropagationTestItem = await repo.create({
            plain: 'x',
            nested: { nestedSensitive: 'nested secret value', nestedSecret: 'b' },
            nestedArray: [{ nestedSensitive: 'array secret value', nestedSecret: 'd' }]
        });

        expect(created.nested?.nestedSensitive).toBe('nested secret value');
        expect(created.nestedArray?.[0]?.nestedSensitive).toBe('array secret value');

        const found: PropagationTestItem = await repo.findById(created.id);
        expect(found.nested?.nestedSensitive).toBe('nested secret value');
        expect(found.nestedArray?.[0]?.nestedSensitive).toBe('array secret value');
    });

    it('hides an excluded field inside a nested embedded object and array items from serialization', async () => {
        const created: PropagationTestItem = await repo.create({
            plain: 'x',
            nested: { nestedSensitive: 'a', nestedSecret: 'top secret' },
            nestedArray: [{ nestedSensitive: 'c', nestedSecret: 'also secret' }]
        });

        const found: PropagationTestItem = await repo.findById(created.id);

        expect(JSON.stringify(found)).not.toContain('top secret');
        expect(JSON.stringify(found)).not.toContain('also secret');
        expect(Object.keys(found.nested ?? {})).not.toContain('nestedSecret');
        // still directly retrievable, just hidden from enumeration/serialization
        expect(found.nested?.nestedSecret).toBe('top secret');
        expect(found.nestedArray?.[0]?.nestedSecret).toBe('also secret');
    });
});

describe('model-registry descriptors — function-based dynamic options', () => {
    let repo: Repository<DynamicOptionsTestItem>;

    beforeAll(() => {
        repo = dynamicOptionsTestItemRepo;
    });

    it('computes a default from a function evaluated against the create data', async () => {
        const created: DynamicOptionsTestItem = await repo.create({ shouldEncrypt: true, conditionallySensitive: 'x' });
        expect(created.computedDefault).toBe('computed-yes');

        const created2: DynamicOptionsTestItem = await repo.create({ shouldEncrypt: false, conditionallySensitive: 'x' });
        expect(created2.computedDefault).toBe('computed-no');
    });

    it('encrypts when the encryption function resolves encrypt: true for this record', async () => {
        const created: DynamicOptionsTestItem = await repo.create({ shouldEncrypt: true, conditionallySensitive: 'secret value' });
        // transparently decrypted immediately (beforeReturn also runs on the create response)
        expect(created.conditionallySensitive).toBe('secret value');

        const found: DynamicOptionsTestItem = await repo.findById(created.id);
        expect(found.conditionallySensitive).toBe('secret value');
    });

    it('skips encryption entirely when the encryption function resolves encrypt: false for this record', async () => {
        const created: DynamicOptionsTestItem = await repo.create({ shouldEncrypt: false, conditionallySensitive: 'plain value' });
        expect(created.conditionallySensitive).toBe('plain value');

        const found: DynamicOptionsTestItem = await repo.findById(created.id);
        // still readable as plain text — it was never encrypted, so there's nothing to decrypt
        expect(found.conditionallySensitive).toBe('plain value');
    });
});

// A genuine 3-hop relation cycle (A -> B -> C -> A). Deliberately not @Entity()-decorated/registered on a data
// source: the descriptors only read @Property metadata off the class, they don't need a real schema for this.
class RegNodeC extends BaseEntity {
    @Property.string({ default: 'c-default' })
    name!: string;

    @Property.hasOne({ target: () => RegNodeA, inverseSide: 'next' })
    next!: Relation<RegNodeA>;
}

class RegNodeB extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.hasOne({ target: () => RegNodeC, inverseSide: 'next' })
    next!: Relation<RegNodeC>;
}

class RegNodeA extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.hasOne({ target: () => RegNodeB, inverseSide: 'next' })
    next!: Relation<RegNodeB>;
}

describe('model-registry descriptors — genuine multi-hop relation cycles', () => {
    it('resolves ModelRegistry.get() for a cyclic relation graph (A -> B -> C -> A) without a stack overflow', () => {
        expect(() => ModelRegistry.get(RegNodeA)).not.toThrow();
    });

    it('still propagates a default nested two relations away, despite the cycle further down the chain', () => {
        const defaultDescriptor: DefaultDescriptor = ModelRegistry.get(RegNodeA).defaultDescriptor;
        // RegNodeA -> next (RegNodeB) -> next (RegNodeC, which has a real default on `name`)
        expect(defaultDescriptor.nestedKeys.has('next')).toBe(true);
        const nodeBDefaults: DefaultDescriptor | undefined = defaultDescriptor.nestedKeys.get('next');
        expect(nodeBDefaults?.nestedKeys.has('next')).toBe(true);
        const nodeCDefaults: DefaultDescriptor | undefined = nodeBDefaults?.nestedKeys.get('next');
        expect(nodeCDefaults?.keys.get('name')).toBe('c-default');
    });
});