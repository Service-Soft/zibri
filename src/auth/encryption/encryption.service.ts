import { EncryptionKeyCreateData, EncryptionKeyStatus, EncryptionKey } from './encryption-key.model';
import { type EncryptionMasterOptions, EncryptionMasterKey } from './encryption-master-options.model';
import { EncryptionServiceInterface, EncryptOptions } from './encryption-service.interface';
import { EncryptionContent, EncryptionString, EncryptionUtilities } from './encryption.utilities';
import { EncryptionStrategyEntity, EncryptionStrategyEntityCreateData, EncryptionStrategyStatus } from './strategies/encryption-strategy-entity.model';
import { BaseDecryptOptions, BaseEncryptOptions, EncryptionStrategyInterface } from './strategies/encryption-strategy.interface';
import { Repository } from '../../data-source/repository';
import { InjectRepository } from '../../di/decorators/inject-repository.decorator';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { NoProviderError } from '../../di/errors/no-provider.error';
import { inject } from '../../di/inject.function';
import { register } from '../../di/register.function';
import { AnyObject } from '../../entity/any-object.model';
import { OnAppInit } from '../../global/on-app-init.interface';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';

// eslint-disable-next-line jsdoc/require-jsdoc
type StrategyAndEntity<TKey> = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    strategy: EncryptionStrategyInterface<TKey>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    entity: EncryptionStrategyEntity | undefined
};

