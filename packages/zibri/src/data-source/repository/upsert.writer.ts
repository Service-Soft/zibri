import { PreparedUpsert } from './prepared-upsert.model';
import { ReferenceValidator } from './reference.validator';
import { UpsertWriterContext } from './upsert-writer-context.model';
import { AlsUtilities } from '../../context/als.utilities';
import { BaseEntity } from '../../entity/base-entity.model';
import { EntityMetadata } from '../../entity/decorators/entity.decorator';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { denyAll, type DenyAll } from '../../entity/models/entity-scope.model';
import { Relation } from '../../entity/models/relation.enum';
import { ConflictError } from '../../error-handling/errors/conflict.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { boundEncryptionProperties } from '../../global/model-registry/encrypt-encryption-properties.function';
import { $ts } from '../../localization/translate.function';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { WhereFilterEvaluator } from '../data-sources/where-converter/where-filter.evaluator';
import { RepositoryDriverInterface } from '../driver/repository-driver.interface';
import { SaveOperation } from '../hooks/before-save';
import { AtomicUpdate } from '../models/atomic-update.model';
import { BaseRepositoryOptions } from '../models/options/base-repository-options.model';
import { type RelatedNarrowing } from '../models/related-narrowing.model';
import { UpsertRow } from '../models/upsert-row.model';
import { Where, WhereFilter } from '../models/where/where-filter.model';
import { resolveOutOfScopeError } from '../scopes/resolve-out-of-scope-error.function';
import { ScopedWhere, ScopeWhereUtilities } from '../scopes/scope-where.utilities';
import { TenantOwnership, TenantUtilities } from '../tenancy/tenant.utilities';
import { type RepositoryTransaction } from '../transaction/repository-transaction.type';
import { TransactionUtilities } from '../transaction/transaction.utilities';
import { UniqueConstraintViolationError } from '../unique-constraint-violation.error';
import { UpsertIdentityUtilities } from '../upsert-identity.utilities';
import { validateWriteIsNotBlind } from '../validate-write-is-not-blind.function';
import { dropImpossibleConditions } from '../where/drop-impossible-conditions.function';
import { WriteDataUtilities } from '../write-data.utilities';

/**
 * What the conflict path of an upsert row sets, prepared the way an update prepares its values.
 */
type PreparedConflictSets<T extends BaseEntity> = {
    /**
     * The changes as the store is handed them, every value set already encrypted or hashed.
     */
    onConflict: AtomicUpdate<T>,
    /**
     * The values left out of them because they are bound to their row, or undefined when none are.
     */
    bound: Record<string, unknown> | undefined
};

/**
 * The property types that name another entity rather than a value stored in the row.
 */
const RELATION_TYPES: Set<string> = new Set(Object.values(Relation));

/**
 * Prepares the rows of an upsert for the store and hands them to it: the write half of
 * `Repository.upsert` and `Repository.upsertAll`, with the repository's hooks and reads taken from it.
 */
export class UpsertWriter<T extends BaseEntity, CreateData extends DeepPartial<T>> {
    /**
     * Answers whether a row satisfies a filter without asking the store.
     */
    private readonly evaluator: WhereFilterEvaluator = new WhereFilterEvaluator();

    constructor(
        private readonly entityClass: Newable<T>,
        private readonly entityMetadata: EntityMetadata<T>,
        private readonly driver: RepositoryDriverInterface<T, RepositoryTransaction>,
        private readonly references: ReferenceValidator<T>,
        private readonly context: UpsertWriterContext<T>
    ) {}

