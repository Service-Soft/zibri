import { EncryptionKeyCreateData, EncryptionKeyStatus, EncryptionKey } from './encryption-key.model';
import { type EncryptionMasterOptions, EncryptionMasterKey } from './encryption-master-options.model';
import { EncryptionRotationCronJob } from './encryption-rotation.cron-job';
import { type DeleteEncryptionKeyOptions, EncryptionServiceInterface, EncryptOptions } from './encryption-service.interface';
import { EncryptionContent, type EncryptionString, EncryptionUtilities } from './encryption.utilities';
import { KeysInUse } from './keys-in-use.model';
import { MasterKeyReference } from './master-key-reference.model';
import { resolveEncryptedEntities } from './resolve-encrypted-entities.function';
import { RetiredKeyUsage, RetiredMasterUsage } from './retired-key-usage.model';
import { EncryptionStrategyEntity, type EncryptionStrategyEntityCreateData, EncryptionStrategyStatus } from './strategies/encryption-strategy-entity.model';
import { BaseDecryptOptions, BaseEncryptOptions, EncryptionStrategyInterface } from './strategies/encryption-strategy.interface';
import { ZibriApplication } from '../../application/application';
import { BackupEntity } from '../../backup/backup-entity.model';
import { CacheDelete } from '../../caching/decorators/cache-delete.decorator';
import { CacheWrite } from '../../caching/decorators/cache-write.decorator';
import { Cached } from '../../caching/decorators/cached.decorator';
import { AlsUtilities } from '../../context/als.utilities';
import { DataSourceInterface } from '../../data-source/data-sources/data-source.interface';
import { type BaseRepositoryOptions } from '../../data-source/models/options/base-repository-options.model';
import { Where } from '../../data-source/models/where/where-filter.model';
import { Repository } from '../../data-source/repository/repository';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { NoProviderError } from '../../di/errors/no-provider.error';
import { inject } from '../../di/inject.function';
import { register } from '../../di/register.function';
import { AnyObject } from '../../entity/any-object.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { findEncryptedValues, StoredEncryptedValue } from '../../global/model-registry/find-encrypted-values.function';
import { OnAppInit } from '../../global/on-app-init.interface';
import { $ts } from '../../localization/translate.function';
import { type DeepPartial } from '../../types/deep-partial.type';
import { type Newable } from '../../types/newable.type';
import { type OmitStrict } from '../../types/omit-strict.type';
import { PromiseUtilities } from '../../utilities/promise.utilities';
import { validateEntitiesRegistered } from '../../utilities/validate-entities-registered.function';

/**
 * How many rows are read at a time while counting what is still encrypted under a retired key.
 */
const REPORT_PAGE_SIZE: number = 200;

/**
 * An error to throw during encryption service initialization.
 */
class InitEncryptionServiceError extends InternalError {
    constructor(message: string | string[]) {
        const messageArray: string[] = typeof message === 'string' ? [message] : message;
        super(['Error initializing encryption service.', ...messageArray]);
        this.name = 'InitEncryptionServiceError';
    }
}

/**
 * An error to throw when someone tries to delete the default encryption key without passing in { allowDefault: true }.
 */
class DefaultEncryptionKeyCannotBeDeletedError extends InternalError {
    constructor(options?: ErrorOptions) {
        super('Cannot delete the default key. Pass allowDefault: true to override.', options);
        this.name = 'DefaultEncryptionKeyCannotBeDeletedError';
    }
}

/**
 * An error to throw when an encryption strategy with the given name and version could not be found.
 */
class EncryptionStrategyNotFoundError extends InternalError {
    constructor(name: string, version: string, options?: ErrorOptions) {
        super(`No strategy found for ${name} (${version})`, options);
        this.name = 'EncryptionStrategyNotFoundError';
    }
}

/**
 * An error to throw when a master encryption strategy with the given name and version could not be found.
 */
class MasterEncryptionStrategyNotFoundError extends InternalError {
    constructor(name: string, version: string, options?: ErrorOptions) {
        super(`No master strategy found for ${name} (${version})`, options);
        this.name = 'MasterEncryptionStrategyNotFoundError';
    }
}

/**
 * An error to throw when a master key with the given id could not be found.
 */
class MasterKeyNotFoundError extends InternalError {
    constructor(keyId: string, options?: ErrorOptions) {
        super(`No master key found with id "${keyId}"`, options);
        this.name = 'MasterKeyNotFoundError';
    }
}

