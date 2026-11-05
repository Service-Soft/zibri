import { describe, expect, it } from '@jest/globals';

import { QueryFailedError } from './query-failed.error';

describe('QueryFailedError', () => {
    it('names the property and the table a foreign key violation is about', () => {
        const error: QueryFailedError = new QueryFailedError({
            message: 'update or delete on table "user" violates foreign key constraint "fk_group_user"',
            detail: 'Key (id)=(42) is still referenced from table "user_groups_group".',
            query: 'DELETE FROM "user" WHERE "id" = $1',
            parameters: [42]
        });

        expect(error.message).toContain('cannot delete or update because user_groups_group.id still references this row (value = 42)');
        expect(error.message).toContain('DELETE FROM "user" WHERE "id" = 42');
    });

    it('describes a foreign key violation in time linear to a value made to slow it down', () => {
        // the detail holds the value as it was sent: one that breaks the line and repeats the start
        // of the key would be read from every repetition to the end of the line
        const value: string = `\n${'Key ('.repeat(40_000)}`;
        const start: number = performance.now();

        new QueryFailedError({
            message: 'insert or update on table "member" violates foreign key constraint "fk_member_name"',
            detail: `Key (name)=(${value}) is not present in table "name".`,
            query: 'INSERT INTO "member" ("name") VALUES ($1)',
            parameters: [value]
        });

        expect(performance.now() - start).toBeLessThan(100);
    });
});