/**
 * Default encryption service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class EncryptionService implements EncryptionServiceInterface, OnAppInit {
    private hasCreatedInitialDefaultStrategy: boolean = false;
    private readonly strategies: EncryptionStrategyInterface<unknown>[] = [];
    private readonly options: EncryptionMasterOptions<unknown>;

    constructor(
        @InjectRepository(EncryptionStrategyEntity)
        private readonly encryptionStrategyRepository: Repository<EncryptionStrategyEntity, EncryptionStrategyEntityCreateData>,
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
            throw new Error('Needs to provide at least one encryption strategy.');
        }
        for (const strategy of this.strategyClasses) {
            register({ token: strategy, useClass: strategy });
            this.strategies.push(inject(strategy));
        }
        const strategies: EncryptionStrategyEntity[] = await this.encryptionStrategyRepository.findAll();
        this.validateNoDuplicateEncryptionStrategy();
        this.validateNoMissingEncryptionStrategy(strategies);
        this.validateStrategyNamesAndVersions();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async encrypt<TKey, TEncryptOptions extends BaseEncryptOptions<TKey>>(
        value: string,
        options?: EncryptOptions<TKey, TEncryptOptions>
    ): Promise<EncryptionString> {
        if (!options) {
            const strategy: StrategyAndEntity<TKey> = await this.findDefaultStrategy();
            if (!this.hasCreatedInitialDefaultStrategy && !strategy.entity && !(await this.encryptionStrategyRepository.findAll()).length) {
                const key: EncryptionKeyCreateData = {
                    status: EncryptionKeyStatus.DEFAULT,
                    value: await this.generateEncryptedKey(strategy.strategy)
                };
                const entity: EncryptionStrategyEntity = await this.encryptionStrategyRepository.create({
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
                const entity: EncryptionStrategyEntity = await this.encryptionStrategyRepository.create({
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
            throw new Error(
                `The given strategy ${options.strategy.name} was not provided as part of ZIBRI_DI_TOKENS.ENCRYPTION_STRATEGIES`
            );
        }

        if (options.strategyOptions?.keyId) {
            const decryptedKey: TKey = await this.findKey(options.strategyOptions.keyId);
            return await strategy.encrypt(
                value,
                { key: decryptedKey, keyId: options.strategyOptions.keyId, ...options.strategyOptions }
            );
        }

        const entity: EncryptionStrategyEntity | undefined = await this.encryptionStrategyRepository.findOne(
            { where: { version: strategy.version, name: strategy.name }, relations: ['keys'] },
            false
        );
        if (!entity) {
            const key: EncryptionKeyCreateData = {
                status: EncryptionKeyStatus.DEFAULT,
                value: await this.generateEncryptedKey(strategy)
            };
            const entity: EncryptionStrategyEntity = await this.encryptionStrategyRepository.create({
                name: strategy.name,
                version: strategy.version,
                status: EncryptionStrategyStatus.ACTIVE,
                keys: [key]
            });
            const decryptedKey: TKey = await this.decryptKey(options.strategy, key.value);
            return await strategy.encrypt(value, { keyId: entity.keys[0].id, key: decryptedKey, ...options.strategyOptions });
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
        const key: unknown = await this.findKey(content.keyId);
        return await strategy.decrypt(value, { key, keyId: content.keyId, ...options ?? {} });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createKey<TKey>(
        strategyClass: Newable<EncryptionStrategyInterface<TKey>>,
        data: OmitStrict<EncryptionKeyCreateData, 'strategy' | 'value'>
    ): Promise<EncryptionKey> {
        const strategy: EncryptionStrategyInterface<TKey> = inject(strategyClass);
        const encryptedKey: EncryptionString = await this.generateEncryptedKey(strategy);
        const entity: EncryptionStrategyEntity = await this.encryptionStrategyRepository.findOne(
            { where: { name: strategy.name, version: strategy.version }, relations: ['keys'] }
        );
        const currentDefaultKey: EncryptionKey | undefined = entity.keys.find(k => k.status === EncryptionKeyStatus.DEFAULT);
        if (data.status === EncryptionKeyStatus.DEFAULT && currentDefaultKey) {
            await this.keyRepository.updateById(currentDefaultKey?.id, { status: EncryptionKeyStatus.ACTIVE });
        }
        return await this.keyRepository.create({
            value: encryptedKey,
            strategy: { id: entity.id },
            ...data
        });
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

    private async generateEncryptedKey<TKey>(strategy: EncryptionStrategyInterface<TKey>): Promise<EncryptionString> {
        const rawKey: TKey = await strategy.generateRandomKey();
        const keyBytes: Buffer = await strategy.serializeKey(rawKey);
        const keyBase64: string = keyBytes.toString('base64');
        return await this.masterEncrypt(keyBase64);
    }

    private async findKey<TKey>(keyId: string): Promise<TKey> {
        const entity: EncryptionKey = await this.keyRepository.findById(keyId, { relations: ['strategy'] });
        const strategy: Newable<EncryptionStrategyInterface<TKey>> = this.findStrategyClass(
            entity.strategy.name,
            entity.strategy.version
        );

        return await this.decryptKey(strategy, entity.value);
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
            throw new Error(`No strategy found for ${name} (${version})`);
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
            throw new Error(`No strategy found for ${name} (${version})`);
        }
        return res;
    }

    private async masterEncrypt(keyBase64: string): Promise<EncryptionString> {
        const encrypted: EncryptionString = await this.options.masterStrategy.encrypt(
            keyBase64,
            {
                key: this.options.currentMasterKey.value,
                keyId: this.options.currentMasterKey.id
            }
        );

        const content: EncryptionContent = EncryptionUtilities.encryptionStringToContent(encrypted);
        if (content.keyId !== this.options.currentMasterKey.id) {
            throw new Error(
                `Master key id mismatch: expected ${this.options.currentMasterKey.id}, got ${content.keyId}`
            );
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
            throw new Error(`Could not find master encryption key with id "${content.keyId}"`);
        }
        return await this.options.masterStrategy.decrypt(encrypted, { key: masterKey.value, keyId: masterKey.id });
    }

    private async findDefaultStrategy<TKey>(): Promise<StrategyAndEntity<TKey>> {
        const entity: EncryptionStrategyEntity | undefined = await this.encryptionStrategyRepository.findOne(
            { where: { status: EncryptionStrategyStatus.DEFAULT }, relations: ['keys'] },
            false
        );
        return entity
            ? { strategy: this.findStrategy(entity.name, entity.version), entity }
            : { strategy: this.strategies[0] as EncryptionStrategyInterface<TKey>, entity };
    }

    private validateNoDuplicateEncryptionStrategy(): void {
        // validate that there is no strategy with the same name and version
        const duplicateStrategies: EncryptionStrategyInterface<unknown>[] = this.strategies.filter(
            s => this.strategies.filter(hs => hs.name === s.name && hs.version === s.version).length > 1
        );
        if (duplicateStrategies.length) {
            throw new Error(
                [
                    'There are duplicate encryption strategies:',
                    [...new Set(duplicateStrategies)].map(s => `- ${s.name} (${s.version})`)
                ].join('\n')
            );
        }
    }

    private validateNoMissingEncryptionStrategy(strategies: EncryptionStrategyEntity[]): void {
        const missingStrategies: EncryptionStrategyEntity[] = strategies.filter(
            s => !this.strategies.some(hs => hs.name === s.name && hs.version === s.version)
        );
        if (missingStrategies.length) {
            const message: string[] = ['Error initializing encryption service.', 'There are missing strategies:'];
            for (const strategy of missingStrategies) {
                message.push(`  - ${strategy.name} (${strategy.version})`);
            }
            message.push('Did you remove them?');
            throw new Error(message.join('\n'));
        }
    }

    private validateStrategyNamesAndVersions(): void {
        const strategiesWithDotsInNameOrVersion: EncryptionStrategyInterface<unknown>[] = this.strategies.filter(
            s => s.name.includes('.') || s.version.includes('.')
        );
        if (!strategiesWithDotsInNameOrVersion.length) {
            return;
        }
        const message: string[] = [
            'Error initializing encryption service.',
            'There are strategies that use dots in either the version or the name:'
        ];
        for (const strategy of strategiesWithDotsInNameOrVersion) {
            message.push(`  - ${strategy.name} (${strategy.version})`);
        }
        throw new Error(message.join('\n'));
    }
}