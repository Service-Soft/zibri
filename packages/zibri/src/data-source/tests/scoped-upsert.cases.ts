import { afterEach, describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { scopeFor } from '../../entity/models/entity-scope.model';
import { ForbiddenError } from '../../error-handling/errors/forbidden.error';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { Repository } from '../repository/repository';
import { Transaction } from '../transaction/transaction.model';
import { UniqueConstraintViolationError } from '../unique-constraint-violation.error';

/**
 * The cases every data source answers the same way about an upsert on an entity with a scope. A file
 * per data source runs them against a repository of its own.
 */

/**
 * How many visits a pass allows, which the scope holds it to.
 */
const VISIT_LIMIT: number = 3;

/**
 * The account the scope restricts to, set by each case. Undefined while a case seeds rows, which
 * the scope then does not restrict.
 *
 * Read from here rather than from a request, because what is under test is the repository and not
 * how a request names its user - the scope is a function either way.
 */
let actingAs: string | undefined;

/**
 * A pass to an event: one per email address across the whole table, belonging to one account.
 *
 * The address is unique on its own rather than per account, which is what makes the case: the
 * identity an upsert names can be held by a row belonging to somebody else.
 */
@Entity({
    tenant: 'shared',
    allowOrphan: true,
    allowDuplicate: true,
    scope: {
        restrictedTo: scopeFor<Pass>(() => actingAs == undefined
            ? undefined
            : { ownerId: actingAs, visits: { lesserThanEquals: VISIT_LIMIT } })
    }
})
export class Pass extends BaseEntity {
    /**
     * Who the pass is for, and what an upsert identifies it by.
     */
    @Property.string({ unique: true })
    email!: string;

    /**
     * The account the pass belongs to.
     */
    @Property.string({ format: 'uuid' })
    ownerId!: string;

    /**
     * Counted up by the conflict path, and held under the limit by the scope.
     */
    @Property.number({ format: 'integer' })
    visits!: number;
}

/**
 * Runs every case against the passes of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param passesOf - Reads the repository, once the data source is started.
 */
export function describeScopedUpsert(dataSourceName: string, passesOf: () => Repository<Pass>): void {

    /**
     * Records a visit, issuing the pass when there is none yet and counting it up when there is.
     * @param email - Who the pass is for.
     * @param ownerId - The account a new pass belongs to.
     * @returns The pass as it stands after the call.
     */
    async function visit(email: string, ownerId: string): Promise<Pass> {
        return await passesOf().upsert(
            { email },
            { email, ownerId, visits: 1 },
            { visits: { increment: 1 } }
        );
    }

    /**
     * Records a visit on each of several passes in one call.
     * @param emails - Who each pass is for.
     * @param ownerId - The account a new pass belongs to.
     * @returns The passes as they stand after the call, in the order of the emails.
     */
    async function visitAll(emails: string[], ownerId: string): Promise<Pass[]> {
        return await passesOf().upsertAll(
            ['email'],
            emails.map(email => ({ create: { email, ownerId, visits: 1 }, onConflict: { visits: { increment: 1 } } }))
        );
    }

    /**
     * Stores a pass without acting as anybody.
     * @param ownerId - The account it belongs to.
     * @param visits - How many visits it already has.
     * @returns The pass.
     */
    async function seed(ownerId: string, visits: number): Promise<Pass> {
        actingAs = undefined;
        return await passesOf().create({ email: `${UUIDUtilities.generate()}@example.com`, ownerId, visits });
    }

    describe(`an upsert on an entity with a scope, on ${dataSourceName}`, () => {
        const alice: string = UUIDUtilities.generate();
        const bob: string = UUIDUtilities.generate();

        afterEach(() => {
            actingAs = undefined;
        });

        it('lands on a row the caller may see', async () => {
            const email: string = `${UUIDUtilities.generate()}@example.com`;
            actingAs = alice;
            await visit(email, alice);

            const again: Pass = await visit(email, alice);

            // the control: without it a store refusing every conflict would pass the cases below
            expect(again.visits).toBe(2);
        });

        it('does not land on a row somebody else holds, and leaves it as it was', async () => {
            const othersPass: Pass = await seed(bob, 1);

            actingAs = alice;
            const res: Promise<Pass> = visit(othersPass.email, alice);

            // the identity names bob's row, and nothing about it is alice's. Applying the change
            // anyway would be a write to a row she cannot even read
            await expect(res).rejects.toThrow(UniqueConstraintViolationError);
            actingAs = undefined;
            const stored: Pass = await passesOf().findById(othersPass.id);
            expect(stored.visits).toBe(1);
            expect(stored.ownerId).toBe(bob);
            expect(await passesOf().count({ where: { email: othersPass.email } })).toBe(1);
        });

        it('answers a row somebody else holds the way inserting the identity would', async () => {
            const othersPass: Pass = await seed(bob, 1);

            actingAs = alice;

            // to alice that row does not exist, so the upsert is an insert - and an insert of an
            // address somebody already holds is refused by the unique declaration. Any other answer
            // would tell her something about the row that inserting it does not.
            //
            // One after the other: started together, the second can be refused while the first is
            // still being awaited, before anything is listening for it
            await expect(passesOf().create({ email: othersPass.email, ownerId: alice, visits: 1 }))
                .rejects.toThrow(UniqueConstraintViolationError);
            await expect(visit(othersPass.email, alice)).rejects.toThrow(UniqueConstraintViolationError);
        });

        it('refuses to move the row out of the caller\'s reach', async () => {
            const ownPass: Pass = await seed(alice, 1);

            actingAs = alice;
            const res: Promise<Pass> = passesOf().upsert(
                { email: ownPass.email },
                { email: ownPass.email, ownerId: alice, visits: 1 },
                { ownerId: { set: bob } }
            );

            // the same refusal an update moving the row gets
            await expect(res).rejects.toThrow(ForbiddenError);
            actingAs = undefined;
            expect((await passesOf().findById(ownPass.id)).ownerId).toBe(alice);
        });

        it('refuses a value that moves the row before writing it, even inside the caller\'s transaction', async () => {
            const ownPass: Pass = await seed(alice, 1);

            actingAs = alice;
            const transaction: Transaction = await passesOf().dataSource.startTransaction();
            await expect(passesOf().upsert(
                { email: ownPass.email },
                { email: ownPass.email, ownerId: alice, visits: 1 },
                { ownerId: { set: bob } },
                { transaction }
            )).rejects.toThrow(ForbiddenError);
            // a caller that carries on past the error. A value is known before the write, so there
            // is nothing in the transaction for this to commit
            await transaction.commit();

            actingAs = undefined;
            expect((await passesOf().findById(ownPass.id)).ownerId).toBe(alice);
        });

        it('refuses an increment that carries the row past what the caller may see, and rolls it back', async () => {
            const ownPass: Pass = await seed(alice, VISIT_LIMIT);

            actingAs = alice;
            const res: Promise<Pass> = visit(ownPass.email, alice);

            // the row is within reach until the increment lands, and only what is stored decides
            // whether it still is afterwards
            await expect(res).rejects.toThrow(ForbiddenError);
            actingAs = undefined;
            expect((await passesOf().findById(ownPass.id)).visits).toBe(VISIT_LIMIT);
        });

        it('counts up to what the scope allows', async () => {
            const ownPass: Pass = await seed(alice, VISIT_LIMIT - 1);

            actingAs = alice;
            const counted: Pass = await visit(ownPass.email, alice);

            // the control for the case above: an increment on what the scope reads is judged, not
            // refused
            expect(counted.visits).toBe(VISIT_LIMIT);
        });

        it('lands on any row for a caller the scope does not restrict', async () => {
            const othersPass: Pass = await seed(bob, 1);

            actingAs = undefined;
            const counted: Pass = await visit(othersPass.email, alice);

            expect(counted.id).toBe(othersPass.id);
            expect(counted.visits).toBe(2);
        });

        it('lands a batch on the rows the caller may see, and inserts the rest', async () => {
            const ownPass: Pass = await seed(alice, 1);
            const newEmail: string = `${UUIDUtilities.generate()}@example.com`;

            actingAs = alice;
            const [counted, issued] = await visitAll([ownPass.email, newEmail], alice);

            // the control for the two cases below
            expect(counted?.id).toBe(ownPass.id);
            expect(counted?.visits).toBe(2);
            expect(issued?.visits).toBe(1);
        });

        it('refuses a whole batch when one row lands on a row somebody else holds, and writes none of it', async () => {
            const ownPass: Pass = await seed(alice, 1);
            const othersPass: Pass = await seed(bob, 1);

            actingAs = alice;
            // a value rather than an amount, which is judged before the write and so takes no
            // transaction of its own - what holds this batch together is only that it is a batch
            const res: Promise<Pass[]> = passesOf().upsertAll(
                ['email'],
                [ownPass.email, othersPass.email].map(email => ({
                    create: { email, ownerId: alice, visits: 1 },
                    onConflict: { visits: { set: 2 } }
                }))
            );

            // the row the store refuses can come after one it has already written, which must not
            // stay written when the call as a whole was refused
            await expect(res).rejects.toThrow(UniqueConstraintViolationError);
            actingAs = undefined;
            expect((await passesOf().findById(ownPass.id)).visits).toBe(1);
            expect((await passesOf().findById(othersPass.id)).visits).toBe(1);
        });

        it('refuses a whole batch when one increment carries its row out of reach, and writes none of it', async () => {
            const ownPass: Pass = await seed(alice, 1);
            const fullPass: Pass = await seed(alice, VISIT_LIMIT);

            actingAs = alice;
            const res: Promise<Pass[]> = visitAll([ownPass.email, fullPass.email], alice);

            await expect(res).rejects.toThrow(ForbiddenError);
            actingAs = undefined;
            expect((await passesOf().findById(ownPass.id)).visits).toBe(1);
            expect((await passesOf().findById(fullPass.id)).visits).toBe(VISIT_LIMIT);
        });
    });
}