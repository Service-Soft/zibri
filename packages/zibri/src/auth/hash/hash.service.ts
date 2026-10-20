import { HashOptions, HashServiceInterface } from './hash-service.interface.ts';
import { HashContent, HashString, HashUtilities } from './hash.utilities.ts';
import { HashStrategyEntity, HashStrategyEntityCreateData, HashStrategyStatus } from './strategies/hash-strategy-entity.model.ts';
import { HashStrategyInterface } from './strategies/hash-strategy.interface.ts';
import { ZibriApplication } from '../../application/application.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { Inject } from '../../di/decorators/inject.decorator.ts';
import { Injectable } from '../../di/decorators/injectable.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { register } from '../../di/register.function.ts';
import type { BaseEntity } from '../../entity/base-entity.model.ts';
import { type PropertyMetadata } from '../../entity/decorators/property.decorator.ts';
import { InternalError } from '../../error-handling/internal-error.model.ts';
import { ModelRegistry } from '../../global/model-registry/model.registry.ts';
import { OnAppInit } from '../../global/on-app-init.interface.ts';
import type { Newable } from '../../types/newable.type.ts';
import { MetadataUtilities } from '../../utilities/metadata.utilities.ts';
import { validateEntitiesRegistered } from '../../utilities/validate-entities-registered.function.ts';

/**
 * A property a unique declaration names, hashed by a strategy known before any row is written.
 */
type UniqueHashedProperty = {
    /**
     * The entity declaring it, for the message.
     */
    entityName: string,
    /**
     * The property.
     */
    key: string,
    /**
     * How it is hashed: with the default strategy, or the one named.
     */
    hash: true | HashOptions<Record<string, unknown>>
};

/**
 * An error to throw during hash service initialization.
 */
class InitHashServiceError extends InternalError {
    constructor(message: string | string[]) {
        const messageArray: string[] = typeof message === 'string' ? [message] : message;
        super(['Error initializing hash service.', ...messageArray]);
        this.name = 'InitHashServiceError';
    }
}

