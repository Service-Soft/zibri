/* eslint-disable sonar/no-duplicate-string */
/* eslint-disable jsdoc/require-jsdoc */
import { describe, expect, it } from '@jest/globals';

import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { type OneOf } from '../../entity/models/one-of.model';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { Where } from '../models/where/where-filter.model';
import { Repository } from '../repository/repository';

/**
 * The cases every data source answers the same way about an entity that stores a value of several
 * named shapes. A file per data source runs them against a repository of its own.
 */

const signedUpAt: Date = new Date('2026-03-01T10:00:00.000Z');

const expiresAt: Date = new Date('2026-04-01T10:00:00.000Z');

export class Signup {
    @Property.string()
    email!: string;

    @Property.date()
    signedUpAt!: Date;

    @Property.string({ encryption: true })
    phone!: string;

    @Property.string({ exclude: true, required: false })
    referrer?: string;

    @Property.string({ default: 'web', required: false })
    source?: string;
}

export class Invite {
    @Property.string()
    code!: string;

    @Property.date()
    expiresAt!: Date;
}

export class LeadDetails {
    @Property.oneOf({ shapes: { Email: { type: 'string' }, Phone: { type: 'string' } } })
    preferred!: OneOf<{ Email: string, Phone: string }>;
}

@Entity({ allowOrphan: true, allowDuplicate: true })
export class Lead extends BaseEntity {
    /**
     * The rows one test wrote, so that what a filter finds is not mixed up with another test's rows.
     */
    @Property.string()
    batch!: string;

    @Property.string()
    name!: string;

    @Property.oneOf({ shapes: { Signup: { type: 'object', cls: () => Signup }, Invite: { type: 'object', cls: () => Invite } } })
    contact!: OneOf<{ Signup: Signup, Invite: Invite }>;

    @Property.oneOf({ shapes: { Due: { type: 'date' }, Note: { type: 'string' } }, required: false })
    followUp?: OneOf<{ Due: Date, Note: string }> | null;

    @Property.array({
        items: { type: 'oneOf', shapes: { Signup: { type: 'object', cls: () => Signup }, Invite: { type: 'object', cls: () => Invite } } },
        required: false
    })
    history?: OneOf<{ Signup: Signup, Invite: Invite }>[];

    @Property.object({ cls: () => LeadDetails, required: false })
    details?: LeadDetails;
}

/**
 * The data to create a lead from.
 */
type LeadData = Omit<Lead, keyof BaseEntity>;

/**
 * A signup, as a lead's contact.
 * @param email - The email it signed up with.
 * @returns The contact.
 */
function signup(email: string): OneOf<{ Signup: Signup, Invite: Invite }> {
    return { shape: 'Signup', value: { email, signedUpAt, phone: '+49123456', referrer: 'newsletter' } };
}

/**
 * An invite, as a lead's contact.
 * @param code - The code of the invite.
 * @returns The contact.
 */
function invite(code: string): OneOf<{ Signup: Signup, Invite: Invite }> {
    return { shape: 'Invite', value: { code, expiresAt } };
}

/**
 * The names of the given leads, sorted, so that a filter's answer can be compared without an order.
 * @param leads - The leads.
 * @returns Their names.
 */
function namesOf(leads: Lead[]): string[] {
    return leads.map(l => l.name).sort();
}

/**
 * Runs every case against the leads of one data source.
 * @param dataSourceName - The data source, for the name of the cases.
 * @param leadsOf - Reads the repository, once the data source is started.
 */
