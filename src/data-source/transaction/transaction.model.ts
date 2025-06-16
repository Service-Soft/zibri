import { QueryRunner } from 'typeorm';

export type Transaction = {
    queryRunner: QueryRunner,
    commit: () => Promise<void>,
    rollback: () => Promise<void>
};