/**
 * Default hash service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class HashService implements HashServiceInterface, OnAppInit {
    private loadedStrategies: HashStrategyInterface<Record<string, unknown>>[] | undefined;

    // built when first asked for rather than in onAppInit, because migrations run before it and may
    // write hashed values. Nothing a strategy needs waits for the application: it is built by the
    // container and hashes in process
    private get strategies(): HashStrategyInterface<Record<string, unknown>>[] {
        this.loadedStrategies ??= this.hashStrategies.map(strategy => {
            register({ token: strategy, useClass: strategy });
            return inject(strategy);
        });
        return this.loadedStrategies;
    }

    private hasCreatedInitialDefaultStrategy: boolean = false;

    // read when used rather than injected, so that an application without the entity is told to
    // declare it by onAppInit, instead of failing on a repository token while this is built
    private get hashStrategyRepository(): Repository<HashStrategyEntity, HashStrategyEntityCreateData> {
        return inject(repositoryTokenFor(HashStrategyEntity));
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.HASH_STRATEGIES)
        private readonly hashStrategies: Newable<HashStrategyInterface<Record<string, unknown>>>[]
    ) {}

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async onAppInit(app: ZibriApplication): Promise<void> {
        // at every boot that uses this implementation, since its lifecycle hook makes every boot build it
        validateEntitiesRegistered(HashService.name, app, HashStrategyEntity);
        if (!this.hashStrategies.length) {
            throw new InitHashServiceError('Needs to provide at least one hash strategy.');
        }
        this.validateNoDuplicateHashStrategy();
        await this.validateNoMissingHashStrategy();
        this.validateStrategyNamesAndVersions();
        await this.validateUniqueHashesCompare(app);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async hash<THashOptions extends Record<string, unknown>>(
        value: string,
        options?: HashOptions<THashOptions>
    ): Promise<HashString> {
        if (!options) {
            const strategy: HashStrategyInterface<Record<string, unknown>> = await this.findDefaultStrategy();
            if (!this.hasCreatedInitialDefaultStrategy && !(await this.hashStrategyRepository.findAll()).length) {
                await this.hashStrategyRepository.create({
                    name: strategy.name,
                    version: strategy.version,
                    status: HashStrategyStatus.DEFAULT
                });
                this.hasCreatedInitialDefaultStrategy = true;
            }
            else if (!(await this.hashStrategyRepository.findAll({ where: { name: strategy.name, version: strategy.version } })).length) {
                await this.hashStrategyRepository.create({
                    name: strategy.name,
                    version: strategy.version,
                    status: HashStrategyStatus.ACTIVE
                });
            }
            return await strategy.hash(value, options);
        }

        const strategy: HashStrategyInterface<Record<string, unknown>> | undefined = this.strategies.find(
            s => s instanceof options.strategy
        );
        if (!strategy) {
            throw new InternalError(
                `The given strategy ${options.strategy.name} was not provided as part of ZIBRI_DI_TOKENS.HASH_STRATEGIES`
            );
        }
        return await strategy.hash(value, options.strategyOptions);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async equal(value: string, hash: HashString): Promise<boolean> {
        const strategy: HashStrategyInterface<Record<string, unknown>> = this.findStrategyForHash(hash);
        return await strategy.equal(value, hash);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async needsRehash(hash: HashString): Promise<boolean> {
        const strategy: HashStrategyInterface<Record<string, unknown>> = this.findStrategyForHash(hash);
        const deprecated: boolean = (await this.hashStrategyRepository.findOne(
            { where: { name: strategy.name, version: strategy.version } }
        )).status === HashStrategyStatus.DEPRECATED;
        // either reason counts: the whole strategy was retired, or this particular hash was made
        // before the cost was raised. The second is the common one - nobody retires scrypt, they
        // just stop being willing to pay 2014 prices for it.
        return deprecated || (strategy.needsRehash?.(hash) ?? false);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    isHash(value: string): boolean {
        // not hashToContent, which throws: this is asked about arbitrary input, where "not a hash" is
        // the ordinary answer rather than a fault
        const [strategyName, version, ...hashedValueParts] = value.split('.');
        const hashedValue: string = hashedValueParts.join('.');
        if (!strategyName || !version || !hashedValue) {
            return false;
        }

        const strategy: HashStrategyInterface<Record<string, unknown>> | undefined = this.strategies.find(
            s => s.name === strategyName && s.version === version
        );
        if (!strategy) {
            return false;
        }
        // a strategy that cannot identify its own output is taken at its word, which is the weaker
        // answer but never a wrong one for a value this application actually produced
        return strategy.isHashedValue?.(hashedValue) ?? true;
    }

    private findStrategy(name: string, version: string): HashStrategyInterface<Record<string, unknown>> {
        const res: HashStrategyInterface<Record<string, unknown>> | undefined = this.strategies.find(
            s => s.name === name && s.version === version
        );
        if (!res) {
            throw new InternalError(`No strategy found for ${name} (${version})`);
        }
        return res;
    }

    private async findDefaultStrategy(): Promise<HashStrategyInterface<Record<string, unknown>>> {
        const entity: HashStrategyEntity | undefined = await this.hashStrategyRepository.findOne(
            { where: { status: HashStrategyStatus.DEFAULT }, required: false }
        );
        const strategy: HashStrategyInterface<Record<string, unknown>> | undefined = entity
            ? this.findStrategy(entity.name, entity.version)
            : this.strategies.find(s => !s.deterministic);

        // the default strategy is what every unqualified hash goes through, which in practice means
        // passwords. A deterministic strategy is unsalted by definition, so letting one become the
        // default - by being registered first, or by a row in the strategy table - would silently
        // turn every stored password into a rainbow table lookup.
        if (!strategy || strategy.deterministic) {
            throw new InternalError(
                strategy
                    ? `The hash strategy "${strategy.name}" is deterministic and cannot be the default strategy.`
                    : 'No non-deterministic hash strategy was provided to use as the default.'
            );
        }
        return strategy;
    }

    private findStrategyForHash(hash: HashString): HashStrategyInterface<Record<string, unknown>> {
        const content: HashContent = HashUtilities.hashToContent(hash);
        return this.findStrategy(content.strategyName, content.version);
    }

    private validateNoDuplicateHashStrategy(): void {
        // validate that there is no strategy with the same name and version
        const duplicateStrategies: HashStrategyInterface<Record<string, unknown>>[] = this.strategies.filter(
            s => this.strategies.filter(hs => hs.name === s.name && hs.version === s.version).length > 1
        );
        if (duplicateStrategies.length) {
            throw new InitHashServiceError(
                [
                    'There are duplicate hash strategies:',
                    ...[...new Set(duplicateStrategies)].map(s => `- ${s.name} (${s.version})`)
                ]
            );
        }
    }

    private async validateNoMissingHashStrategy(): Promise<void> {
        const strategies: HashStrategyEntity[] = await this.hashStrategyRepository.findAll();
        const missingStrategies: HashStrategyEntity[] = strategies.filter(
            s => !this.strategies.some(hs => hs.name === s.name && hs.version === s.version)
        );
        if (missingStrategies.length) {
            throw new InitHashServiceError([
                'There are missing strategies:',
                ...missingStrategies.map(s => `  - ${s.name} (${s.version})`),
                'Did you remove them?'
            ]);
        }
    }

    /**
     * Refuses a unique declaration over a property hashed by a strategy that does not hash one value
     * the same way every time.
     *
     * A unique declaration compares what is stored, and a salted hash of the same value is stored
     * differently each time, so the declaration would reject nothing while reading as if it did. Only
     * the built strategy says whether it is deterministic, which is why this is decided here rather
     * than where the entity is declared. A hash decided per row is refused there instead.
     * @param app - The application, whose data sources hold the entities.
     * @throws When a unique declaration names such a property.
     */
    private async validateUniqueHashesCompare(app: ZibriApplication): Promise<void> {
        const declared: UniqueHashedProperty[] = app.options.dataSources
            .flatMap(dataSourceClass => inject(dataSourceClass).entities)
            .flatMap(entityClass => this.findUniqueHashedProperties(entityClass));
        // read once and only when asked for, since it is a read of the strategy table
        const defaultStrategy: HashStrategyInterface<Record<string, unknown>> | undefined = declared.some(d => d.hash === true)
            ? await this.findDefaultStrategy()
            : undefined;

        const refused: string[] = declared.flatMap(({ entityName, key, hash }) => {
            const strategy: HashStrategyInterface<Record<string, unknown>> | undefined = hash === true
                ? defaultStrategy
                : this.strategies.find(s => s instanceof hash.strategy);
            return strategy == undefined || strategy.deterministic ? [] : [`- ${entityName}.${key}, hashed with "${strategy.name}"`];
        });
        if (!refused.length) {
            return;
        }
        throw new InitHashServiceError([
            'These properties are declared unique, and hashed by a strategy that does not hash one value the same way twice:',
            ...refused,
            'Their stored values never repeat, so the declaration would reject nothing.',
            'Hash them with a deterministic strategy, eg. "hash: { strategy: Sha256HashStrategy }", or drop the unique.'
        ]);
    }

    /**
     * The properties of an entity that a unique declaration names and that are hashed by a strategy
     * known before a row is written.
     * @param entityClass - The entity.
     * @returns Those properties, with how each one is hashed.
     */
    private findUniqueHashedProperties(entityClass: Newable<BaseEntity>): UniqueHashedProperty[] {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        const keys: string[] = [...new Set(ModelRegistry.get(entityClass).keyDescriptor.uniques.flatMap(g => g.properties))];
        return keys.flatMap(key => {
            const metadata: PropertyMetadata | undefined = properties[key];
            const hash: unknown = metadata != undefined && 'hash' in metadata ? metadata.hash : undefined;
            return hash === true || this.isHashOptions(hash) ? [{ entityName: entityClass.name, key, hash }] : [];
        });
    }

    private isHashOptions(value: unknown): value is HashOptions<Record<string, unknown>> {
        return typeof value === 'object' && value != undefined && 'strategy' in value;
    }

    private validateStrategyNamesAndVersions(): void {
        const strategiesWithDotsInNameOrVersion: HashStrategyInterface<Record<string, unknown>>[] = this.strategies.filter(
            s => s.name.includes('.') || s.version.includes('.')
        );
        if (!strategiesWithDotsInNameOrVersion.length) {
            return;
        }

        throw new InitHashServiceError([
            'There are strategies that use dots in either the version or the name:',
            ...strategiesWithDotsInNameOrVersion.map(s => `  - ${s.name} (${s.version})`)
        ]);
    }
}