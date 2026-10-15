import { ClusterMark, clusterInstanceId, defaultClusterProviders, StartTestServerOptions } from 'zibri-testing';

import { ValKeyDataSource, ValKeyOptions } from '../../../data-source/data-sources/val-key/val-key-data-source.model';
import { DataSource } from '../../../data-source/decorators/data-source.decorator';
import { Repository } from '../../../data-source/repository/repository';
import { Transaction } from '../../../data-source/transaction/transaction.model';
import { InjectRepository } from '../../../di/decorators/inject-repository.decorator';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Post } from '../../../routing/decorators/post.decorator';
import { Newable } from '../../../types/newable.type';
import { createTestDataSource, defaultTestServerEntities } from '../../test-server/create-test-data-source.function';
import { defaultTestValKeyEntities } from '../../test-server/create-test-val-key-data-source.function';

/**
 * What every instance of the valkey transaction cluster boots with.
 *
 * A valkey transaction buffers its writes and applies them in one batch, so nothing it does is
 * visible until it commits. On its own that is atomic but not isolated: two replicas can each buffer
 * a write of the same row and the later commit silently wins. A grant per row key, taken as the
 * write is buffered and held until the transaction ends, is what closes that - the same shape as a
 * row lock.
 *
 * Two data sources: postgres for the marks, valkey for the row under test. Like every instance
 * options module this is imported by the parent as well, so nothing at the top level may assume it
 * is running inside an instance.
 */

/**
 * The row every replica contends for. One fixed key, because the whole question is what happens when
 * they all want the same one.
 */
export const counterId: string = 'contended-counter';

/**
 * How long a replica stays inside the transaction between its write and its commit.
 *
 * Long enough that three replicas starting together overlap for certain. If the grant did not hold,
 * every one of them would be inside this window at the same time.
 */
const workInMs: number = 400;

/**
 * How long a replica waits before it increments.
 *
 * Only used by the increment endpoint, and only so that the replicas reach it together rather than
 * one after the other. Without it the test could pass by luck instead of by the upsert.
 */
const readWriteGapInMs: number = 200;

/**
 * Sleeps for the given time.
 * @param ms - How long to sleep.
 */
async function sleep(ms: number): Promise<void> {
    await new Promise<void>(resolve => {
        setTimeout(resolve, ms);
    });
}

/**
 * The row two replicas fight over.
 *
 * `name` is declared unique so that an upsert can identify the row by something other than its id.
 * That is the whole difficulty an upsert has to solve: a replica that is about to insert the row
 * cannot name it by id, because the id does not exist until it has inserted it.
 */
@Entity({ tenant: 'shared', allowOrphan: true, uniques: [['name']] })
export class ValKeyCounter extends BaseEntity {
    /**
     * What every replica identifies the row by.
     */
    @Property.string()
    name!: string;

    /**
     * What the contending replicas write.
     */
    @Property.number()
    value!: number;
}

@DataSource()
class ClusterTransactionValKeyDataSource extends ValKeyDataSource {
    override options: ValKeyOptions = {
        host: 'localhost',
        useTLS: false,
        keyPrefix: 'cluster-tx'
    };
    entities: Newable<BaseEntity>[] = [...defaultTestValKeyEntities, ValKeyCounter];
}

/**
 * Writes the contended row from inside a transaction, on request.
 */
@Controller('/cluster-valkey-transaction')
class ClusterTransactionController {
    constructor(
        @InjectRepository(ClusterMark)
        private readonly markRepository: Repository<ClusterMark>,
        @InjectRepository(ValKeyCounter)
        private readonly counterRepository: Repository<ValKeyCounter>
    ) {}

    /**
     * Puts the contended row back to zero, so each case starts from a known value.
     *
     * Named by `name` rather than by id, because every replica has to be able to name the same row
     * without being told its id - and an id is a uuid the framework generates, so no replica could
     * agree on one in advance.
     *
     * Idempotent: a second reset writes zero over the row that is already there.
     */
    @Post('/reset')
    async reset(): Promise<void> {
        await this.counterRepository.upsert({ name: counterId }, { name: counterId, value: 0 }, { value: { set: 0 } });
    }

    /**
     * Writes the row, stays inside the transaction for a while, then commits.
     *
     * The marks bracket the window in which this replica holds the grant: the enter is written after
     * the write that takes it, the exit before the commit that hands it back. Ordered by time they
     * have to alternate enter, exit, enter, exit - two enters in a row means two replicas had the
     * same row buffered at once, which is the write one of them was about to lose.
     */
    @Post('/write')
    async write(): Promise<void> {
        const instanceId: string = clusterInstanceId();
        // resolved before the transaction on purpose: what this case measures is the window the write
        // holds the row for, so the lookup that turns the name into an id has to stay outside it
        const counter: ValKeyCounter = await this.counterRepository.findOne({ where: { name: counterId } });
        const transaction: Transaction = await this.counterRepository.dataSource.startTransaction();

        try {
            // the grant is taken here, by the write itself - not by starting the transaction, which
            // does not yet know which rows it will touch
            await this.counterRepository.updateById(counter.id, { value: 1 }, { transaction });

            await this.markRepository.create({ instanceId, kind: 'tx-enter', tag: counterId, at: new Date() });
            await sleep(workInMs);
            await this.markRepository.create({ instanceId, kind: 'tx-exit', tag: counterId, at: new Date() });

            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    /**
     * Records what the contended row ended up holding.
     *
     * Written as a mark because the row lives in valkey and the parent only has a sql connection.
     * Reading a committed row with nothing else running is not the thing under test, so going
     * through the repository here costs the test nothing.
     */
    @Post('/record-value')
    async recordValue(): Promise<void> {
        const counter: ValKeyCounter = await this.counterRepository.findOne({ where: { name: counterId } });
        await this.markRepository.create({
            instanceId: clusterInstanceId(),
            kind: 'counter-value',
            tag: String(counter.value),
            at: new Date()
        });
    }

    /**
     * Adds one to the row, inside one transaction.
     *
     * Written as an upsert rather than as a read, an add and a write, which is the point. The naive
     * form is not made safe by the transaction around it: its read happens before the transaction
     * holds anything, so every replica reads the same value and every replica writes the same
     * result. An upsert holds from before the read instead, so the value it adds to is the value
     * that was there.
     *
     * The gap is still slept through, so the replicas overlap for certain rather than occasionally.
     * The naive version failed this reliably with it and intermittently without it.
     */
    @Post('/increment')
    async increment(): Promise<void> {
        const transaction: Transaction = await this.counterRepository.dataSource.startTransaction();

        try {
            await sleep(readWriteGapInMs);
            await this.counterRepository.upsert(
                { name: counterId },
                { name: counterId, value: 1 },
                { value: { increment: 1 } },
                { transaction }
            );
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
    }
}

const options: StartTestServerOptions = {
    controllers: [ClusterTransactionController],
    // this repository's own fixtures plus the mark table, the way every other suite here declares a
    // data source: importing the helper above registers JwtUser, and a registered entity no data
    // source declares is refused at boot
    dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, ClusterMark] }), ClusterTransactionValKeyDataSource],
    providers: defaultClusterProviders
};

export default options;