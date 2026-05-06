import { HashOptions, HashServiceInterface } from './hash-service.interface';
import { HashContent, HashString, HashUtilities } from './hash.utilities';
import { HashStrategyEntity, HashStrategyEntityCreateData, HashStrategyStatus } from './strategies/hash-strategy-entity.model';
import { HashStrategyInterface } from './strategies/hash-strategy.interface';
import { Repository } from '../../data-source/repository';
import { InjectRepository } from '../../di/decorators/inject-repository.decorator';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { register } from '../../di/register.function';
import { OnAppInit } from '../../global/on-app-init.interface';
import type { Newable } from '../../types/newable.type';

/**
 * Default hash service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class HashService implements HashServiceInterface, OnAppInit {
    private readonly strategies: HashStrategyInterface<Record<string, unknown>>[] = [];

    private hasCreatedInitialDefaultStrategy: boolean = false;

    constructor(
        @InjectRepository(HashStrategyEntity)
        private readonly hashStrategyRepository: Repository<HashStrategyEntity, HashStrategyEntityCreateData>,
        @Inject(ZIBRI_DI_TOKENS.HASH_STRATEGIES)
        private readonly hashStrategies: Newable<HashStrategyInterface<Record<string, unknown>>>[]
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit(): Promise<void> {
        if (!this.hashStrategies.length) {
            throw new Error('Needs to provide at least one hash strategy.');
        }
        for (const strategy of this.hashStrategies) {
            register({ token: strategy, useClass: strategy });
            this.strategies.push(inject(strategy));
        }
        this.validateNoDuplicateHashStrategy();
        await this.validateNoMissingHashStrategy();
        this.validateStrategyNamesAndVersions();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
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
            throw new Error(`The given strategy ${options.strategy.name} was not provided as part of ZIBRI_DI_TOKENS.HASH_STRATEGIES`);
        }
        return await strategy.hash(value, options.strategyOptions);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async equal(value: string, hash: HashString): Promise<boolean> {
        const strategy: HashStrategyInterface<Record<string, unknown>> = this.findStrategyForHash(hash);
        return await strategy.equal(value, hash);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async needsRehash(hash: HashString): Promise<boolean> {
        const strategy: HashStrategyInterface<Record<string, unknown>> = this.findStrategyForHash(hash);
        return (await this.hashStrategyRepository.findOne(
            { where: { name: strategy.name, version: strategy.version } }
        )).status === HashStrategyStatus.DEPRECATED;
    }

    private findStrategy(name: string, version: string): HashStrategyInterface<Record<string, unknown>> {
        const res: HashStrategyInterface<Record<string, unknown>> | undefined = this.strategies.find(
            s => s.name === name && s.version === version
        );
        if (!res) {
            throw new Error(`No strategy found for ${name} (${version})`);
        }
        return res;
    }

    private async findDefaultStrategy(): Promise<HashStrategyInterface<Record<string, unknown>>> {
        const entity: HashStrategyEntity | undefined = await this.hashStrategyRepository.findOne(
            { where: { status: HashStrategyStatus.DEFAULT } },
            false
        );
        return entity
            ? this.findStrategy(entity.name, entity.version)
            : this.strategies[0];
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
            throw new Error(
                [
                    'There are duplicate hash strategies:',
                    [...new Set(duplicateStrategies)].map(s => `- ${s.name} (${s.version})`)
                ].join('\n')
            );
        }
    }

    private async validateNoMissingHashStrategy(): Promise<void> {
        const strategies: HashStrategyEntity[] = await this.hashStrategyRepository.findAll();
        const missingStrategies: HashStrategyEntity[] = strategies.filter(
            s => !this.strategies.some(hs => hs.name === s.name && hs.version === s.version)
        );
        if (missingStrategies.length) {
            const message: string[] = ['Error initializing hash service.', 'There are missing strategies:'];
            for (const strategy of missingStrategies) {
                message.push(`  - ${strategy.name} (${strategy.version})`);
            }
            message.push('Did you remove them?');
            throw new Error(message.join('\n'));
        }
    }

    private validateStrategyNamesAndVersions(): void {
        const strategiesWithDotsInNameOrVersion: HashStrategyInterface<Record<string, unknown>>[] = this.strategies.filter(
            s => s.name.includes('.') || s.version.includes('.')
        );
        if (!strategiesWithDotsInNameOrVersion.length) {
            return;
        }
        const message: string[] = [
            'Error initializing hash service.',
            'There are strategies that use dots in either the version or the name:'
        ];
        for (const strategy of strategiesWithDotsInNameOrVersion) {
            message.push(`  - ${strategy.name} (${strategy.version})`);
        }
        throw new Error(message.join('\n'));
    }
}