    /**
     * The properties an upsert's identity is resolved by, the tenant included.
     *
     * Every unique of a tenant's entity is led by the tenant, so the identity a caller names is unique
     * only together with it - and the row it names is the one of the tenant the call acts in. Rows of
     * no tenant hold no value to lead with, and are unique among themselves by the identity alone.
     * @param identity - The properties the caller named.
     * @param creates - The rows being upserted, as the caller passed them.
     * @returns Those properties, with the tenant property in front when the rows belong to a tenant.
     * @throws When some of the rows belong to a tenant and some to none.
     */
    resolveConflictKeys(identity: string[], creates: CreateData[]): string[] {
        const ownership: TenantOwnership | undefined = TenantUtilities.resolveOwnership(this.entityClass, this.entityMetadata);
        if (ownership == undefined || identity.includes(ownership.property)) {
            return identity;
        }
        const led: string[] = [ownership.property, ...identity];
        if (ownership.required) {
            return led;
        }
        // as each row will be written: a row naming no tenant gets the active one, see assignTenant
        const ofTenant: boolean[] = creates.map(
            create => (TenantUtilities.resolveTenantOf(create, this.entityClass) ?? AlsUtilities.getCurrentTenant()) != undefined
        );
        if (ofTenant.every(Boolean)) {
            return led;
        }
        if (!ofTenant.some(Boolean)) {
            return identity;
        }
        throw new InternalError([
            `This upsert on "${this.entityClass.name}" holds rows of a tenant and rows of no tenant.`,
            'Each of the two is unique by a key of its own, so upsert them in separate calls.'
        ]);
    }

    /**
     * Prepares one row of an upsert for the store: copied, given an id, passed through the save hooks
     * and judged against the scope as far as it can be before anything is written.
     * @param identity - The properties identifying the row.
     * @param row - The row as the caller passed it.
     * @param scope - The scope the caller is restricted to.
     * @param acrossTenants - Whether or not the upsert should happen across tenants.
     * @returns The row as it is handed to the store, and what is left to judge once it is written.
     * @throws When the row lands outside the scope, or its identity cannot be read off it.
     */
    async prepare(
        identity: string[],
        row: UpsertRow<T, CreateData>,
        scope: Where<T> | DenyAll | undefined,
        acrossTenants: boolean | undefined
    ): Promise<PreparedUpsert<T>> {
        // the conflict path is an update, and is refused as a blind one before anything is written or
        // any hook runs. Only what it sets: an increment adds to whatever is stored, so a write that
        // landed in between is kept rather than lost
        validateWriteIsNotBlind(this.entityClass, this.resolveConflictSets(row.onConflict), row.where);

        // a copy, for the reason `create` takes one. An id the caller chose is kept either way -
        // `assignId` fills one in only when there is none - what changes is that a *generated* id
        // lands here rather than on the object the caller still holds. The sequence a create
        // prepares its rows with, up to the scope, which is judged against the one resolved for the
        // whole batch here
        const own: CreateData = WriteDataUtilities.copy(row.create, this.entityClass);
        WriteDataUtilities.assignId(own, this.entityClass);
        TenantUtilities.assignTenant(own, this.entityClass, this.entityMetadata, acrossTenants);
        WriteDataUtilities.writeUuidsInLowerCase(own, this.entityClass);
        await this.context.beforeSave(own, SaveOperation.CREATE);
        this.context.validateWithinScope(own, 'every', scope);
        const onConflict: AtomicUpdate<T> = this.resolveOnConflictInLowerCase(row.onConflict);

        // the conflict path is an update of the row the identity names, and is judged as one - on the
        // columns it writes that the scope reads. A value it sets is known now, so it is judged now,
        // before anything is written
        const set: Record<string, unknown> = {};
        const incremented: string[] = [];
        for (const [key, change] of ObjectUtilities.entries(onConflict)) {
            if (change == undefined || !ScopeWhereUtilities.isReadByScope(scope, key)) {
                continue;
            }
            if ('increment' in change) {
                incremented.push(key);
                continue;
            }
            set[key] = change.set;
        }
        this.context.validateWithinScope(Object.assign({ ...own }, set), Object.keys(set), scope);

        // before the driver, so that both stores answer the same way. Postgres builds one statement
        // out of the create data and had no column to put a relation in; valkey resolves a to-one
        // relation to its foreign key while saving and quietly accepted what postgres threw on
        this.writeRelationsAsForeignKeys(own);

        // after the scope has judged the values as they were given, since what it compares is what the
        // caller said rather than its ciphertext
        const sets: PreparedConflictSets<T> = await this.prepareConflictSets(identity, own, onConflict);
        const prepared: UpsertRow<T> = { create: own, onConflict: sets.onConflict, where: this.resolveConflictCondition(row.where) };
        this.validateIdentity(identity, prepared);
        return { row: prepared, incremented, bound: sets.bound };
    }