export function describeStoredOneOf(dataSourceName: string, leadsOf: () => Repository<Lead>): void {
    /**
     * Creates the given leads under a batch of their own.
     * @param data - The leads, without their batch.
     * @returns The batch they were created under.
     */
    async function createBatch(...data: Omit<LeadData, 'batch'>[]): Promise<string> {
        const batch: string = UUIDUtilities.generate();
        for (const lead of data) {
            await leadsOf().create({ ...lead, batch });
        }
        return batch;
    }

    describe(`storing a value of several named shapes, on ${dataSourceName}`, () => {
        it('reads a value back as the shape it names, with the dates of that shape', async () => {
            const created: Lead = await leadsOf().create({
                batch: UUIDUtilities.generate(),
                name: 'invited',
                contact: invite('A1'),
                followUp: { shape: 'Due', value: signedUpAt },
                history: [invite('A0')]
            });

            const read: Lead = await leadsOf().findById(created.id);

            expect(read.contact).toEqual({ shape: 'Invite', value: { code: 'A1', expiresAt } });
            expect(read.followUp).toEqual({ shape: 'Due', value: signedUpAt });
            expect(read.history).toEqual([{ shape: 'Invite', value: { code: 'A0', expiresAt } }]);
        });

        it('reads a text that looks like a date back as text when that is the shape it names', async () => {
            const created: Lead = await leadsOf().create({
                batch: UUIDUtilities.generate(),
                name: 'noted',
                contact: invite('A1'),
                followUp: { shape: 'Note', value: '2026-03-01T10:00:00.000Z' }
            });

            const read: Lead = await leadsOf().findById(created.id);

            expect(read.followUp).toEqual({ shape: 'Note', value: '2026-03-01T10:00:00.000Z' });
        });

        it('encrypts a property of the named shape at rest, and decrypts it on read', async () => {
            const created: Lead = await leadsOf().create({
                batch: UUIDUtilities.generate(),
                name: 'signed up',
                contact: signup('a@example.com'),
                history: [signup('b@example.com'), invite('A0')]
            });

            const stored: Lead = await leadsOf().findById(created.id, { autoDecrypt: false });
            const read: Lead = await leadsOf().findById(created.id);

            expect(stored.contact).toEqual({
                shape: 'Signup',
                value: expect.objectContaining({ phone: expect.not.stringContaining('+49123456') })
            });
            expect(stored.history?.[0]).toEqual({
                shape: 'Signup',
                value: expect.objectContaining({ phone: expect.not.stringContaining('+49123456') })
            });
            expect(read.contact).toEqual({ shape: 'Signup', value: expect.objectContaining({ phone: '+49123456' }) });
            expect(read.history?.[0]).toEqual({ shape: 'Signup', value: expect.objectContaining({ phone: '+49123456' }) });
        });

        it('encrypts a property of the named shape bound to each row, when many rows are updated at once', async () => {
            const batch: string = await createBatch(
                { name: 'first', contact: invite('A1') },
                { name: 'second', contact: invite('A2') }
            );

            await leadsOf().updateAll({ batch }, { contact: signup('same@example.com') });

            const read: Lead[] = await leadsOf().findAll({ where: { batch } });
            expect(read.map(l => l.contact)).toEqual([
                { shape: 'Signup', value: expect.objectContaining({ phone: '+49123456' }) },
                { shape: 'Signup', value: expect.objectContaining({ phone: '+49123456' }) }
            ]);
        });

        it('fills in a default of the named shape only', async () => {
            const created: Lead = await leadsOf().create({
                batch: UUIDUtilities.generate(),
                name: 'signed up',
                contact: signup('a@example.com'),
                history: [invite('A0')]
            });

            expect(created.contact).toEqual({ shape: 'Signup', value: expect.objectContaining({ source: 'web' }) });
            expect(created.history).toEqual([{ shape: 'Invite', value: { code: 'A0', expiresAt } }]);
        });

        it('hides an excluded property of the named shape, and keeps it readable', async () => {
            const created: Lead = await leadsOf().create({
                batch: UUIDUtilities.generate(),
                name: 'signed up',
                contact: signup('a@example.com')
            });

            const read: Lead = await leadsOf().findById(created.id);

            expect(JSON.stringify(read)).not.toContain('newsletter');
            expect(read.contact.shape === 'Signup' ? read.contact.value.referrer : undefined).toBe('newsletter');
        });
    });

    describe(`filtering by a value of several named shapes, on ${dataSourceName}`, () => {
        it('finds the rows of one shape by what that shape holds', async () => {
            const batch: string = await createBatch(
                { name: 'a', contact: signup('a@example.com') },
                { name: 'b', contact: signup('b@example.com') },
                { name: 'c', contact: invite('a@example.com') }
            );

            const found: Lead[] = await leadsOf().findAll({
                where: { batch, contact: { whenSignup: { where: { email: 'a@example.com' } }, whenInvite: false } }
            });

            expect(namesOf(found)).toEqual(['a']);
        });

        it('finds every row of a shape that is filtered by nothing', async () => {
            const batch: string = await createBatch(
                { name: 'a', contact: signup('a@example.com') },
                { name: 'b', contact: signup('b@example.com') },
                { name: 'c', contact: invite('C') }
            );

            const found: Lead[] = await leadsOf().findAll({ where: { batch, contact: { whenSignup: {}, whenInvite: false } } });

            expect(namesOf(found)).toEqual(['a', 'b']);
        });

        it('applies to each row the filter of the shape it names', async () => {
            const batch: string = await createBatch(
                { name: 'a', contact: signup('a@example.com') },
                { name: 'b', contact: signup('b@example.com') },
                { name: 'c', contact: invite('C') },
                { name: 'd', contact: invite('D') }
            );

            const found: Lead[] = await leadsOf().findAll({
                where: { batch, contact: { whenSignup: { where: { email: 'b@example.com' } }, whenInvite: { where: { code: 'C' } } } }
            });

            expect(namesOf(found)).toEqual(['b', 'c']);
        });

        it('compares a date of the shape as a date', async () => {
            const batch: string = await createBatch(
                { name: 'due', contact: invite('A'), followUp: { shape: 'Due', value: signedUpAt } },
                { name: 'later', contact: invite('B'), followUp: { shape: 'Due', value: expiresAt } },
                { name: 'noted', contact: invite('C'), followUp: { shape: 'Note', value: 'call back' } },
                { name: 'none', contact: invite('D') }
            );

            const found: Lead[] = await leadsOf().findAll({
                where: { batch, followUp: { whenDue: { before: new Date('2026-03-15T00:00:00.000Z') }, whenNote: { like: 'call%' } } }
            });
            // eslint-disable-next-line unicorn/no-null
            const withoutFollowUp: Lead[] = await leadsOf().findAll({ where: { batch, followUp: null } });

            expect(namesOf(found)).toEqual(['due', 'noted']);
            expect(namesOf(withoutFollowUp)).toEqual(['none']);
        });

        it('finds the rows whose array holds an item of the shape that matches', async () => {
            const batch: string = await createBatch(
                { name: 'a', contact: invite('A'), history: [invite('X'), signup('a@example.com')] },
                { name: 'b', contact: invite('B'), history: [invite('a@example.com')] },
                { name: 'c', contact: invite('C'), history: [] }
            );

            const found: Lead[] = await leadsOf().findAll({
                where: { batch, history: { where: { whenSignup: { where: { email: 'a@example.com' } }, whenInvite: false } } }
            });

            expect(namesOf(found)).toEqual(['a']);
        });

        it('finds the rows by a value of several shapes inside an object', async () => {
            const batch: string = await createBatch(
                { name: 'a', contact: invite('A'), details: { preferred: { shape: 'Email', value: 'a@example.com' } } },
                { name: 'b', contact: invite('B'), details: { preferred: { shape: 'Phone', value: 'a@example.com' } } },
                { name: 'c', contact: invite('C') }
            );

            const found: Lead[] = await leadsOf().findAll({
                where: { batch, details: { where: { preferred: { whenEmail: { like: '%@example.com' }, whenPhone: false } } } }
            });

            expect(namesOf(found)).toEqual(['a']);
        });

        it('finds the rows any of several filters matches', async () => {
            const batch: string = await createBatch(
                { name: 'a', contact: signup('a@example.com') },
                { name: 'b', contact: signup('b@example.com') },
                { name: 'c', contact: invite('C') }
            );

            const found: Lead[] = await leadsOf().findAll({
                where: {
                    batch,
                    contact: [
                        { whenSignup: { where: { email: 'a@example.com' } }, whenInvite: false },
                        { whenSignup: false, whenInvite: { where: { code: 'C' } } }
                    ]
                }
            });

            expect(namesOf(found)).toEqual(['a', 'c']);
        });

        it('filters an object that merely has a shape and a value as the object it is', () => {
            // a value of several shapes names them; an object whose shape is any text does not
            class Measurement {
                @Property.string()
                shape!: string;

                @Property.number()
                value!: number;
            }
            const filter: Where<{ measurement: Measurement }> = { measurement: { where: { shape: 'circle', value: { greaterThan: 2 } } } };

            // @ts-expect-error - it has no shapes to filter by
            const byShape: Where<{ measurement: Measurement }> = { measurement: { whenCircle: false } };

            expect([filter, byShape]).toHaveLength(2);
        });

        it('refuses a filter that leaves a shape out, or names one there is not', async () => {
            await expect(leadsOf().findAll({
                // @ts-expect-error - every shape is named, so that leaving one out is a decision rather than an oversight
                where: { contact: { whenSignup: {} } }
            })).rejects.toThrow(/whenInvite/);
            await expect(leadsOf().findAll({
                // @ts-expect-error - there is no shape called Fax
                where: { contact: { whenSignup: {}, whenInvite: false, whenFax: false } }
            })).rejects.toThrow(/whenFax/);
        });
    });
}