import { QueryRunner } from 'typeorm';

import { Transaction } from './transaction.model';

export class TypeOrmTransaction implements Transaction {
    constructor(readonly queryRunner: QueryRunner) {}

    async commit(): Promise<void> {
        await this.queryRunner.commitTransaction();
        await this.release();
    }

    async rollback(): Promise<void> {
        await this.queryRunner.rollbackTransaction();
        await this.release();
    }

    private async release(): Promise<void> {
        await this.queryRunner.release();
    }
}