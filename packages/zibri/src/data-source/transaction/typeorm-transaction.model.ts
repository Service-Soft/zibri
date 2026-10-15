import { QueryRunner } from 'typeorm';

import { Transaction } from './transaction.model';

/**
 * A type orm transaction.
 */
export class TypeOrmTransaction implements Transaction {

    private finished: boolean = false;

    private readonly committedWork: (() => Promise<void>)[] = [];

    constructor(readonly queryRunner: QueryRunner) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    get isFinished(): boolean {
        return this.finished;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async commit(): Promise<void> {
        try {
            await this.queryRunner.commitTransaction();
        }
        finally {
            await this.finish();
        }
        for (const work of this.committedWork.splice(0)) {
            await work();
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    afterCommit(work: () => Promise<void>): void {
        this.committedWork.push(work);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async rollback(): Promise<void> {
        this.committedWork.length = 0;
        try {
            await this.queryRunner.rollbackTransaction();
        }
        finally {
            await this.finish();
        }
    }

    /**
     * Ends the transaction and hands the connection back, whatever the outcome was.
     *
     * A commit that throws ends the transaction too - the database takes it back itself, so nothing
     * is left pending and nothing more can be written through this runner. Handing the connection
     * back only on the paths that worked loses one pooled connection for good every time a commit
     * fails, until the pool holds none.
     */
    private async finish(): Promise<void> {
        this.finished = true;
        await this.queryRunner.release();
    }
}