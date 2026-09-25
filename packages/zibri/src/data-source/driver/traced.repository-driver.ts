import { DriverFindAndCountOptions, DriverFindOptions, DriverStreamOptions, DriverUpdateAllOptions, RepositoryDriverInterface } from './repository-driver.interface';
import { BaseEntity } from '../../entity/base-entity.model';
import { PaginationResult } from '../../open-api/pagination-result.model';
import { TraceSpanAttributeName } from '../../tracing/trace-span-attributes.model';
import { TraceSpanKind } from '../../tracing/trace-span-kind.enum';
import { TraceSpanInterface } from '../../tracing/trace-span.interface';
import { TracingUtilities } from '../../tracing/tracing.utilities';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';
import { AtomicUpdate } from '../models/atomic-update.model';
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
export class TracedRepositoryDriver<T extends BaseEntity> implements RepositoryDriverInterface<T> {
    constructor(
        private readonly inner: RepositoryDriverInterface<T>,
        private readonly entityClass: Newable<T>
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async save(data: DeepPartial<T>[], transaction: Transaction | undefined, reload: boolean): Promise<T[]> {
        return await this.traced('save', async span => {
            const res: T[] = await this.inner.save(data, transaction, reload);
            span.recordAttribute(returnedRows, res.length);
            return res;
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async find(options: DriverFindOptions<T>): Promise<T[]> {
        return await this.traced('find', async span => {
            const res: T[] = await this.inner.find(options);
            span.recordAttribute(returnedRows, res.length);
            return res;
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findOne(options: DriverFindOptions<T>): Promise<T | undefined> {
        return await this.traced('findOne', async span => {
            const res: T | undefined = await this.inner.findOne(options);
            span.recordAttribute(returnedRows, res == undefined ? 0 : 1);
            return res;
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async count(options: DriverFindOptions<T>): Promise<number> {
        return await this.traced('count', async () => await this.inner.count(options));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findAndCount(options: DriverFindAndCountOptions<T>): Promise<PaginationResult<T>> {
        return await this.traced('findAndCount', async span => {
            const res: PaginationResult<T> = await this.inner.findAndCount(options);
            span.recordAttribute(returnedRows, res.items.length);
            return res;
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async remove(entities: T[], transaction: Transaction | undefined): Promise<T[]> {
        return await this.traced('remove', async span => {
            span.recordAttribute(returnedRows, entities.length);
            return await this.inner.remove(entities, transaction);
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateAll<R extends boolean = false>(options: DriverUpdateAllOptions<T, R>): Promise<R extends true ? T[] : number> {
        return await this.traced('updateAll', async () => await this.inner.updateAll(options));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async upsert(
        identity: DeepPartial<T>,
        create: DeepPartial<T>,
        onConflict: AtomicUpdate<T>,
        transaction: Transaction | undefined
    ): Promise<T> {
        return await this.traced('upsert', async () => await this.inner.upsert(identity, create, onConflict, transaction));
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
    async* stream(options: DriverStreamOptions<T>): AsyncIterable<T> {
        const span: TraceSpanInterface = TracingUtilities.startSpan(this.spanName('stream'), {
            kind: TraceSpanKind.CLIENT,
            attributes: this.attributesOf('stream')
        });
        let rows: number = 0;
        try {
            for await (const row of this.inner.stream(options)) {
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
            { kind: TraceSpanKind.CLIENT, attributes: this.attributesOf(operation) },
            fn
        );
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