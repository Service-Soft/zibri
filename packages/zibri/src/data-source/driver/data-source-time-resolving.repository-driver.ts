import { ForwardingRepositoryDriver } from './forwarding.repository-driver';
import { RemovalReach } from './removal-reach.model';
import { DriverAggregateOptions,
    DriverFindAndCountOptions,
    DriverFindOptions,
    DriverStreamOptions,
    DriverUpdateAllOptions,
    RepositoryDriverInterface } from './repository-driver.interface';
import { BaseEntity } from '../../entity/base-entity.model';
import { DeepPartial } from '../../types/deep-partial.type';
import { DataSourceTimeUtilities } from '../data-source-time.utilities';
import { AggregateRow } from '../models/aggregate.model';
import { PaginationResult } from '../models/pagination-result.model';
import { RelatedNarrowing } from '../models/related-narrowing.model';
import { UpsertRow } from '../models/upsert-row.model';
import { Where } from '../models/where/where-filter.model';
import { Transaction } from '../transaction/transaction.model';

/**
 * Resolves every time of the data source a call names against the clock of the store, for a driver
 * that cannot compare with that clock inside a statement. The clock is read once per call, and only
 * for a call naming a time.
 */
export class DataSourceTimeResolvingRepositoryDriver<T extends BaseEntity> extends ForwardingRepositoryDriver<T> {
    constructor(
        inner: RepositoryDriverInterface<T>,
        private readonly resolveNow: () => Promise<Date>
    ) {
        super(inner);
    }

    override async save(data: DeepPartial<T>[], transaction: Transaction | undefined, reload: boolean): Promise<T[]> {
        const now: Date | undefined = await this.findNow(data, []);
        return await super.save(this.resolveRows(data, now), transaction, reload);
    }

    override async insert(data: DeepPartial<T>[], transaction: Transaction | undefined): Promise<T[]> {
        const now: Date | undefined = await this.findNow(data, []);
        return await super.insert(this.resolveRows(data, now), transaction);
    }

    override async updateEach(
        rows: DeepPartial<T>[],
        where: Where<T>,
        transaction: Transaction | undefined,
        related?: RelatedNarrowing
    ): Promise<T[]> {
        const now: Date | undefined = await this.findNow(rows, [where]);
        return await super.updateEach(this.resolveRows(rows, now), this.resolveWhere(where, now), transaction, related);
    }

    override async find(options: DriverFindOptions<T>): Promise<T[]> {
        return await super.find(await this.resolveFindOptions(options));
    }

    override async findOne(options: DriverFindOptions<T>): Promise<T | undefined> {
        return await super.findOne(await this.resolveFindOptions(options));
    }

    override async count(options: DriverFindOptions<T>): Promise<number> {
        return await super.count(await this.resolveFindOptions(options));
    }

    override async findIds(options: DriverFindOptions<T>): Promise<string[]> {
        return await super.findIds(await this.resolveFindOptions(options));
    }

    override async aggregate(options: DriverAggregateOptions<T>): Promise<AggregateRow[]> {
        return await super.aggregate(await this.resolveFindOptions(options));
    }

    override async findAndCount(options: DriverFindAndCountOptions<T>): Promise<PaginationResult<T>> {
        const now: Date | undefined = await this.findNow([], [options.where, options.totalWhere]);
        return await super.findAndCount({
            ...options,
            where: this.resolveWhere(options.where, now),
            totalWhere: this.resolveWhere(options.totalWhere, now)
        });
    }

    override stream(options: DriverStreamOptions<T>): AsyncIterable<T> {
        return this.streamResolved(options);
    }

    override async remove(ids: string[], reach: RemovalReach<T> | undefined, transaction: Transaction | undefined): Promise<string[]> {
        const now: Date | undefined = await this.findNow([], [reach?.where]);
        return await super.remove(ids, reach == undefined ? reach : { ...reach, where: this.resolveWhere(reach.where, now) }, transaction);
    }

    override async removeMatching(
        where: Where<T> | undefined,
        related: RelatedNarrowing | undefined,
        transaction: Transaction | undefined
    ): Promise<string[]> {
        const now: Date | undefined = await this.findNow([], [where]);
        return await super.removeMatching(this.resolveWhere(where, now), related, transaction);
    }

    override async updateAll<R extends boolean = false>(options: DriverUpdateAllOptions<T, R>): Promise<R extends true ? T[] : number> {
        const now: Date | undefined = await this.findNow([options.data], [options.where]);
        return await super.updateAll({
            ...options,
            where: this.resolveWhere(options.where, now),
            data: this.resolveRows([options.data], now)[0] ?? options.data
        });
    }

    override async upsert(
        identity: string[],
        rows: UpsertRow<T>[],
        transaction: Transaction | undefined,
        reachable: Where<T> | undefined,
        related?: RelatedNarrowing
    ): Promise<T[]> {
        const now: Date | undefined = await this.findNow([], [reachable, ...rows.map(r => r.where)]);
        return await super.upsert(
            identity,
            rows.map(row => row.where == undefined ? row : { ...row, where: this.resolveWhere(row.where, now) }),
            transaction,
            this.resolveWhere(reachable, now),
            related
        );
    }

    private async* streamResolved(options: DriverStreamOptions<T>): AsyncIterable<T> {
        yield* super.stream(await this.resolveFindOptions(options));
    }

    private async resolveFindOptions<O extends Pick<DriverFindOptions<T>, 'where'>>(options: O): Promise<O> {
        const now: Date | undefined = await this.findNow([], [options.where]);
        return now == undefined ? options : { ...options, where: this.resolveWhere(options.where, now) };
    }

    /**
     * Reads the clock of the store when a call names a time of the data source, and only then.
     * @param rows - The rows the call writes.
     * @param wheres - The filters it takes.
     * @returns What the clock says, or undefined when the call names no time.
     */
    private async findNow(rows: object[], wheres: unknown[]): Promise<Date | undefined> {
        const named: boolean = rows.some(row => DataSourceTimeUtilities.isNamedInRow(row))
            || wheres.some(where => DataSourceTimeUtilities.isNamedInWhere(where));
        return named ? await this.resolveNow() : undefined;
    }

    private resolveRows(rows: DeepPartial<T>[], now: Date | undefined): DeepPartial<T>[] {
        return now == undefined ? rows : rows.map(row => DataSourceTimeUtilities.resolveInRow(row, now));
    }

    private resolveWhere<W extends Where<T> | undefined>(where: W, now: Date | undefined): W {
        return now == undefined ? where : DataSourceTimeUtilities.resolveInWhere(where, now);
    }
}