    /**
     * Hands prepared upsert rows to the store, in a transaction when anything about them can only be
     * judged once they are written.
     * @param identity - The properties identifying each row.
     * @param prepared - The rows, as {@link prepare} left them.
     * @param scope - The scope the caller is restricted to.
     * @param options - The caller's options, holding their transaction if they had one.
     * @returns The written rows, in the order they were given.
     * @throws When a row lands outside the scope.
     */
    async run(
        identity: string[],
        prepared: PreparedUpsert<T>[],
        scope: Where<T> | DenyAll | undefined,
        options: BaseRepositoryOptions<T> | undefined
    ): Promise<T[]> {
        const rows: UpsertRow<T>[] = prepared.map(p => p.row);
        const reachable: Where<T> | undefined = this.resolveReachable(identity, rows, scope);
        // what the scope and the rows' own conditions reach through relations, judged over the rows
        // the caller may see of them
        const related: RelatedNarrowing | undefined = await this.context.resolveRelated(
            [...ScopeWhereUtilities.branchesOf(reachable), ...rows.flatMap(row => ScopeWhereUtilities.branchesOf(row.where))],
            options
        );
        // the conflicting row holds the same identity, the tenant included, so both paths point a row
        // of the create data's tenant at whatever either of them names
        await this.references.validate(
            rows.map(row => ({
                data: Object.assign({ ...row.create }, this.resolveConflictSets(row.onConflict)),
                rowTenant: TenantUtilities.resolveTenantOf(row.create, this.entityClass)
            })),
            options
        );

        // an amount a row adds is not known until it lands, since what it adds to is whatever is
        // stored - so that half is judged on the written row, in a transaction that rolls it back
        // when it left the caller's reach. And a row the store refuses can come after rows it has
        // already written, so a restricted batch of several is held together the same way. Inside
        // the caller's own transaction it stays until they roll back on the error. Only a scope
        // keyed on a counter, or a scoped batch, pays for the transaction
        const judgedAfter: boolean = prepared.some(p => p.incremented.length);
        // a row's own condition refuses it the way the scope does, so a batch holding one is held
        // together the same way
        const refusedPartway: boolean = (reachable != undefined || rows.some(row => row.where != undefined)) && rows.length > 1;
        // a value bound to its row is written after the row, and the two are one write
        const writtenAfter: boolean = prepared.some(p => p.bound != undefined);
        try {
            if (!judgedAfter && !refusedPartway && !writtenAfter) {
                return await this.driver.upsert(identity, rows, TransactionUtilities.resolveWriteTransaction(options), reachable, related);
            }
            return await this.context.inTransaction(options, async transaction => {
                const written: T[] = await this.driver.upsert(identity, rows, transaction, reachable, related);
                await this.writeBoundConflictSets(prepared, written, transaction);
                for (const [i, entity] of written.entries()) {
                    const incremented: string[] = prepared[i]?.incremented ?? [];
                    if (incremented.length) {
                        this.context.validateWithinScope(entity, incremented, scope);
                    }
                }
                return written;
            });
        }
        catch (error) {
            await this.validateConditionsHeld(error, identity, rows, options);
            throw error;
        }
    }

