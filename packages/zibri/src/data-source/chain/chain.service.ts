import { BaseChainedEntity } from './base-chained-entity.model';
import { ChainAnchor, ChainAnchorCreateData } from './chain-anchor.model';
import { ChainLink, ChainServiceInterface } from './chain-service.interface';
import { ChainVerification } from './chain-verification.model';
import { ChainUtilities } from './chain.utilities';
import { type ZibriApplication } from '../../application/application';
import { type EncryptionServiceInterface } from '../../auth/encryption/encryption-service.interface';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { EntityTenant } from '../../entity/models/entity-tenant.model';
import { OnAppInit } from '../../global/on-app-init.interface';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { validateEntitiesRegistered } from '../../utilities/validate-entities-registered.function';
import { GroupKeysOf } from '../models/aggregate.model';
import { Where, WhereFilter } from '../models/where/where-filter.model';
import { AppendOnlyUtilities } from '../repository/append-only.utilities';
import { Repository } from '../repository/repository';
import { Transaction } from '../transaction/transaction.model';

/**
 * The name of the signing key every chain is hashed with.
 */
const SIGNING_KEY_NAME: string = 'chain';

/**
 * How many rows of a chain are read at once while it is checked or pruned.
 */
const PAGE_SIZE: number = 1000;

/**
 * Where a chain ends: the place and the hash its next row is linked to.
 */
type ChainHead = {
    /**
     * The place of the newest row, or of the anchor, or 0.
     */
    sequence: number,
    /**
     * The hash of the newest row, or of the anchor, or an empty string.
     */
    hash: string
};

