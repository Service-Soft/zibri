import { EncryptionKeyCreateData, EncryptionKeyStatus, EncryptionKey } from './encryption-key.model';
import { type EncryptionMasterOptions, EncryptionMasterKey } from './encryption-master-options.model';
import { type DeleteEncryptionKeyOptions, EncryptionServiceInterface, EncryptOptions } from './encryption-service.interface';
import { EncryptionContent, type EncryptionString, EncryptionUtilities } from './encryption.utilities';
import { EncryptionStrategyEntity, type EncryptionStrategyEntityCreateData, EncryptionStrategyStatus } from './strategies/encryption-strategy-entity.model';
import { BaseDecryptOptions, BaseEncryptOptions, EncryptionStrategyInterface } from './strategies/encryption-strategy.interface';
import { WriteThroughReadThroughCache } from '../../caching/cache/read-through/write-through-read-through.cache';
import { type CacheServiceInterface } from '../../caching/cache-service.interface';
import { CacheDelete } from '../../caching/decorators/cache-delete.decorator';
import { CacheWrite } from '../../caching/decorators/cache-write.decorator';
import { Cache } from '../../caching/decorators/cache.decorator';
import { Cached } from '../../caching/decorators/cached.decorator';
import { InMemoryCacheStore } from '../../caching/store/in-memory.cache-store';
import { type BaseRepositoryOptions } from '../../data-source/models/options/base-repository-options.model';
import { Where } from '../../data-source/models/where/where-filter.model';
import { Repository } from '../../data-source/repository';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { InjectRepository } from '../../di/decorators/inject-repository.decorator';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { NoProviderError } from '../../di/errors/no-provider.error';
import { inject } from '../../di/inject.function';
import { register } from '../../di/register.function';
import { AnyObject } from '../../entity/any-object.model';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { OnAppInit } from '../../global/on-app-init.interface';
import { $ts } from '../../localization/translate.function';
import { type LoggerInterface } from '../../logging/logger.interface';
import { type MetricsServiceInterface } from '../../metrics/metrics-service.interface';
import { type DeepPartial } from '../../types/deep-partial.type';
import { type Newable } from '../../types/newable.type';
import { type OmitStrict } from '../../types/omit-strict.type';
import { PromiseUtilities } from '../../utilities/promise.utilities';

// eslint-disable-next-line jsdoc/require-jsdoc
type StrategyAndEntity<TKey> = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    strategy: EncryptionStrategyInterface<TKey>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    entity: EncryptionStrategyEntity | undefined
};

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

