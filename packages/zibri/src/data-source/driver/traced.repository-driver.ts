import { ForwardingRepositoryDriver } from './forwarding.repository-driver';
import { RemovalReach } from './removal-reach.model';
import { DriverAggregateOptions, DriverFindAndCountOptions, DriverFindOptions, DriverStreamOptions, DriverUpdateAllOptions, RepositoryDriverInterface } from './repository-driver.interface';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { TraceSpanAttributeName } from '../../tracing/trace-span-attributes.model';
import { TraceSpanKind } from '../../tracing/trace-span-kind.enum';
import { TraceSpanInterface } from '../../tracing/trace-span.interface';
import { type TracerInterface } from '../../tracing/tracer.interface';
import { TracingUtilities } from '../../tracing/tracing.utilities';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';
import { AggregateRow } from '../models/aggregate.model';
import { FindAllOptions } from '../models/options/find-all-options.model';
import { PaginationResult } from '../models/pagination-result.model';
import { RelatedNarrowing } from '../models/related-narrowing.model';
import { UpsertRow } from '../models/upsert-row.model';
import { Where } from '../models/where/where-filter.model';
import { Transaction } from '../transaction/transaction.model';

/**
 * How many rows the store answered with, which every operation that answers with rows records.
 */
const returnedRows: TraceSpanAttributeName = 'db.response.returned_rows';

/**
 * What a span of one store operation records about it before it runs.
 */
type StoreOperationAttributes = {
    /**
     * What the driver was asked to do.
     */
    'db.operation.name': string,
    /**
     * Which entity it was asked about.
     */
    'db.collection.name': string
};

/**
 * Records every read and write a repository makes of its store as a span.
 *
 * Wrapped around the driver rather than written into the repository above it, for two reasons. A
 * repository operation is not one store operation - an update is a write and the read that proves
 * it landed, and seeing both is the whole point of tracing a data layer at all. And there is one
 * seam here and fourteen up there, so this is also where it stays right as the repository grows.
 *
 * Every method forwards. What is added is the span around it.
 */
export class TracedRepositoryDriver<T extends BaseEntity> extends ForwardingRepositoryDriver<T> {
    /**
     * The tracer the spans are started with, once resolved.
     */
    private tracer: TracerInterface | undefined;

    constructor(
        inner: RepositoryDriverInterface<T>,
        private readonly entityClass: Newable<T>
    ) {
        super(inner);
    }

    override async save(data: DeepPartial<T>[], transaction: Transaction | undefined, reload: boolean): Promise<T[]> {
        return await this.traced('save', async span => {
            const res: T[] = await super.save(data, transaction, reload);
            span.recordAttribute(returnedRows, res.length);
            return res;
        });
    }

    override async insert(data: DeepPartial<T>[], transaction: Transaction | undefined): Promise<T[]> {
        return await this.traced('insert', async span => {
            const res: T[] = await super.insert(data, transaction);
            span.recordAttribute(returnedRows, res.length);
            return res;
        });
    }

    override async updateEach(
        rows: DeepPartial<T>[],
        where: Where<T>,
        transaction: Transaction | undefined,
        related?: RelatedNarrowing
    ): Promise<T[]> {
        return await this.traced('updateEach', async span => {
            const res: T[] = await super.updateEach(rows, where, transaction, related);
            span.recordAttribute(returnedRows, res.length);
            return res;
        });
    }

    override async find(options: DriverFindOptions<T>): Promise<T[]> {
        return await this.traced('find', async span => {
            const res: T[] = await super.find(options);
            span.recordAttribute(returnedRows, res.length);
            return res;
        });
    }

    override async resolveRelations(
        entities: T[],
        relations: FindAllOptions<T>['relations'],
        related: RelatedNarrowing | undefined,
        transaction: Transaction | undefined
    ): Promise<T[]> {
        return await this.traced('resolveRelations', async span => {
            const res: T[] = await super.resolveRelations(entities, relations, related, transaction);
            span.recordAttribute(returnedRows, res.length);
            return res;
        });
    }

    override async findOne(options: DriverFindOptions<T>): Promise<T | undefined> {
        return await this.traced('findOne', async span => {
            const res: T | undefined = await super.findOne(options);
            span.recordAttribute(returnedRows, res == undefined ? 0 : 1);
            return res;
        });
    }

    override async count(options: DriverFindOptions<T>): Promise<number> {
        return await this.traced('count', async () => await super.count(options));
    }