    /**
     * Prepares what the conflict path of an upsert row sets the way an update prepares its values:
     * through the save hook, so that a value is encrypted and hashed as on any other write.
     *
     * A value encrypted bound to its row is encrypted for the row it lands in, which on the conflict
     * path is the row already holding the identity - not known until the row is written. Those are
     * left out here and written by `writeBoundConflictSets` once it is.
     * @param identity - The properties identifying the row.
     * @param create - The row to insert, as it is handed to the store.
     * @param onConflict - The changes as the caller gave them.
     * @returns The changes as the store is handed them, and the values left out of them.
     */
    private async prepareConflictSets(
        identity: string[],
        create: CreateData,
        onConflict: AtomicUpdate<T>
    ): Promise<PreparedConflictSets<T>> {
        const sets: Record<string, unknown> = this.resolveConflictSets(onConflict);
        if (!Object.keys(sets).length) {
            return { onConflict, bound: undefined };
        }
        const boundKeys: Set<string> = new Set(
            (await boundEncryptionProperties(sets, this.entityClass)).map(path => path.split('.')[0] ?? path)
        );

        // a bare instance of the entity rather than an object literal, so the hook is handed what it
        // is typed for and nothing besides the values set. Copied, for the reason `create` copies
        // eslint-disable-next-line typescript/no-unsafe-assignment, typescript/no-unsafe-argument
        const unbound: T = Object.assign(Object.create(this.entityClass.prototype), WriteDataUtilities.copy(sets, this.entityClass));
        for (const key of boundKeys) {
            Reflect.deleteProperty(unbound, key);
        }
        await this.context.beforeSave(unbound, SaveOperation.UPDATE);

        const res: AtomicUpdate<T> = { ...onConflict };
        const bound: Record<string, unknown> = {};
        for (const key of Object.keys(sets)) {
            if (boundKeys.has(key)) {
                bound[key] = sets[key];
                Reflect.deleteProperty(res, key);
                continue;
            }
            Reflect.set(res, key, { set: Reflect.get(unbound, key) });
        }
        // a store only takes a conflict path that changes something. Setting a property of the
        // identity to the value it holds changes nothing, and keeps the path for the bound values
        const [first] = identity;
        if (!Object.values(res).some(change => change != undefined) && first != undefined) {
            Reflect.set(res, first, { set: Reflect.get(create, first) });
        }
        return { onConflict: res, bound: boundKeys.size ? bound : undefined };
    }

    /**
     * Writes the values the conflict path of an upsert sets that are encrypted bound to their row, to
     * the rows the conflict path ran on - now that it is known which rows those are.
     *
     * Part of the transaction the upsert ran in. A `set` overwrites whatever is stored, so writing it
     * after the rest of the change loses nothing the single statement kept.
     * @param prepared - The rows as they were prepared.
     * @param written - The rows the store wrote, in the same order. Replaced by what this writes.
     * @param transaction - The transaction the upsert runs in.
     */
    private async writeBoundConflictSets(prepared: PreparedUpsert<T>[], written: T[], transaction: RepositoryTransaction): Promise<void> {
        const rows: T[] = [];
        for (const [i, p] of prepared.entries()) {
            const entity: T | undefined = written[i];
            // the conflict path ran when the row written is not the one the insert would have made
            if (p.bound == undefined || entity == undefined || entity.id === Reflect.get(p.row.create, 'id')) {
                continue;
            }
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const single: T = Object.assign(
                // eslint-disable-next-line typescript/no-unsafe-argument
                Object.create(this.entityClass.prototype),
                WriteDataUtilities.copy(p.bound, this.entityClass),
                { id: entity.id }
            );
            await this.context.beforeSave(single, SaveOperation.UPDATE);
            rows.push(single);
        }
        if (!rows.length) {
            return;
        }
        const updated: T[] = await this.driver.updateEach(rows, { id: { oneOf: rows.map(r => r.id) } } as Where<T>, transaction);
        for (const entity of updated) {
            const at: number = written.findIndex(w => w.id === entity.id);
            if (at !== -1) {
                written[at] = entity;
            }
        }
    }

    /**
     * The condition the conflict path of an upsert row is applied under, as the store is handed it.
     * @param where - The condition the caller gave, if any.
     * @returns The condition, narrowed to what a row can hold, or undefined when it asks nothing of
     * the row.
     */
    private resolveConflictCondition(where: Where<T> | undefined): Where<T> | undefined {
        const branches: WhereFilter<T>[] = ScopeWhereUtilities.branchesOf(where);
        // a property named with no value is how a caller says they overwrite regardless, so a branch
        // naming nothing else asks nothing of the row - and an OR holding such a branch asks nothing
        if (branches.some(branch => Object.values(branch).every(value => value === undefined))) {
            return undefined;
        }
        // narrowed as a read's filter is, so a value the property cannot hold is a condition no row
        // meets rather than one a store refuses to compare against
        const possible: WhereFilter<T>[] = dropImpossibleConditions(branches, MetadataUtilities.getModelProperties(this.entityClass));
        if (!possible.length) {
            return { id: { oneOf: [] } } as Where<T>;
        }
        return possible.length === 1 ? possible[0] : possible;
    }