/**
 * Default chain service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class ChainService implements ChainServiceInterface, OnAppInit {
    // read when used, so that an application without the entity is told so by onAppInit
    private get anchorRepository(): Repository<ChainAnchor, ChainAnchorCreateData> {
        return inject(repositoryTokenFor(ChainAnchor));
    }

    constructor(
        @Inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE)
        private readonly encryptionService: EncryptionServiceInterface
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        const declaresChained: boolean = app.options.dataSources
            .some(dataSource => inject(dataSource).entities.some(e => MetadataUtilities.getEntityMetadata(e)?.chained === true));
        if (declaresChained) {
            validateEntitiesRegistered(ChainService.name, app, ChainAnchor);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveLinks(
        entityClass: Newable<BaseChainedEntity>,
        rows: object[],
        transaction: Transaction | undefined
    ): Promise<ChainLink[]> {
        if (!rows.length) {
            return [];
        }
        const key: Buffer = await this.encryptionService.resolveSigningKey(SIGNING_KEY_NAME);
        const byChain: Map<string, number[]> = new Map();
        for (const [index, row] of rows.entries()) {
            const chain: string = this.resolveChainOf(entityClass, row);
            byChain.set(chain, [...byChain.get(chain) ?? [], index]);
        }
        const heads: Map<string, ChainHead> = await this.resolveHeads(entityClass, [...byChain.keys()], transaction);
        const links: ChainLink[] = [];
        for (const [chain, indexes] of byChain) {
            let { sequence, hash } = heads.get(chain) ?? { sequence: 0, hash: '' };
            for (const index of indexes) {
                sequence++;
                hash = ChainUtilities.resolveRowHash(key, entityClass, chain, hash, { ...rows[index], chainSequence: sequence });
                links[index] = { chainSequence: sequence, chainHash: hash };
            }
        }
        return links;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveChainVerification(entityClass: Newable<BaseChainedEntity>, chain: string = ''): Promise<ChainVerification> {
        const key: Buffer = await this.encryptionService.resolveSigningKey(SIGNING_KEY_NAME);
        const anchor: ChainAnchor | undefined = await this.findAnchor(entityClass, chain, undefined);
        if (
            anchor != undefined
            && anchor.seal !== ChainUtilities.resolveAnchorSeal(key, entityClass, chain, anchor.sequence, anchor.hash)
        ) {
            return {
                intact: false,
                brokenAtSequence: anchor.sequence,
                reason: 'Where the chain starts was not written by this application.'
            };
        }
        const repository: Repository<BaseChainedEntity> = inject(repositoryTokenFor(entityClass));
        let expected: number = (anchor?.sequence ?? 0) + 1;
        let previous: string = anchor?.hash ?? '';
        for (;;) {
            const page: BaseChainedEntity[] = await repository.findAll({
                where: { ...this.resolveChainFilter(entityClass, chain), chainSequence: { greaterThanEquals: expected } },
                order: { chainSequence: 'ASC' },
                limit: PAGE_SIZE,
                acrossTenants: true,
                unscoped: true
            });
            for (const row of page) {
                if (row.chainSequence !== expected) {
                    return {
                        intact: false,
                        brokenAtSequence: row.chainSequence,
                        reason: `The rows from ${expected} to ${row.chainSequence - 1} are missing.`
                    };
                }
                if (row.chainHash !== ChainUtilities.resolveRowHash(key, entityClass, chain, previous, row)) {
                    return { intact: false, brokenAtSequence: row.chainSequence, reason: 'The row is not as it was written.' };
                }
                previous = row.chainHash;
                expected++;
            }
            if (page.length < PAGE_SIZE) {
                return { intact: true, newestSequence: expected - 1, newestHash: previous };
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async pruneChains(entityClass: Newable<BaseChainedEntity>, where: Where<BaseChainedEntity>): Promise<number> {
        const repository: Repository<BaseChainedEntity> = inject(repositoryTokenFor(entityClass));
        const key: Buffer = await this.encryptionService.resolveSigningKey(SIGNING_KEY_NAME);
        let removed: number = 0;
        for (const chain of await this.findChainsMatching(entityClass, where)) {
            const anchor: ChainAnchor | undefined = await this.findAnchor(entityClass, chain, undefined);
            const last: ChainHead | undefined
                = await this.findLeadingRun(repository, entityClass, chain, where, (anchor?.sequence ?? 0) + 1);
            if (last != undefined) {
                // the anchor first: once the rows are gone, the chain reads from it. A removal that
                // fails after it leaves rows behind the anchor, which nothing reads and the next
                // pruning removes, where the other order would leave a chain missing its start
                const seal: string = ChainUtilities.resolveAnchorSeal(key, entityClass, chain, last.sequence, last.hash);
                const tableName: string = ChainUtilities.getTableName(entityClass);
                await this.anchorRepository.upsert(
                    { tableName, chain },
                    { tableName, chain, sequence: last.sequence, hash: last.hash, seal },
                    { sequence: { set: last.sequence }, hash: { set: last.hash }, seal: { set: seal } }
                );
            }
            const through: number = Math.max(anchor?.sequence ?? 0, last?.sequence ?? 0);
            if (through > 0) {
                removed += await AppendOnlyUtilities.runPruning(entityClass, async () => await repository.deleteAll(
                    { ...this.resolveChainFilter(entityClass, chain), chainSequence: { lesserThanEquals: through } },
                    { acrossTenants: true, unscoped: true }
                ));
            }
        }
        return removed;
    }

    /**
     * Finds the newest row of the leading run of a chain the filter matches: the rows from its start
     * on, up to the first one the filter does not match.
     * @param repository - The repository of the chained entity.
     * @param entityClass - The chained entity.
     * @param chain - The tenant of the chain, or an empty string for the rows of no tenant.
     * @param where - The filter.
     * @param start - The place the chain starts at.
     * @returns The newest row of the run, or undefined when its start does not match.
     */
    private async findLeadingRun(
        repository: Repository<BaseChainedEntity>,
        entityClass: Newable<BaseChainedEntity>,
        chain: string,
        where: Where<BaseChainedEntity>,
        start: number
    ): Promise<ChainHead | undefined> {
        let expected: number = start;
        let last: ChainHead | undefined;
        for (;;) {
            const narrowing: WhereFilter<BaseChainedEntity> = {
                ...this.resolveChainFilter(entityClass, chain),
                chainSequence: { greaterThanEquals: expected }
            };
            const page: BaseChainedEntity[] = await repository.findAll({
                // each branch narrowed alike, since the filter names neither the tenant nor the place
                where: Array.isArray(where) ? where.map(branch => ({ ...branch, ...narrowing })) : { ...where, ...narrowing },
                order: { chainSequence: 'ASC' },
                limit: PAGE_SIZE,
                acrossTenants: true,
                unscoped: true
            });
            for (const row of page) {
                if (row.chainSequence !== expected) {
                    return last;
                }
                last = { sequence: row.chainSequence, hash: row.chainHash };
                expected++;
            }
            if (page.length < PAGE_SIZE) {
                return last;
            }
        }
    }

    /**
     * Finds the chains holding a row the filter matches.
     * @param entityClass - The chained entity.
     * @param where - The filter.
     * @returns Their tenants, with an empty string for the chain of the rows of no tenant.
     */
    private async findChainsMatching(entityClass: Newable<BaseChainedEntity>, where: Where<BaseChainedEntity>): Promise<string[]> {
        const tenantProperty: string | undefined = this.findTenantProperty(entityClass);
        if (tenantProperty == undefined) {
            return [''];
        }
        const repository: Repository<BaseChainedEntity> = inject(repositoryTokenFor(entityClass));
        // the entity declares the tenant property and the base it is read through does not, which is
        // the one thing that has to be said to the compiler here
        const groupBy: readonly GroupKeysOf<BaseChainedEntity>[] = [tenantProperty] as unknown as readonly GroupKeysOf<BaseChainedEntity>[];
        const groups: object[] = await repository.count({ where, groupBy, acrossTenants: true, unscoped: true });
        return groups.map(group => {
            const tenantId: unknown = Reflect.get(group, tenantProperty);
            return typeof tenantId === 'string' ? tenantId : '';
        });
    }

    /**
     * Resolves where each of some chains ends.
     *
     * A fixed number of reads however many chains a write reaches, since a burst of audit events
     * reaches one per tenant: the newest place of every chain in one grouped read, the rows at those
     * places in a second, and the anchors of the chains holding no row in a third.
     * @param entityClass - The chained entity.
     * @param chains - The tenants of the chains, with an empty string for the rows of no tenant.
     * @param transaction - The transaction the rows are written in, if any.
     * @returns The place and the hash the next row of each chain is linked to, by chain. A chain
     * missing from it starts at 0.
     */
    private async resolveHeads(
        entityClass: Newable<BaseChainedEntity>,
        chains: string[],
        transaction: Transaction | undefined
    ): Promise<Map<string, ChainHead>> {
        const repository: Repository<BaseChainedEntity> = inject(repositoryTokenFor(entityClass));
        const newestPlaces: Map<string, number> = await this.resolveNewestPlaces(repository, entityClass, chains, transaction);

        const heads: Map<string, ChainHead> = new Map();
        if (newestPlaces.size) {
            const newestRows: BaseChainedEntity[] = await repository.findAll({
                where: [...newestPlaces].map(([chain, sequence]) => ({
                    ...this.resolveChainFilter(entityClass, chain),
                    chainSequence: sequence
                })),
                acrossTenants: true,
                unscoped: true,
                transaction
            });
            for (const row of newestRows) {
                heads.set(this.resolveChainOf(entityClass, row), { sequence: row.chainSequence, hash: row.chainHash });
            }
        }
        const withoutRows: string[] = chains.filter(chain => !heads.has(chain));
        if (withoutRows.length) {
            const anchorRepository: Repository<ChainAnchor, ChainAnchorCreateData> = this.anchorRepository;
            const anchors: ChainAnchor[] = await anchorRepository.findAll({
                where: { tableName: ChainUtilities.getTableName(entityClass), chain: { oneOf: withoutRows } },
                // only a transaction of the data source holding the anchors: the chained entity may be
                // kept in another one, whose transaction the anchors' store cannot run in. Anchors are
                // written by pruning alone, never inside a write, so reading them outside it misses nothing
                transaction: anchorRepository.dataSource === repository.dataSource ? transaction : undefined
            });
            for (const anchor of anchors) {
                heads.set(anchor.chain, { sequence: anchor.sequence, hash: anchor.hash });
            }
        }
        return heads;
    }

    /**
     * Resolves the newest place of each of some chains, in one grouped read.
     * @param repository - The repository of the chained entity.
     * @param entityClass - The chained entity.
     * @param chains - The tenants of the chains, with an empty string for the rows of no tenant.
     * @param transaction - The transaction the rows are written in, if any.
     * @returns The newest place by chain. A chain holding no row is missing from it.
     */
    private async resolveNewestPlaces(
        repository: Repository<BaseChainedEntity>,
        entityClass: Newable<BaseChainedEntity>,
        chains: string[],
        transaction: Transaction | undefined
    ): Promise<Map<string, number>> {
        const tenantProperty: string | undefined = this.findTenantProperty(entityClass);
        const newestPlaces: Map<string, number> = new Map();
        if (tenantProperty == undefined) {
            const newest: number | undefined = await repository.maximum(
                'chainSequence',
                { acrossTenants: true, unscoped: true, transaction }
            );
            if (newest != undefined) {
                newestPlaces.set('', newest);
            }
            return newestPlaces;
        }
        // for the reason findChainsMatching gives
        const groupBy: readonly GroupKeysOf<BaseChainedEntity>[]
            = [tenantProperty] as unknown as readonly GroupKeysOf<BaseChainedEntity>[];
        const groups: object[] = await repository.maximum('chainSequence', {
            where: chains.map(chain => this.resolveChainFilter(entityClass, chain)),
            groupBy,
            acrossTenants: true,
            unscoped: true,
            transaction
        });
        for (const group of groups) {
            const tenantId: unknown = Reflect.get(group, tenantProperty);
            const newest: unknown = Reflect.get(group, 'maximum');
            if (typeof newest === 'number') {
                newestPlaces.set(typeof tenantId === 'string' ? tenantId : '', newest);
            }
        }
        return newestPlaces;
    }

    private async findAnchor(
        entityClass: Newable<BaseChainedEntity>,
        chain: string,
        transaction: Transaction | undefined
    ): Promise<ChainAnchor | undefined> {
        return await this.anchorRepository.findOne({
            where: { tableName: ChainUtilities.getTableName(entityClass), chain },
            transaction,
            required: false
        });
    }

    /**
     * The filter that reaches the rows of one chain.
     * @param entityClass - The chained entity.
     * @param chain - The tenant of the chain, or an empty string for the rows of no tenant.
     * @returns The filter.
     */
    private resolveChainFilter(entityClass: Newable<BaseChainedEntity>, chain: string): WhereFilter<BaseChainedEntity> {
        const tenantProperty: string | undefined = this.findTenantProperty(entityClass);
        // eslint-disable-next-line unicorn/no-null
        return tenantProperty == undefined ? {} : Object.fromEntries([[tenantProperty, chain === '' ? null : chain]]);
    }

    private resolveChainOf(entityClass: Newable<BaseChainedEntity>, row: object): string {
        const tenantProperty: string | undefined = this.findTenantProperty(entityClass);
        const tenantId: unknown = tenantProperty == undefined ? undefined : Reflect.get(row, tenantProperty);
        return typeof tenantId === 'string' ? tenantId : '';
    }

    private findTenantProperty(entityClass: Newable<BaseChainedEntity>): string | undefined {
        const tenant: EntityTenant | undefined = MetadataUtilities.getEntityMetadata(entityClass)?.tenant;
        return tenant == undefined || tenant === 'shared' ? undefined : tenant.property;
    }
}