    override async aggregate(options: DriverAggregateOptions<T>): Promise<AggregateRow[]> {
        return await this.traced('aggregate', async span => {
            const res: AggregateRow[] = await super.aggregate(options);
            span.recordAttribute(returnedRows, res.length);
            return res;
        });
    }

    override async findAndCount(options: DriverFindAndCountOptions<T>): Promise<PaginationResult<T>> {
        return await this.traced('findAndCount', async span => {
            const res: PaginationResult<T> = await super.findAndCount(options);
            span.recordAttribute(returnedRows, res.items.length);
            return res;
        });
    }

    override async remove(ids: string[], reach: RemovalReach<T> | undefined, transaction: Transaction | undefined): Promise<string[]> {
        return await this.traced('remove', async span => {
            const removed: string[] = await super.remove(ids, reach, transaction);
            span.recordAttribute(returnedRows, removed.length);
            return removed;
        });
    }

    override async removeMatching(
        where: Where<T> | undefined,
        related: RelatedNarrowing | undefined,
        transaction: Transaction | undefined
    ): Promise<string[]> {
        return await this.traced('removeMatching', async span => {
            const removed: string[] = await super.removeMatching(where, related, transaction);
            span.recordAttribute(returnedRows, removed.length);
            return removed;
        });
    }

    override async findIds(options: DriverFindOptions<T>): Promise<string[]> {
        return await this.traced('findIds', async span => {
            const res: string[] = await super.findIds(options);
            span.recordAttribute(returnedRows, res.length);
            return res;
        });
    }

    override async updateAll<R extends boolean = false>(options: DriverUpdateAllOptions<T, R>): Promise<R extends true ? T[] : number> {
        return await this.traced('updateAll', async () => await super.updateAll(options));
    }

    override async upsert(
        identity: string[],
        rows: UpsertRow<T>[],
        transaction: Transaction | undefined,
        reachable: Where<T> | undefined,
        related?: RelatedNarrowing
    ): Promise<T[]> {
        return await this.traced('upsert', async () => await super.upsert(identity, rows, transaction, reachable, related));
    }

    /**
     * Reads rows one at a time, as a span that lasts as long as the reading does.
     *
     * Not `traced`, because a stream hands back something to iterate rather than a result: the work
     * has barely started when this returns, and a span ended here would measure the setting up. It
     * ends when the caller stops reading, however they stop - including by walking away from the
     * loop, which is what the `finally` of a generator is for.
     * @param options - What to read.
     * @yields Each row the store answers with.
     */
    override async* stream(options: DriverStreamOptions<T>): AsyncIterable<T> {
        const span: TraceSpanInterface = TracingUtilities.startSpan(this.spanName('stream'), {
            kind: TraceSpanKind.CLIENT,
            attributes: this.attributesOf('stream'),
            tracer: this.resolveTracer()
        });
        let rows: number = 0;
        try {
            for await (const row of super.stream(options)) {
                rows++;
                yield row;
            }
        }
        finally {
            span.recordAttribute(returnedRows, rows);
            span.end();
        }
    }

    /**
     * Runs one store operation as a span.
     * @param operation - What the driver was asked to do.
     * @param fn - The operation.
     * @returns Whatever the operation returned.
     */
    private async traced<R>(operation: string, fn: (span: TraceSpanInterface) => Promise<R>): Promise<R> {
        return await TracingUtilities.trace(
            this.spanName(operation),
            { kind: TraceSpanKind.CLIENT, attributes: this.attributesOf(operation), tracer: this.resolveTracer() },
            fn
        );
    }

    /**
     * Resolves the tracer, once.
     * @returns The tracer.
     */
    private resolveTracer(): TracerInterface {
        // on the first span rather than when the driver is built: a repository is built
        // while its data source initializes, before every provider is there to resolve
        this.tracer ??= inject(ZIBRI_DI_TOKENS.TRACER);
        return this.tracer;
    }

    /**
     * What a span of one store operation is called.
     *
     * The operation and the entity, both of which are written in the source - so the set of names
     * is as large as the code and no larger, whatever arrives at runtime.
     * @param operation - What the driver was asked to do.
     * @returns The name.
     */
    private spanName(operation: string): string {
        return `${operation} ${this.entityClass.name}`;
    }

    /**
     * What is known about a store operation before it runs.
     * @param operation - What the driver was asked to do.
     * @returns The attributes.
     */
    private attributesOf(operation: string): StoreOperationAttributes {
        return { 'db.operation.name': operation, 'db.collection.name': this.entityClass.name };
    }
}