    /**
     * The conflict changes of an upsert with every uuid they set in lower case.
     * @param onConflict - The changes as the caller passed them.
     * @returns A copy when a value changed, otherwise the changes as they are.
     */
    private resolveOnConflictInLowerCase(onConflict: AtomicUpdate<T>): AtomicUpdate<T> {
        const changed: [string, unknown][] = Object.entries(
            UUIDUtilities.resolveCanonicalChanges(this.resolveConflictSets(onConflict), this.entityClass)
        );
        return changed.length
            ? Object.assign({ ...onConflict }, Object.fromEntries(changed.map(([key, value]) => [key, { set: value }])))
            : onConflict;
    }

    /**
     * The values the conflict changes of an upsert set, leaving out the amounts they add.
     * @param onConflict - The changes.
     * @returns The value each property is set to, by property.
     */
    private resolveConflictSets(onConflict: AtomicUpdate<T>): Record<string, unknown> {
        const sets: Record<string, unknown> = {};
        for (const [key, change] of ObjectUtilities.entries(onConflict)) {
            if (change != undefined && 'set' in change) {
                sets[key] = change.set;
            }
        }
        return sets;
    }

    /**
     * Refuses an upsert row whose identity cannot be read off it, or that its changes would move.
     * @param identity - The properties identifying the row.
     * @param row - The row as it is handed to the store.
     * @throws When the row holds no value for a property of the identity, or changes one.
     */
    private validateIdentity(identity: string[], row: UpsertRow<T>): void {
        const values: Map<string, unknown> = new Map(Object.entries(row.create));
        const changes: Map<string, unknown> = new Map(Object.entries(row.onConflict));
        for (const key of identity) {
            const value: unknown = values.get(key);
            if (value == undefined) {
                throw new InternalError(
                    `upsert on "${this.entityClass.name}" was given no value for "${key}", which is part of its identity.`
                );
            }
            // the identity is what the conflicting row was found by and what the written row is
            // paired back to its caller's row by. Setting it to what it already is changes neither
            const change: unknown = changes.get(key);
            const keepsIt: boolean = change == undefined
                || (
                    typeof change === 'object'
                    && 'set' in change
                    && JsonUtilities.stringify(change.set) === JsonUtilities.stringify(value)
                );
            if (!keepsIt) {
                throw new InternalError([
                    `upsert on "${this.entityClass.name}" changes "${key}" on a conflict, which is part of its identity.`,
                    'The identity names the row being changed, so a change to it would land the row on one nobody checked.'
                ]);
            }
        }
    }

    /**
     * Refuses with a conflict an upsert that the store refused because a row's condition no longer
     * held.
     *
     * The store answers a row it may not change the same way whether the scope or the caller's
     * condition excluded it: as inserting the identity would be answered. Told apart the way an update
     * tells them apart, by reading the row holding the identity through the scope and without the
     * condition, so what decides the answer is what this caller was already allowed to read. A row
     * they may see that no longer matches changed under them; one they may not see keeps the answer
     * the store gave.
     * @param error - What the store threw.
     * @param identity - The properties identifying each row.
     * @param rows - The rows as they were handed to the store.
     * @param options - The caller's options, holding their transaction if they had one.
     * @throws A `ConflictError` when a row the caller may see no longer matches its condition.
     */
    private async validateConditionsHeld(
        error: unknown,
        identity: string[],
        rows: UpsertRow<T>[],
        options: BaseRepositoryOptions<T> | undefined
    ): Promise<void> {
        const conditioned: UpsertRow<T>[] = rows.filter(row => row.where != undefined);
        if (!(error instanceof UniqueConstraintViolationError) || !conditioned.length) {
            return;
        }
        const held: T[] = await this.context.findAll({
            where: conditioned.flatMap(row => ScopeWhereUtilities.branchesOf(
                UpsertIdentityUtilities.resolveConflictWhere(this.entityClass, identity, row.create)
            )),
            transaction: options?.transaction,
            unscoped: options?.unscoped,
            acrossTenants: options?.acrossTenants,
            relations: [],
            limit: 'all'
        });
        for (const row of conditioned) {
            const values: string = UpsertIdentityUtilities.resolveValues(identity, row.create);
            const found: T | undefined = held.find(h => UpsertIdentityUtilities.resolveValues(identity, h) === values);
            if (found != undefined && row.where != undefined && !this.evaluator.matches(found, row.where, this.entityClass)) {
                throw new ConflictError(
                    $ts`The ${this.entityClass.name} holding ${values} changed since it was read, so the upsert was not applied.`
                );
            }
        }
    }