@Cache()
// eslint-disable-next-line jsdoc/require-jsdoc
export class EncryptionKeyCache extends WriteThroughReadThroughCache<string, EncryptionKey, 'EncryptionKeyCache'> {

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected get cacheService(): CacheServiceInterface {
        return inject(ZIBRI_DI_TOKENS.CACHE_SERVICE);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected get metricsService(): MetricsServiceInterface {
        return inject(ZIBRI_DI_TOKENS.METRICS_SERVICE);
    }

    constructor() {
        super('EncryptionKeyCache', new InMemoryCacheStore(), []);
    }
}

/**
 * Default encryption service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class EncryptionService implements EncryptionServiceInterface, OnAppInit {
    private hasCreatedInitialDefaultStrategy: boolean = false;
    private readonly strategies: EncryptionStrategyInterface<unknown>[] = [];
    private readonly strategyEntities: EncryptionStrategyEntity[] = [];
    private readonly options: EncryptionMasterOptions<unknown>;

    constructor(
        @InjectRepository(EncryptionStrategyEntity)
        private readonly strategyRepository: Repository<EncryptionStrategyEntity, EncryptionStrategyEntityCreateData>,
        @InjectRepository(EncryptionKey)
        private readonly keyRepository: Repository<EncryptionKey, EncryptionKeyCreateData>,
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
    async onAppInit(): Promise<void> {
        if (!this.strategyClasses.length) {
            throw new InitEncryptionServiceError('Needs to provide at least one encryption strategy.');
        }
        for (const strategy of this.strategyClasses) {
            register({ token: strategy, useClass: strategy });
            this.strategies.push(inject(strategy));
        }
        const strategies: EncryptionStrategyEntity[] = await this.strategyRepository.findAll();
        this.strategyEntities.push(...strategies);
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    async encrypt<TKey, TEncryptOptions extends BaseEncryptOptions<TKey>>(
        value: string,
        options?: EncryptOptions<TKey, TEncryptOptions>
    ): Promise<EncryptionString> {
        if (!options) {
            const strategy: StrategyAndEntity<TKey> = this.findDefaultStrategy();
            if (!this.hasCreatedInitialDefaultStrategy && !strategy.entity && !this.strategyEntities.length) {
                const key: EncryptionKeyCreateData = {
                    status: EncryptionKeyStatus.DEFAULT,
                    value: await this.generateEncryptedKey(strategy.strategy)
                };
                const entity: EncryptionStrategyEntity = await this.createStrategyEntity({
                    name: strategy.strategy.name,
                    version: strategy.strategy.version,
                    status: EncryptionStrategyStatus.DEFAULT,
                    keys: [key]
                });
                this.hasCreatedInitialDefaultStrategy = true;
                const strategyClass: Newable<EncryptionStrategyInterface<TKey>> = this.findStrategyClass(
                    strategy.strategy.name,
                    strategy.strategy.version
                );
                const decryptedKey: TKey = await this.decryptKey(strategyClass, key.value);
                return await strategy.strategy.encrypt(value, { keyId: entity.keys[0].id, key: decryptedKey });
            }

            if (!strategy.entity) {
                const key: EncryptionKeyCreateData = {
                    status: EncryptionKeyStatus.DEFAULT,
                    value: await this.generateEncryptedKey(strategy.strategy)
                };
                const entity: EncryptionStrategyEntity = await this.createStrategyEntity({
                    name: strategy.strategy.name,
                    version: strategy.strategy.version,
                    status: EncryptionStrategyStatus.ACTIVE,
                    keys: [key]
                });
                const strategyClass: Newable<EncryptionStrategyInterface<TKey>> = this.findStrategyClass(
                    strategy.strategy.name,
                    strategy.strategy.version
                );
                const decryptedKey: TKey = await this.decryptKey(strategyClass, key.value);
                return await strategy.strategy.encrypt(value, { keyId: entity.keys[0].id, key: decryptedKey });
            }

            const strategyClass: Newable<EncryptionStrategyInterface<TKey>> = this.findStrategyClass(
                strategy.strategy.name,
                strategy.strategy.version
            );
            const key: EncryptionKey = await this.findOrCreateDefaultKeyForStrategy(strategy.entity);
            const decryptedKey: TKey = await this.decryptKey(strategyClass, key.value);
            return await strategy.strategy.encrypt(value, { keyId: key.id, key: decryptedKey });
        }

        const strategy: EncryptionStrategyInterface<TKey> | undefined = this.strategies.find(
            s => s instanceof options.strategy
        ) as EncryptionStrategyInterface<TKey> | undefined;
        if (!strategy) {
            throw new InternalError(
                `The given strategy ${options.strategy.name} was not provided as part of ZIBRI_DI_TOKENS.ENCRYPTION_STRATEGIES`
            );
        }

        if (options.strategyOptions?.keyId) {
            const decryptedKey: TKey = await this.findKey(options.strategyOptions.keyId, undefined);
            return await strategy.encrypt(
                value,
                { key: decryptedKey, keyId: options.strategyOptions.keyId, ...options.strategyOptions }
            );
        }

        const entity: EncryptionStrategyEntity | undefined = this.strategyEntities.find(
            s => s.name === strategy.name && s.version === strategy.version
        );
        if (!entity) {
            const key: EncryptionKeyCreateData = {
                status: EncryptionKeyStatus.DEFAULT,
                value: await this.generateEncryptedKey(strategy)
            };
            const createdEntity: EncryptionStrategyEntity = await this.createStrategyEntity({
                name: strategy.name,
                version: strategy.version,
                status: EncryptionStrategyStatus.ACTIVE,
                keys: [key]
            });
            const decryptedKey: TKey = await this.decryptKey(options.strategy, key.value);
            return await strategy.encrypt(value, { keyId: createdEntity.keys[0].id, key: decryptedKey, ...options.strategyOptions });
        }

        const key: EncryptionKey = await this.findOrCreateDefaultKeyForStrategy(entity);
        const decryptedKey: TKey = await this.decryptKey(options.strategy, key.value);
        return await strategy.encrypt(value, { key: decryptedKey, keyId: key.id, ...options.strategyOptions });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async decrypt<TDecryptOptions extends AnyObject>(
        value: EncryptionString,
        options?: TDecryptOptions
    ): Promise<string> {
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
    async needsReEncryption(encrypted: EncryptionString): Promise<boolean> {
        const content: EncryptionContent = EncryptionUtilities.encryptionStringToContent(encrypted);
        const strategy: EncryptionStrategyInterface<Record<string, unknown>> = this.findStrategy(content.strategyName, content.version);
        const strategyEntity: EncryptionStrategyEntity | undefined = this.strategyEntities.find(
            s => s.name === strategy.name && s.version === strategy.version
        );
        if (!strategyEntity) {
            throw new NotFoundError($ts`Could not find ${EncryptionStrategyEntity.name}.`);
        }
        const key: EncryptionKey = await this.findKeyEntityById(content.keyId, undefined);
        return strategyEntity.status === EncryptionStrategyStatus.DEPRECATED || key.status === EncryptionKeyStatus.DEPRECATED;
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

    // eslint-disable-next-line unusedImports/no-unused-vars
    @Cached(EncryptionKeyCache, (id, ..._) => id)
    private async findKeyEntityById(id: string, options: BaseRepositoryOptions | undefined): Promise<EncryptionKey> {
        return await this.keyRepository.findById(id, { relations: ['strategy'], ...options });
    }

    // eslint-disable-next-line unusedImports/no-unused-vars
    @CacheWrite(EncryptionKeyCache, (key, ..._) => key.id)
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

    // eslint-disable-next-line unusedImports/no-unused-vars
    @CacheWrite(EncryptionKeyCache, (key, ..._) => key.id)
    private async updateKeyEntityById(
        id: string,
        data: DeepPartial<EncryptionKey>,
        options: BaseRepositoryOptions | undefined
    ): Promise<EncryptionKey> {
        const updated: EncryptionKey = await this.keyRepository.updateById(id, data, options);
        const key: EncryptionKey = await this.keyRepository.findById(updated.id, { relations: ['strategy'], ...options });
        this.syncStrategyEntityKey(updated.strategy, key);
        return key;
    }

    // eslint-disable-next-line unusedImports/no-unused-vars
    @CacheDelete(EncryptionKeyCache, (keyId, _) => keyId)
    private async deleteKeyEntityById(id: string, options: BaseRepositoryOptions | undefined): Promise<void> {
        const strategy: EncryptionStrategyEntity | undefined = this.strategyEntities.find(s => s.keys.some(k => k.id === id));
        if (!strategy) {
            throw new NotFoundError($ts`Could not find strategy for key with id ${id}`);
        }
        strategy.keys = strategy.keys.filter(k => k.id !== id);
        await this.keyRepository.deleteById(id, options);
    }

    private async createStrategyEntity(data: EncryptionStrategyEntityCreateData): Promise<EncryptionStrategyEntity> {
        const res: EncryptionStrategyEntity = await this.strategyRepository.create(data);
        this.strategyEntities.push(res);
        return res;
    }

    private syncStrategyEntityKey(strategy: EncryptionStrategyEntity, key: EncryptionKey): void {
        const existingIndex: number = strategy.keys.findIndex(k => k.id === key.id);
        if (existingIndex >= 0) {
            strategy.keys[existingIndex] = key;
            return;
        }
        strategy.keys.push(key);
    }

    private async findOrCreateDefaultKeyForStrategy(strategy: EncryptionStrategyEntity): Promise<EncryptionKey> {
        return strategy.keys.find(k => k.status === EncryptionKeyStatus.DEFAULT)
            ?? strategy.keys.at(0)
            ?? await this.createKey(this.findStrategyClass(strategy.name, strategy.version), { status: EncryptionKeyStatus.DEFAULT });
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

    private async masterEncrypt(keyBase64: string): Promise<EncryptionString> {
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

    private async masterDecrypt(encrypted: EncryptionString): Promise<string> {
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
        return await masterStrategy.decrypt(encrypted, { key: masterKey.value, keyId: masterKey.id });
    }

    private findDefaultStrategy<TKey>(): StrategyAndEntity<TKey> {
        const entity: EncryptionStrategyEntity | undefined = this.strategyEntities.find(s => s.status === EncryptionStrategyStatus.DEFAULT);
        return entity
            ? { strategy: this.findStrategy(entity.name, entity.version), entity }
            : { strategy: this.strategies[0] as EncryptionStrategyInterface<TKey>, entity };
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