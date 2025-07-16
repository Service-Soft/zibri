import { QueryRunner } from 'typeorm';

import { Transaction } from './transaction.model';

/**
 * A type orm transaction.
 */
export class TypeOrmTransaction implements Transaction {
    constructor(readonly queryRunner: QueryRunner) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async commit(): Promise<void> {
        await this.queryRunner.commitTransaction();
        await this.release();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async rollback(): Promise<void> {
        await this.queryRunner.rollbackTransaction();
        await this.release();
    }

    private async release(): Promise<void> {
        await this.queryRunner.release();
    }
}