    /**
     * The rows the conflict path of an upsert may apply to: the ones the caller may see.
     *
     * Not a filter the repository can add to the identity the way a scope is added to a where filter.
     * The identity is also the conflict target and has to be a declared unique group, so a row the
     * caller may not see still holds it - which is why the store is handed this to judge that row by.
     * @param identity - The properties identifying each row.
     * @param rows - The rows being upserted, holding the identities' values.
     * @param scope - The scope the caller is restricted to.
     * @returns The filter, or undefined when the caller is not restricted.
     * @throws When the identities themselves name nothing the caller may see.
     */
    private resolveReachable(
        identity: string[],
        rows: UpsertRow<T>[],
        scope: Where<T> | DenyAll | undefined
    ): Where<T> | undefined {
        if (scope == undefined) {
            return undefined;
        }
        const reachable: ScopedWhere<T> = scope === denyAll
            ? { matchesNothing: true, where: undefined }
            : ScopeWhereUtilities.applyToWhere(
                rows.flatMap(row => ScopeWhereUtilities.branchesOf(
                    UpsertIdentityUtilities.resolveConflictWhere(this.entityClass, identity, row.create)
                )),
                scope,
                MetadataUtilities.getModelProperties(this.entityClass)
            );
        if (reachable.matchesNothing || scope === denyAll) {
            throw resolveOutOfScopeError(this.entityClass);
        }
        // the scope alone rather than the identities joined to it, which say nothing more about a row
        // the store found by its identity - and which a store writing the batch as one statement would
        // have to bind a value of for every row, past what a statement binds
        return scope;
    }

    /**
     * Replaces the relations named in create data with the foreign keys they resolve to.
     * @param data - The create data, changed in place.
     * @throws When a relation has no key on this row, or names something with no id to write.
     */
    private writeRelationsAsForeignKeys(data: CreateData): void {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(this.entityClass);
        // the one place this reads and writes properties the entity's type does not name - a join
        // column is derived from a relation rather than passed in. The valkey driver asserts the same
        // boundary, for the same reason
        const writable: Record<string, unknown> = data as Record<string, unknown>;

        for (const key of Object.keys(writable)) {
            const metadata: PropertyMetadata | undefined = properties[key];
            if (metadata == undefined || !RELATION_TYPES.has(metadata.type)) {
                continue;
            }
            if (metadata.type !== Relation.BELONGS_TO_ONE && metadata.type !== Relation.MANY_TO_ONE) {
                throw new InternalError([
                    `"${this.entityClass.name}.${String(key)}" cannot be part of an upsert.`,
                    `A ${metadata.type} relation is not stored on this row, so writing it means writing rows beside`,
                    'this one - and an upsert is one statement, which is what makes it safe to read a value and',
                    'change it. Write the other side separately, or use create.'
                ]);
            }
            const value: unknown = writable[key];
            const id: unknown = value != undefined && typeof value === 'object' && 'id' in value ? value.id : value;
            if (typeof id !== 'string') {
                throw new InternalError([
                    `"${this.entityClass.name}.${String(key)}" was given something with no id.`,
                    'An upsert writes the foreign key of a relation, so the row it points at has to exist already.'
                ]);
            }

            writable[metadata.joinColumn] = id;
            // eslint-disable-next-line typescript/no-dynamic-delete
            delete writable[key];
        }
    }
}