/**
 * Default encryption service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class EncryptionService implements EncryptionServiceInterface, OnAppInit {
    /**
     * The creation of a strategy's first key, while it is happening.
     *
     * Keyed by the strategy's name and version, so everything encrypting with it while the first
     * key is being written waits on that one write instead of starting another. Emptied as soon as
     * it settles - what it stands in for is the window, not the result.
     */
    private readonly creatingDefaultKey: Map<string, Promise<EncryptionKey>> = new Map();

    private readonly strategies: EncryptionStrategyInterface<unknown>[] = [];
    private readonly strategyEntities: EncryptionStrategyEntity[] = [];
    private readonly dataSourceClasses: Newable<DataSourceInterface>[] = [];
    private loading: Promise<void> | undefined;
    private readonly options: EncryptionMasterOptions<unknown>;

    // read when used rather than injected, so that an application without the entities is told which
    // ones to declare by onAppInit, instead of failing on a repository token while this is built
    private get strategyRepository(): Repository<EncryptionStrategyEntity, EncryptionStrategyEntityCreateData> {
        return inject(repositoryTokenFor(EncryptionStrategyEntity));
    }

    private get keyRepository(): Repository<EncryptionKey, EncryptionKeyCreateData> {
        return inject(repositoryTokenFor(EncryptionKey));
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.ENCRYPTION_STRATEGIES)
        private readonly strategyClasses: Newable<EncryptionStrategyInterface<unknown>>[],
        @Inject(ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS)
        options: EncryptionMasterOptions<unknown> | undefined
    ) {
        if (!options) {
            throw new NoProviderError(ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS, []);
        }
        this.options = options;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit(app: ZibriApplication): Promise<void> {
        // at every boot that uses this implementation, since its lifecycle hooks make every boot build
        // it. A declared entity whose table is missing refuses the boot as well, on the reads below
        validateEntitiesRegistered(EncryptionService.name, app, EncryptionStrategyEntity, EncryptionKey);
        if (!this.strategyClasses.length) {
            throw new InitEncryptionServiceError('Needs to provide at least one encryption strategy.');
        }
        // registered here rather than left to the application, because deprecating a key is the whole
        // point of being able to deprecate one, and nothing acts on it otherwise
        if (!app.options.cronJobs.includes(EncryptionRotationCronJob)) {
            app.options.cronJobs.push(EncryptionRotationCronJob);
        }
        this.dataSourceClasses.push(...app.options.dataSources);
        await this.loadStrategies();
        this.validateNoDuplicateEncryptionStrategy();
        this.validateNoMissingEncryptionStrategy();
        this.validateStrategyNamesAndVersions();

        const keys: EncryptionKey[] = await this.keyRepository.findAll();
        this.validateNoDuplicateMasterEncryptionStrategy();
        this.validateNoMissingMasterEncryptionStrategy(keys);
        this.validateMasterStrategyNamesAndVersions();
        this.validateNoDotsInMasterKeyIds();
        this.validateNoMissingMasterKeyIds(keys);
        await this.reEncryptKeys(keys);
    }

    /**
     * Loads the strategies and their rows, once, by whichever comes first: the first value encrypted
     * or decrypted, or initializing the application.
     *
     * Not left to onAppInit alone, because migrations run before it and may write encrypted values.
     * A load that fails is tried again by the next call, so a migration running before the strategy
     * tables exist does not keep the application from starting once they do.
     */
    private async loadStrategies(): Promise<void> {
        this.loading ??= this.readStrategies();
        try {
            await this.loading;
        }
        catch (error) {
            this.loading = undefined;
            throw error;
        }
    }

    /**
     * Instantiates the configured strategies and reads the rows recorded for them.
     */
    private async readStrategies(): Promise<void> {
        // with their keys, because everything that reads `strategyEntities` afterwards treats `keys`
        // as an array it can search and push to. A strategy row that already existed comes back with
        // the relation unloaded otherwise, and the first boot hides it: the table is empty then, so
        // every strategy is one this process just created and still holds the keys it was given
        const entities: EncryptionStrategyEntity[] = await this.strategyRepository.findAll({ relations: ['keys'] });
        for (const strategy of this.strategyClasses) {
            register({ token: strategy, useClass: strategy });
            this.strategies.push(inject(strategy));
        }
        this.strategyEntities.push(...entities);
    }

    /**
     * Refuses a strategy that says it cannot be used while a migration runs, when one is running.
     * @param strategy - The strategy about to be used.
     * @throws When a migration is running and the strategy is not usable in one.
     */
    private validateUsableNow(
        strategy: Pick<EncryptionStrategyInterface<unknown>, 'name' | 'version' | 'usableInMigrations'>
    ): void {
        const migration: string | undefined = AlsUtilities.getCurrentMigration();
        if (migration == undefined || strategy.usableInMigrations) {
            return;
        }
        throw new InternalError([
            `The migration "${migration}" uses the encryption strategy "${strategy.name}" (${strategy.version}),`,
            'which is not usable in migrations: they run before the application is initialized.',
            'Either use a strategy that has "usableInMigrations" set to true',
            'or write the encrypted values after the application starts instead.'
        ]);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async encrypt<TKey, TEncryptOptions extends BaseEncryptOptions<TKey>>(
        value: string,
        options?: EncryptOptions<TKey, TEncryptOptions>
    ): Promise<EncryptionString> {
        await this.loadStrategies();
        // the strategy options are carried through every branch below rather than only the ones that
        // name a strategy. The binding lives in them, and a property that says nothing beyond
        // "encrypt this" is exactly the one that has to end up bound
        if (!options?.strategy) {
            const strategy: EncryptionStrategyInterface<TKey> = this.findDefaultStrategy<TKey>();
            const strategyClass: Newable<EncryptionStrategyInterface<TKey>> = this.findStrategyClass(
                strategy.name,
                strategy.version
            );
            const key: EncryptionKey = await this.resolveDefaultKey(strategy);
            const decryptedKey: TKey = await this.decryptKey(strategyClass, key.value);
            return await strategy.encrypt(value, { keyId: key.id, key: decryptedKey, ...options?.strategyOptions });
        }

        const strategyClass: Newable<EncryptionStrategyInterface<TKey, TEncryptOptions>> = options.strategy;
        const strategy: EncryptionStrategyInterface<TKey> | undefined = this.strategies.find(
            s => s instanceof strategyClass
        ) as EncryptionStrategyInterface<TKey> | undefined;
        if (!strategy) {
            throw new InternalError(
                `The given strategy ${strategyClass.name} was not provided as part of ZIBRI_DI_TOKENS.ENCRYPTION_STRATEGIES`
            );
        }
        this.validateUsableNow(strategy);

        if (options.strategyOptions?.keyId) {
            const decryptedKey: TKey = await this.findKey(options.strategyOptions.keyId, undefined);
            return await strategy.encrypt(
                value,
                { key: decryptedKey, keyId: options.strategyOptions.keyId, ...options.strategyOptions }
            );
        }

        const key: EncryptionKey = await this.resolveDefaultKey(strategy);
        const decryptedKey: TKey = await this.decryptKey(options.strategy, key.value);
        return await strategy.encrypt(value, { key: decryptedKey, keyId: key.id, ...options.strategyOptions });
    }

    /**
     * The key an encryption with the given strategy is stamped with.
     *
     * Creates the strategy's row and its first key when a deployment has neither yet, which is what
     * every path through {@link encrypt} used to do inline - four of them, each a check followed by
     * a write with awaits in between, so two encryptions arriving together both found nothing and
     * both wrote.
     *
     * Everyone who arrives while that is happening waits on the same promise rather than starting
     * their own, and what the promise does is atomic, so two *processes* arriving together are
     * covered as well. The flag that used to stand in for the first half was set after its own
     * awaits and so guarded nothing.
     * @param strategy - The strategy the value is being encrypted with.
     * @returns Its default key.
     */
    private async resolveDefaultKey<TKey>(strategy: EncryptionStrategyInterface<TKey>): Promise<EncryptionKey> {
        const known: EncryptionKey | undefined = this.readDefaultKey(strategy);
        if (known) {
            return known;
        }

        const identity: string = `${strategy.name}:${strategy.version}`;
        const inFlight: Promise<EncryptionKey> | undefined = this.creatingDefaultKey.get(identity);
        if (inFlight) {
            return await inFlight;
        }

        const creating: Promise<EncryptionKey> = this.createDefaultKey(strategy);
        this.creatingDefaultKey.set(identity, creating);
        try {
            return await creating;
        }
        finally {
            // on the way out either way: a failed creation that stayed here would hand the same
            // rejection to everything that encrypts afterwards
            this.creatingDefaultKey.delete(identity);
        }
    }

    /**
     * The strategy's default key, as far as this process already knows it.
     * @param strategy - The strategy to read for.
     * @returns The key, or undefined when this process has not seen one.
     */
    private readDefaultKey<TKey>(strategy: EncryptionStrategyInterface<TKey>): EncryptionKey | undefined {
        const entity: EncryptionStrategyEntity | undefined = this.entityFor(strategy);
        return entity?.keys.find(k => k.status === EncryptionKeyStatus.DEFAULT) ?? entity?.keys.at(0);
    }

    /**
     * Writes the strategy's row and its first key, or reads whatever another writer got there first.
     * @param strategy - The strategy to create for.
     * @returns Its default key.
     */
    private async createDefaultKey<TKey>(strategy: EncryptionStrategyInterface<TKey>): Promise<EncryptionKey> {
        const entity: EncryptionStrategyEntity = await this.resolveStrategyEntity(strategy);
        const existing: EncryptionKey | undefined = entity.keys.find(k => k.status === EncryptionKeyStatus.DEFAULT)
            ?? entity.keys.at(0);
        if (existing) {
            return existing;
        }
        return await this.createDefaultKeyEntity(entity, await this.generateEncryptedKey(strategy));
    }

    /**
     * The row naming this strategy, written when nothing names it yet.
     *
     * Insert-or-get rather than insert: two instances first encrypting at the same moment would
     * otherwise each write a row, and the keys of one strategy would then be split across two of
     * them with nothing saying which is the real one.
     * @param strategy - The strategy to resolve the row for.
     * @returns The row, with its keys.
     */
    private async resolveStrategyEntity<TKey>(strategy: EncryptionStrategyInterface<TKey>): Promise<EncryptionStrategyEntity> {
        const known: EncryptionStrategyEntity | undefined = this.entityFor(strategy);
        if (known) {
            return known;
        }

        // the first strategy a deployment writes is the one it encrypts with; anything added later
        // is active until somebody promotes it
        const status: EncryptionStrategyStatus = this.strategyEntities.length
            ? EncryptionStrategyStatus.ACTIVE
            : EncryptionStrategyStatus.DEFAULT;
        const entity: EncryptionStrategyEntity = await this.strategyRepository.upsert(
            { name: strategy.name, version: strategy.version },
            { name: strategy.name, version: strategy.version, status },
            // the identity written back to itself, because there is nothing to change: a conflict
            // here means somebody else wrote the row, and what this needs from the statement is that
            // row rather than an edit to it
            { name: { set: strategy.name } },
            { relations: ['keys'] }
        );
        this.strategyEntities.push(entity);
        return entity;
    }

    /**
     * Writes the strategy's default key, or reads whatever another writer got there first.
     *
     * Takes the generated value rather than the strategy that generates it, because a method with a
     * type parameter of its own cannot carry the cache decorator - and the generating is the caller's
     * either way, since a value generated for a key that turns out to exist is thrown away.
     * @param entity - The strategy row the key belongs to.
     * @param value - The generated key, already encrypted with the master key.
     * @returns The key.
     */
    @CacheWrite(ZIBRI_DI_TOKENS.ENCRYPTION_KEY_CACHE, key => key.id)
    private async createDefaultKeyEntity(
        entity: EncryptionStrategyEntity,
        value: EncryptionString
    ): Promise<EncryptionKey> {
        const key: EncryptionKey = await this.keyRepository.upsert(
            { strategyId: entity.id },
            { value, strategy: entity, status: EncryptionKeyStatus.DEFAULT },
            // the status rather than the value. A conflict means this strategy already has a default
            // key, and writing over its value is writing over the only thing that can read back
            // everything encrypted with it
            { status: { set: EncryptionKeyStatus.DEFAULT } },
            { relations: ['strategy'] }
        );
        this.syncStrategyEntityKey(entity, key);
        return key;
    }

    /**
     * The row naming the given strategy, among the ones this process has loaded.
     * @param strategy - The strategy to look for.
     * @returns Its row, or undefined when there is none yet.
     */
    private entityFor<TKey>(strategy: EncryptionStrategyInterface<TKey>): EncryptionStrategyEntity | undefined {
        return this.strategyEntities.find(s => s.name === strategy.name && s.version === strategy.version);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async decrypt<TDecryptOptions extends AnyObject>(
        value: EncryptionString,
        options?: TDecryptOptions
    ): Promise<string> {
        await this.loadStrategies();
        const content: EncryptionContent = EncryptionUtilities.encryptionStringToContent(value);
        const strategy: EncryptionStrategyInterface<unknown> = this.findStrategy(content.strategyName, content.version);
        const key: unknown = await this.findKey(content.keyId, undefined);
        return await strategy.decrypt(value, { key, keyId: content.keyId, ...options ?? {} });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createKey<TKey>(
        strategyClass: Newable<EncryptionStrategyInterface<TKey>>,
        data: OmitStrict<EncryptionKeyCreateData, 'strategy' | 'value'>,
        options?: BaseRepositoryOptions
    ): Promise<EncryptionKey> {
        await this.loadStrategies();
        const strategy: EncryptionStrategyInterface<TKey> = inject(strategyClass);
        const encryptedKey: EncryptionString = await this.generateEncryptedKey(strategy);
        const entity: EncryptionStrategyEntity | undefined = this.strategyEntities.find(
            s => s.name === strategy.name && s.version === strategy.version
        );
        if (!entity) {
            throw new NotFoundError($ts`Could not find ${EncryptionStrategyEntity.name}.`);
        }
        const currentDefaultKey: EncryptionKey | undefined = entity.keys.find(k => k.status === EncryptionKeyStatus.DEFAULT);
        if (data.status === EncryptionKeyStatus.DEFAULT && currentDefaultKey) {
            await this.updateKeyEntityById(currentDefaultKey.id, { status: EncryptionKeyStatus.ACTIVE }, options);
        }
        return await this.createKeyEntity(encryptedKey, entity, data, options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteKey(
        keyId: string,
        options?: DeleteEncryptionKeyOptions
    ): Promise<void> {
        const key: EncryptionKey = await this.findKeyEntityById(keyId, options);
        if (key.status === EncryptionKeyStatus.DEFAULT && !(options?.allowDefault ?? false)) {
            throw new DefaultEncryptionKeyCannotBeDeletedError();
        }

        await this.deleteKeyEntityById(keyId, options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteAllKeys(where: Where<EncryptionKey>, options: DeleteEncryptionKeyOptions = {}): Promise<void> {
        const keys: EncryptionKey[] = await this.keyRepository.findAll({ where });

        if (!(options.allowDefault ?? false) && keys.some(k => k.status === EncryptionKeyStatus.DEFAULT)) {
            throw new DefaultEncryptionKeyCannotBeDeletedError();
        }

        const transaction: Transaction = options.transaction ?? await this.keyRepository.dataSource.startTransaction();
        const ownTransaction: boolean = !options.transaction;
        options.transaction = transaction;

        try {
            await PromiseUtilities.allChunked(keys, k => this.deleteKeyEntityById(k.id, options));
            if (ownTransaction) {
                await transaction.commit();
            }
        }
        catch (error) {
            if (ownTransaction) {
                await transaction.rollback();
            }
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async markKeyAsDefaultForStrategy<TKey>(
        keyId: string,
        strategyClass: Newable<EncryptionStrategyInterface<TKey>>,
        options: BaseRepositoryOptions = {}
    ): Promise<void> {
        await this.loadStrategies();
        const transaction: Transaction = options.transaction ?? await this.keyRepository.dataSource.startTransaction();
        const ownTransaction: boolean = !options.transaction; // track if we created it
        options.transaction = transaction;

        try {
            const strategy: EncryptionStrategyInterface<TKey> = inject(strategyClass);
            const entity: EncryptionStrategyEntity | undefined = this.strategyEntities.find(
                s => s.name === strategy.name && s.version === strategy.version
            );
            if (!entity) {
                throw new NotFoundError($ts`Could not find ${EncryptionStrategyEntity.name}.`);
            }
            const key: EncryptionKey = await this.findKeyEntityById(keyId, options);
            if (key.strategy.name !== strategy.name || key.strategy.version !== strategy.version) {
                throw new InternalError('The key for the given id has a different strategy than the provided one');
            }

            const currentDefaultKey: EncryptionKey | undefined = entity.keys.find(k => k.status === EncryptionKeyStatus.DEFAULT);
            if (currentDefaultKey) {
                await this.updateKeyEntityById(currentDefaultKey.id, { status: EncryptionKeyStatus.ACTIVE }, options);
            }
            await this.updateKeyEntityById(keyId, { status: EncryptionKeyStatus.DEFAULT }, options);

            if (ownTransaction) {
                await transaction.commit();
            }

        }
        catch (error) {
            if (ownTransaction) {
                await transaction.rollback();
            }
            throw error;
        }

    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async decryptKey<TKey, TEncryptOptions extends BaseEncryptOptions<TKey>>(
        strategy: Newable<EncryptionStrategyInterface<TKey, TEncryptOptions>>,
        encryptedKey: EncryptionString
    ): Promise<TKey> {
        const keyBase64: string = await this.masterDecrypt(encryptedKey);
        const keyBuffer: Buffer = Buffer.from(keyBase64, 'base64');
        return await inject(strategy).deserializeKey(keyBuffer);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deprecateKey(keyId: string, options?: BaseRepositoryOptions): Promise<void> {
        const key: EncryptionKey = await this.findKeyEntityById(keyId, options);
        if (key.status === EncryptionKeyStatus.DEFAULT) {
            throw new InternalError(
                'The default key cannot be deprecated - make another key the default first, or there is nothing left to encrypt with.'
            );
        }
        // through the same write every other status change goes through, so the cache learns about it.
        // Setting the status on the row directly would leave this process still believing the key is
        // fine, and it is the process that decides what gets rewritten
        await this.updateKeyEntityById(keyId, { status: EncryptionKeyStatus.DEPRECATED }, options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async needsReEncryption(encrypted: EncryptionString, shouldBeBoundToRow: boolean = false): Promise<boolean> {
        await this.loadStrategies();
        const content: EncryptionContent = EncryptionUtilities.encryptionStringToContent(encrypted);
        const strategy: EncryptionStrategyInterface<Record<string, unknown>> = this.findStrategy(content.strategyName, content.version);
        const strategyEntity: EncryptionStrategyEntity | undefined = this.strategyEntities.find(
            s => s.name === strategy.name && s.version === strategy.version
        );
        if (!strategyEntity) {
            throw new NotFoundError($ts`Could not find ${EncryptionStrategyEntity.name}.`);
        }
        // a value that should be bound to its row but is not was written before binding existed, and
        // is movable until it is written again. Only the caller knows whether it should be - the
        // property may have asked not to be, and rewriting those would never finish
        if (shouldBeBoundToRow && !strategy.isBoundToRow(encrypted)) {
            return true;
        }
        const key: EncryptionKey = await this.findKeyEntityById(content.keyId, undefined);
        return strategyEntity.status === EncryptionStrategyStatus.DEPRECATED || key.status === EncryptionKeyStatus.DEPRECATED;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveRetiredKeyUsage(): Promise<RetiredKeyUsage> {
        await this.loadStrategies();
        const keys: EncryptionKey[] = await this.keyRepository.findAll({ relations: ['strategy'], take: 'all' });
        const retiredKeys: EncryptionKey[] = keys.filter(
            k => k.status === EncryptionKeyStatus.DEPRECATED || k.strategy.status === EncryptionStrategyStatus.DEPRECATED
        );
        const values: Map<string, number> = new Map(retiredKeys.map(k => [k.id, 0]));
        // the stored values are only worth reading when there is a retired key to find among them
        if (values.size) {
            for (const { entityClass, repository } of resolveEncryptedEntities(this.dataSourceClasses)) {
                await this.countValuesByKey(entityClass, repository, values);
            }
        }

        // a data key is written under the current master at every start, so one still under an old
        // master was written by an instance that has not been given the new one yet
        const dataKeys: MasterKeyReference[] = keys.map(k => this.toMasterKeyReference(k.value));
        // what each backup recorded when it was taken, rather than what its archive key says: the key
        // rows in its data are encrypted under the master of that time whether or not the archive is
        const backups: BackupEntity[] = await inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE).resolveRecordedBackups();
        const countUnder: (isUnder: (reference: MasterKeyReference) => boolean) => RetiredMasterUsage = isUnder => ({
            dataKeys: dataKeys.filter(isUnder).length,
            backups: backups.filter(b => b.masterKeys.some(isUnder)).length
        });

        return {
            dataKeys: retiredKeys.map(k => ({
                keyId: k.id,
                strategyName: k.strategy.name,
                strategyVersion: k.strategy.version,
                values: values.get(k.id) ?? 0,
                backups: backups.filter(b => b.dataKeyIds.includes(k.id)).length
            })),
            masterKeys: (this.options.oldMasterKeys ?? []).map(k => ({ keyId: k.id, ...countUnder(r => r.keyId === k.id) })),
            masterStrategies: (this.options.oldMasterStrategies ?? []).map(s => ({
                name: s.name,
                version: s.version,
                ...countUnder(r => r.strategyName === s.name && r.strategyVersion === s.version)
            }))
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveKeysInUse(): Promise<KeysInUse> {
        const current: MasterKeyReference = {
            keyId: this.options.currentMasterKey.id,
            strategyName: this.options.currentMasterStrategy.name,
            strategyVersion: this.options.currentMasterStrategy.version
        };
        const keys: EncryptionKey[] = await this.keyRepository.findAll({ take: 'all' });
        const references: MasterKeyReference[] = [current, ...keys.map(k => this.toMasterKeyReference(k.value))];
        return {
            currentMasterKey: current,
            masterKeys: references.filter((r, i) => references.findIndex(
                o => o.keyId === r.keyId && o.strategyName === r.strategyName && o.strategyVersion === r.strategyVersion
            ) === i),
            dataKeyIds: keys.map(k => k.id),
            dataSource: this.keyRepository.dataSource
        };
    }

    /**
     * Reads which master key and strategy encrypted a value encrypted with `masterEncrypt`.
     * @param encrypted - The value.
     * @returns The master key and strategy it names.
     */
    private toMasterKeyReference(encrypted: EncryptionString): MasterKeyReference {
        const content: EncryptionContent = EncryptionUtilities.encryptionStringToContent(encrypted);
        return { keyId: content.keyId, strategyName: content.strategyName, strategyVersion: content.version };
    }

    /**
     * Counts the stored values of one entity per key that encrypted them, for the keys being counted.
     * @param entityClass - The entity to read.
     * @param repository - The repository that reads it.
     * @param counts - The count so far of each key being counted, which this adds to.
     */
    private async countValuesByKey(
        entityClass: Newable<BaseEntity>,
        repository: Repository<BaseEntity>,
        counts: Map<string, number>
    ): Promise<void> {
        for (let skip: number = 0; ; skip += REPORT_PAGE_SIZE) {
            // as stored, because a decrypted value no longer says which key wrote it
            const page: BaseEntity[] = await repository.findAll({ skip, take: REPORT_PAGE_SIZE, autoDecrypt: false });
            const found: StoredEncryptedValue[][] = await PromiseUtilities.allChunked(
                page,
                async row => await findEncryptedValues(row, entityClass)
            );
            for (const { value } of found.flat()) {
                const keyId: string = EncryptionUtilities.encryptionStringToContent(value).keyId;
                const count: number | undefined = counts.get(keyId);
                if (count != undefined) {
                    counts.set(keyId, count + 1);
                }
            }
            if (page.length < REPORT_PAGE_SIZE) {
                return;
            }
        }
    }

    private needsMasterReEncryption(encrypted: EncryptionString): boolean {
        const content: EncryptionContent = EncryptionUtilities.encryptionStringToContent(encrypted);
        const allKeys: EncryptionMasterKey<unknown>[] = [
            this.options.currentMasterKey,
            ...this.options.oldMasterKeys ?? []
        ];
        const key: EncryptionMasterKey<unknown> | undefined = allKeys.find(k => k.id === content.keyId);
        if (!key) {
            throw new MasterKeyNotFoundError(content.keyId);
        }
        const allStrategies: EncryptionStrategyInterface<unknown>[] = [
            this.options.currentMasterStrategy,
            ...this.options.oldMasterStrategies ?? []
        ];
        const strategy: EncryptionStrategyInterface<unknown> | undefined = allStrategies.find(
            k => k.name === content.strategyName && k.version === content.version
        );
        if (!strategy) {
            throw new MasterEncryptionStrategyNotFoundError(content.strategyName, content.version);
        }
        return strategy.name !== this.options.currentMasterStrategy.name
            || strategy.version !== this.options.currentMasterStrategy.version
            || key.id !== this.options.currentMasterKey.id;
    }

    private async generateEncryptedKey<TKey>(strategy: EncryptionStrategyInterface<TKey>): Promise<EncryptionString> {
        const rawKey: TKey = await strategy.generateRandomKey();
        const keyBytes: Buffer = await strategy.serializeKey(rawKey);
        const keyBase64: string = keyBytes.toString('base64');
        return await this.masterEncrypt(keyBase64);
    }

    private async findKey<TKey>(keyId: string, options: BaseRepositoryOptions | undefined): Promise<TKey> {
        const entity: EncryptionKey = await this.findKeyEntityById(keyId, options);
        const strategy: Newable<EncryptionStrategyInterface<TKey>> = this.findStrategyClass(
            entity.strategy.name,
            entity.strategy.version
        );

        return await this.decryptKey(strategy, entity.value);
    }

    @Cached(ZIBRI_DI_TOKENS.ENCRYPTION_KEY_CACHE, (id) => id)
    private async findKeyEntityById(id: string, options: BaseRepositoryOptions | undefined): Promise<EncryptionKey> {
        return await this.keyRepository.findById(id, { relations: ['strategy'], ...options });
    }

    @CacheWrite(ZIBRI_DI_TOKENS.ENCRYPTION_KEY_CACHE, key => key.id)
    private async createKeyEntity(
        encryptedValue: EncryptionString,
        strategy: EncryptionStrategyEntity,
        data: OmitStrict<EncryptionKeyCreateData, 'strategy' | 'value'>,
        options: BaseRepositoryOptions | undefined
    ): Promise<EncryptionKey> {
        const created: EncryptionKey = await this.keyRepository.create({
            value: encryptedValue,
            strategy,
            ...data
        }, options);
        const key: EncryptionKey = await this.keyRepository.findById(created.id, { relations: ['strategy'], ...options });
        this.syncStrategyEntityKey(strategy, key);
        return key;
    }

    @CacheWrite(ZIBRI_DI_TOKENS.ENCRYPTION_KEY_CACHE, key => key.id)
    private async updateKeyEntityById(
        id: string,
        data: DeepPartial<EncryptionKey>,
        options: BaseRepositoryOptions | undefined
    ): Promise<EncryptionKey> {
        const updated: EncryptionKey = await this.keyRepository.updateById(id, data, options);
        const key: EncryptionKey = await this.keyRepository.findById(updated.id, { relations: ['strategy'], ...options });
        const strategyEntity: EncryptionStrategyEntity | undefined = this.strategyEntities.find(s => s.id === key.strategyId);
        if (!strategyEntity) {
            throw new NotFoundError($ts`Could not find ${EncryptionStrategyEntity.name}.`);
        }
        this.syncStrategyEntityKey(strategyEntity, key);
        return key;
    }

    // eslint-disable-next-line unusedImports/no-unused-vars
    @CacheDelete(ZIBRI_DI_TOKENS.ENCRYPTION_KEY_CACHE, (keyId, _) => keyId)
    private async deleteKeyEntityById(id: string, options: BaseRepositoryOptions | undefined): Promise<void> {
        const strategy: EncryptionStrategyEntity | undefined = this.strategyEntities.find(s => s.keys.some(k => k.id === id));
        if (!strategy) {
            throw new NotFoundError($ts`Could not find strategy for key with id ${id}`);
        }
        strategy.keys = strategy.keys.filter(k => k.id !== id);
        await this.keyRepository.deleteById(id, options);
    }

    private syncStrategyEntityKey(strategy: EncryptionStrategyEntity, key: EncryptionKey): void {
        const existingIndex: number = strategy.keys.findIndex(k => k.id === key.id);
        if (existingIndex >= 0) {
            strategy.keys[existingIndex] = key;
            return;
        }
        strategy.keys.push(key);
    }

    private findStrategy<
        TKey,
        TEncryptOptions extends BaseEncryptOptions<TKey>,
        TDecryptOptions extends BaseDecryptOptions<TKey>
    >(name: string, version: string): EncryptionStrategyInterface<TKey, TEncryptOptions, TDecryptOptions> {
        const res: EncryptionStrategyInterface<TKey, TEncryptOptions, TDecryptOptions> | undefined = this.strategies.find(
            s => s.name === name && s.version === version
        ) as EncryptionStrategyInterface<TKey, TEncryptOptions, TDecryptOptions> | undefined;
        if (!res) {
            throw new EncryptionStrategyNotFoundError(name, version);
        }
        this.validateUsableNow(res);
        return res;
    }

    private findStrategyClass<
        TKey,
        TEncryptOptions extends BaseEncryptOptions<TKey>,
        TDecryptOptions extends BaseDecryptOptions<TKey>
    >(name: string, version: string): Newable<EncryptionStrategyInterface<TKey, TEncryptOptions, TDecryptOptions>> {
        const res: Newable<EncryptionStrategyInterface<TKey, TEncryptOptions, TDecryptOptions>> | undefined = this.strategyClasses.find(
            s => inject(s).name === name && inject(s).version === version
        ) as Newable<EncryptionStrategyInterface<TKey, TEncryptOptions, TDecryptOptions>> | undefined;
        if (!res) {
            throw new EncryptionStrategyNotFoundError(name, version);
        }
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async masterEncrypt(keyBase64: string): Promise<EncryptionString> {
        this.validateUsableNow(this.options.currentMasterStrategy);
        const encrypted: EncryptionString = await this.options.currentMasterStrategy.encrypt(
            keyBase64,
            {
                key: this.options.currentMasterKey.value,
                keyId: this.options.currentMasterKey.id
            }
        );

        const content: EncryptionContent = EncryptionUtilities.encryptionStringToContent(encrypted);
        if (content.keyId !== this.options.currentMasterKey.id) {
            throw new InternalError(`Master key id mismatch: expected ${this.options.currentMasterKey.id}, got ${content.keyId}`);
        }
        return encrypted;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async masterDecrypt(encrypted: EncryptionString): Promise<string> {
        const content: EncryptionContent = EncryptionUtilities.encryptionStringToContent(encrypted);
        const masterKey: EncryptionMasterKey<unknown> | undefined = [
            this.options.currentMasterKey,
            ...this.options.oldMasterKeys ?? []
        ].find(k => k.id === content.keyId);
        if (!masterKey) {
            throw new MasterKeyNotFoundError(content.keyId);
        }
        const masterStrategy: EncryptionStrategyInterface<unknown> | undefined = [
            this.options.currentMasterStrategy,
            ...this.options.oldMasterStrategies ?? []
        ].find(s => s.name === content.strategyName && s.version === content.version);
        if (!masterStrategy) {
            throw new MasterEncryptionStrategyNotFoundError(content.strategyName, content.version);
        }
        this.validateUsableNow(masterStrategy);
        return await masterStrategy.decrypt(encrypted, { key: masterKey.value, keyId: masterKey.id });
    }

    /**
     * The strategy an encryption that names none is performed with.
     *
     * Only the strategy, and deliberately: the row belonging to it is looked up by what identifies
     * it - its name and version - rather than by its status. Answering both questions here is what
     * used to write a new strategy row on *every* unnamed encryption once the table held rows but
     * none of them was the default one, which a first encryption naming its strategy is enough to
     * bring about.
     * @returns The default strategy, or the first one there is when nothing is marked as default.
     */
    private findDefaultStrategy<TKey>(): EncryptionStrategyInterface<TKey> {
        const entity: EncryptionStrategyEntity | undefined = this.strategyEntities.find(s => s.status === EncryptionStrategyStatus.DEFAULT);
        if (entity) {
            return this.findStrategy(entity.name, entity.version);
        }
        const first: EncryptionStrategyInterface<TKey> = this.strategies[0] as EncryptionStrategyInterface<TKey>;
        this.validateUsableNow(first);
        return first;
    }

    private validateNoDuplicateEncryptionStrategy(): void {
        const duplicateStrategies: EncryptionStrategyInterface<unknown>[] = this.strategies.filter(
            s => this.strategies.filter(hs => hs.name === s.name && hs.version === s.version).length > 1
        );
        if (duplicateStrategies.length) {
            throw new InitEncryptionServiceError([
                'There are duplicate encryption strategies:',
                ...[...new Set(duplicateStrategies)].map(s => `- ${s.name} (${s.version})`)
            ]);
        }
    }

    private validateNoDuplicateMasterEncryptionStrategy(): void {
        const allMasterStrategies: EncryptionStrategyInterface<unknown>[] = [
            this.options.currentMasterStrategy,
            ...this.options.oldMasterStrategies ?? []
        ];
        const duplicateStrategies: EncryptionStrategyInterface<unknown>[] = allMasterStrategies.filter(
            s => allMasterStrategies.filter(hs => hs.name === s.name && hs.version === s.version).length > 1
        );
        if (duplicateStrategies.length) {
            throw new InitEncryptionServiceError([
                'There are duplicate master encryption strategies:',
                ...[...new Set(duplicateStrategies)].map(s => `- ${s.name} (${s.version})`)
            ]);
        }
    }

    private validateNoMissingEncryptionStrategy(): void {
        const missingStrategies: EncryptionStrategyEntity[] = this.strategyEntities.filter(
            s => !this.strategies.some(hs => hs.name === s.name && hs.version === s.version)
        );
        if (missingStrategies.length) {
            throw new InitEncryptionServiceError([
                'There are missing strategies:',
                ...missingStrategies.map(s => `  - ${s.name} (${s.version})`),
                'Did you remove them?'
            ]);
        }
    }

    private validateNoDotsInMasterKeyIds(): void {
        const allKeys: EncryptionMasterKey<unknown>[] = [
            this.options.currentMasterKey,
            ...this.options.oldMasterKeys ?? []
        ];

        const keysWithDotsInId: EncryptionMasterKey<unknown>[] = allKeys.filter(
            s => s.id.includes('.')
        );
        if (!keysWithDotsInId.length) {
            return;
        }

        throw new InitEncryptionServiceError([
            'There are master keys that use dots in their id:',
            ...keysWithDotsInId.map(k => `  - ${k.id}`)
        ]);
    }

    private validateNoMissingMasterKeyIds(keys: EncryptionKey[]): void {
        const allMasterKeys: EncryptionMasterKey<unknown>[] = [
            this.options.currentMasterKey,
            ...this.options.oldMasterKeys ?? []
        ];

        const missingKeyIds: string[] = keys
            .map(k => EncryptionUtilities.encryptionStringToContent(k.value).keyId)
            .filter(keyId => !allMasterKeys.some(k => k.id === keyId));

        if (!missingKeyIds.length) {
            return;
        }

        throw new InitEncryptionServiceError([
            'There are missing master key ids:',
            ...missingKeyIds.map(id => `  - ${id}`)
        ]);
    }

    private validateNoMissingMasterEncryptionStrategy(keys: EncryptionKey[]): void {
        const allMasterStrategies: EncryptionStrategyInterface<unknown>[] = [
            this.options.currentMasterStrategy,
            ...this.options.oldMasterStrategies ?? []
        ];
        const missingStrategies: EncryptionContent[] = keys
            .map(k => EncryptionUtilities.encryptionStringToContent(k.value))
            .filter(
                s => !allMasterStrategies.some(hs => hs.name === s.strategyName && hs.version === s.version)
            );
        if (missingStrategies.length) {
            throw new InitEncryptionServiceError([
                'There are missing master strategies:',
                ...missingStrategies.map(s => `  - ${s.strategyName} (${s.version})`),
                'Did you remove them?'
            ]);
        }
    }

    private validateStrategyNamesAndVersions(): void {
        const strategiesWithDotsInNameOrVersion: EncryptionStrategyInterface<unknown>[] = this.strategies.filter(
            s => s.name.includes('.') || s.version.includes('.')
        );
        if (!strategiesWithDotsInNameOrVersion.length) {
            return;
        }

        throw new InitEncryptionServiceError([
            'There are strategies that use dots in either the version or the name:',
            ...strategiesWithDotsInNameOrVersion.map(s => `  - ${s.name} (${s.version})`)
        ]);
    }

    private validateMasterStrategyNamesAndVersions(): void {
        const allMasterStrategies: EncryptionStrategyInterface<unknown>[] = [
            this.options.currentMasterStrategy,
            ...this.options.oldMasterStrategies ?? []
        ];
        const strategiesWithDotsInNameOrVersion: EncryptionStrategyInterface<unknown>[] = allMasterStrategies.filter(
            s => s.name.includes('.') || s.version.includes('.')
        );
        if (!strategiesWithDotsInNameOrVersion.length) {
            return;
        }

        throw new InitEncryptionServiceError([
            'There are master strategies that use dots in either the version or the name:',
            ...strategiesWithDotsInNameOrVersion.map(s => `  - ${s.name} (${s.version})`)
        ]);
    }

    private async reEncryptKeys(keys: EncryptionKey[]): Promise<void> {
        await PromiseUtilities.allChunked(keys, key => this.reEncryptKey(key));
    }

    private async reEncryptKey(key: EncryptionKey): Promise<void> {
        if (!this.needsMasterReEncryption(key.value)) {
            return;
        }

        const decrypted: string = await this.masterDecrypt(key.value);
        const newEncrypted: string = await this.masterEncrypt(decrypted);

        await this.updateKeyEntityById(key.id, { value: newEncrypted }, undefined);
    }
}