import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { ValidateCustom } from './decorators/validate-custom.decorator';
import { ValidationService } from './validation.service';
import { TestTimeouts } from '../__testing__/constants';
import { type Relation } from '../__testing__/relation.type';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { propertyOf } from '../data-source/models/where/property-of.function';
import { whereFor } from '../data-source/models/where/where-for.function';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { Entity } from '../entity/decorators/entity.decorator';
import { Property } from '../entity/decorators/property.decorator';
import { OmitClass } from '../entity/omit-class.model';
import { PartialClass } from '../entity/partial-class.model';
import { ValidationError } from '../error-handling/errors/validation.error';
import { MimeType } from '../http/mime-type.enum';
import { $t, $ts } from '../localization/translate.function';
import { BodyMetadata, FormDataBodyMetadataInput, JsonBodyMetadataInput } from '../routing/decorators/body-metadata.model';
import { HeaderParamMetadata, PathParamMetadata, QueryParamMetadata } from '../routing/decorators/param.decorator';
import { ParamMetadataUtilities } from '../routing/param-metadata.utilities';
import { resolveBodyMetadata } from '../routing/resolve-body-metadata.function';
import { Newable } from '../types/newable.type';
import { BigNumber } from '../utilities/number.utilities';

class Nested {
    @Property.string()
    label!: string;
}

// Deliberately not @Entity()-decorated or registered on a data source: ValidationService only
// reads @Property metadata off the class, it never persists these, so no real entity/schema is needed.
class Parent extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.object({ cls: () => Nested, required: false })
    nested: Nested | undefined;

    @Property.hasOne({ target: () => Child, inverseSide: 'parent' })
    child!: Relation<Child>;
}

class Child extends BaseEntity {
    @Property.hasOne({ target: () => Parent, inverseSide: 'child' })
    parent!: Relation<Parent>;
}

class SimpleModel {
    @Property.string()
    name!: string;
}

class Booking {
    @Property.boolean()
    flexible!: boolean;

    @Property.date({ required: (booking: Booking) => !booking.flexible })
    endsAt?: Date;
}

@Entity({
    tenant: 'shared',
    allowOrphan: true,
    allowDuplicate: true,
    checks: [
        {
            // eslint-disable-next-line unicorn/no-null
            where: whereFor<CheckedChore>([{ status: { not: 'done' } }, { completedAt: { not: null } }]),
            code: 'completedAtRequired',
            message: $t`a done chore has a completion date`
        },
        whereFor<CheckedChore>({ estimate: { greaterThanEquals: 1 } }),
        {
            // eslint-disable-next-line unicorn/no-null
            where: whereFor<CheckedChore>([{ endsAt: null }, { endsAt: { after: propertyOf('startsAt') } }]),
            code: 'endsBeforeStart',
            message: $t`a chore ends after it starts`
        }
    ]
})
class CheckedChore extends BaseEntity {
    @Property.string()
    status!: string;

    @Property.date({ required: false })
    completedAt?: Date | null;

    @Property.number()
    estimate!: number;

    @Property.date({ required: false })
    startsAt?: Date | null;

    @Property.date({ required: false })
    endsAt?: Date | null;
}

class ChoreCreateData extends OmitClass(CheckedChore, ['id']) {}

class ChoreUpdateData extends PartialClass(ChoreCreateData) {}

class ChoreWithoutCompletion extends OmitClass(CheckedChore, ['id', 'completedAt']) {}

class ChoreList {
    @Property.object({ cls: () => ChoreCreateData })
    first!: ChoreCreateData;
}

@ValidateCustom((trip: Trip) => [
    ...trip.returnsAt > trip.leavesAt ? [] : [{ property: 'returnsAt' as const, code: 'returnBeforeDeparture', message: $ts`has to be after leavesAt` }],
    ...trip.travelers.length <= trip.seats ? [] : [{ code: 'tooManyTravelers', message: $ts`has more travelers than seats` }]
])
class Trip {
    @Property.date()
    leavesAt!: Date;

    @Property.date()
    returnsAt!: Date;

    @Property.number({ format: 'integer' })
    seats!: number;

    @Property.array({ items: { type: 'string' } })
    travelers!: string[];
}

class TripRequest {
    @Property.object({ cls: () => Trip })
    trip!: Trip;
}

class GroupTrip extends Trip {
    @Property.string()
    group!: string;
}

class TripChange extends PartialClass(Trip) {}

class Lodging {
    @Property.date()
    leavesAt!: Date;
}

class Stay {
    @Property.date({ before: (stay: Stay) => stay.endsAt })
    startsAt!: Date;

    @Property.date()
    endsAt!: Date;
}

class StayRequest {
    @Property.object({ cls: () => Stay })
    stay!: Stay;
}

class BookingRequest {
    @Property.object({ cls: () => Booking })
    booking!: Booking;

    @Property.array({ items: { type: 'object', cls: () => Booking }, required: false })
    alternatives?: Booking[];
}

class WithNested {
    @Property.string()
    name!: string;

    @Property.object({ cls: () => Nested, required: false })
    nested: Nested | undefined;
}

class Settings {
    @Property.string({ required: false })
    theme?: string;
}

class Payment {
    @Property.number({ format: 'bignumber', min: 0, max: 10 })
    amount!: BigNumber;
}

class Nickname {
    @Property.string({ minLength: 2, maxLength: 3 })
    nickname!: string;
}

class WithSettings {
    @Property.object({ cls: () => Settings })
    settings!: Settings;
}

// a json body names no type, a form data body has to
type BodyMetaOverrides = (JsonBodyMetadataInput & { modelClass?: Newable<unknown> }) | FormDataBodyMetadataInput;

function bodyMeta(declaration: BodyMetaOverrides = {}): BodyMetadata {
    return resolveBodyMetadata({ modelClass: SimpleModel, ...declaration }, 0);
}

describe('ValidationService', () => {
    let server: StartedTestServer;
    let validationService: ValidationService;

    beforeAll(async () => {
        // in memory: nothing here reads a table, and the suite runs without a container
        server = await startTestServer({ dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })] });
        validationService = inject(ValidationService);
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    describe('validatePathParam / validateQueryParam / validateHeaderParam', () => {
        it('resolves without throwing for valid path params', async () => {
            const meta: PathParamMetadata = ParamMetadataUtilities.createPathParam('id', { type: 'string' });
            await expect(validationService.validatePathParam('abc', meta)).resolves.toBeUndefined();
        });

        it('throws a ValidationError for an invalid path param', async () => {
            const meta: PathParamMetadata = ParamMetadataUtilities.createPathParam('id', { type: 'number' });
            await expect(validationService.validatePathParam('not-a-number', meta)).rejects.toThrow(ValidationError);
        });

        it('resolves without throwing for valid query params', async () => {
            const meta: QueryParamMetadata = ParamMetadataUtilities.createQueryParam('limit', { type: 'number' });
            await expect(validationService.validateQueryParam(10, meta)).resolves.toBeUndefined();
        });

        it('throws a ValidationError for an invalid query param', async () => {
            const meta: QueryParamMetadata = ParamMetadataUtilities.createQueryParam('limit', { type: 'number', required: true });
            await expect(validationService.validateQueryParam(undefined, meta)).rejects.toThrow(ValidationError);
        });

        it('resolves without throwing for a valid header param', async () => {
            const meta: HeaderParamMetadata = ParamMetadataUtilities.createHeaderParam('x-request-id', { type: 'string' });
            await expect(validationService.validateHeaderParam('abc-123', meta)).resolves.toBeUndefined();
        });

        it('throws a ValidationError for an invalid header param', async () => {
            const meta: HeaderParamMetadata = ParamMetadataUtilities.createHeaderParam('x-request-id', { type: 'string' });
            await expect(validationService.validateHeaderParam(42, meta)).rejects.toThrow(ValidationError);
        });
    });

    describe('validateBody', () => {
        it('resolves for a matching body', async () => {
            await expect(validationService.validateBody({ name: 'Alice' }, bodyMeta())).resolves.toBeUndefined();
        });

        it('rejects an undefined body when required', async () => {
            await expect(
                validationService.validateBody(undefined, bodyMeta({ required: true }))
            ).rejects.toThrow(ValidationError);
        });

        it('resolves for an undefined body when not required', async () => {
            await expect(
                validationService.validateBody(undefined, bodyMeta({ required: false }))
            ).resolves.toBeUndefined();
        });

        it('rejects unknown keys by default', async () => {
            await expect(
                validationService.validateBody({ name: 'Alice', extra: 'nope' }, bodyMeta())
            ).rejects.toThrow(ValidationError);
        });

        it('allows unknown keys when allowAdditionalProperties is true', async () => {
            await expect(
                validationService.validateBody({ name: 'Alice', extra: 'fine' }, bodyMeta({ allowAdditionalProperties: true }))
            ).resolves.toBeUndefined();
        });

        it('rejects a relation property present on the model with RelationsNotAllowedValidationProblem', async () => {
            await expect(
                validationService.validateBody(
                    { name: 'Alice', child: { id: 'x' } },
                    bodyMeta({ modelClass: Parent, allowAdditionalProperties: true })
                )
            ).rejects.toThrow(/relations are not allowed/);
        });

        it('validates a nested object property recursively', async () => {
            await expect(
                validationService.validateBody(
                    { name: 'Alice', nested: { label: 42 } },
                    bodyMeta({ modelClass: WithNested })
                )
            ).rejects.toThrow(ValidationError);
        });

        it('accepts a valid nested object property', async () => {
            await expect(
                validationService.validateBody(
                    { name: 'Alice', nested: { label: 'ok' } },
                    bodyMeta({ modelClass: WithNested })
                )
            ).resolves.toBeUndefined();
        });

        // an array is an object to typeof, and one has no keys: it passed for an object every property
        // of which is optional
        it('rejects a list where an object is declared, the body itself included', async () => {
            await expect(validationService.validateBody({ settings: [] }, bodyMeta({ modelClass: WithSettings }))).rejects.toThrow(
                expect.objectContaining({ problems: [expect.objectContaining({ key: 'settings', code: 'type' })] })
            );
            await expect(validationService.validateBody([], bodyMeta({ modelClass: Settings }))).rejects.toThrow(
                expect.objectContaining({ problems: [expect.objectContaining({ key: 'body', code: 'type' })] })
            );
        });

        // an exact decimal was compared with its bounds as a double, which rounds a value just past one onto it
        it('holds an exact decimal to its bounds exactly', async () => {
            await expect(validationService.validateBody({ amount: new BigNumber('10') }, bodyMeta({ modelClass: Payment }))).resolves.toBeUndefined();
            await expect(validationService.validateBody({ amount: new BigNumber('10.0000000000000000001') }, bodyMeta({ modelClass: Payment })))
                .rejects.toThrow(expect.objectContaining({ problems: [expect.objectContaining({ key: 'amount', code: 'max' })] }));
            await expect(validationService.validateBody({ amount: new BigNumber('-0.0000000000000000001') }, bodyMeta({ modelClass: Payment })))
                .rejects.toThrow(expect.objectContaining({ problems: [expect.objectContaining({ key: 'amount', code: 'min' })] }));
        });

        // a length was counted in utf-16 units, where the OpenAPI schema counts characters: an emoji is
        // one character and two units
        it('counts the length of a string in characters', async () => {
            await expect(validationService.validateBody({ nickname: '😀😀😀' }, bodyMeta({ modelClass: Nickname }))).resolves.toBeUndefined();
            await expect(validationService.validateBody({ nickname: '😀' }, bodyMeta({ modelClass: Nickname })))
                .rejects.toThrow(expect.objectContaining({ problems: [expect.objectContaining({ key: 'nickname', code: 'minLength' })] }));
            await expect(validationService.validateBody({ nickname: '😀😀😀😀' }, bodyMeta({ modelClass: Nickname })))
                .rejects.toThrow(expect.objectContaining({ problems: [expect.objectContaining({ key: 'nickname', code: 'maxLength' })] }));
        });

        it('hands a required function the object the property is on, not the whole body', async () => {
            await expect(
                validationService.validateBody({ booking: { flexible: true } }, bodyMeta({ modelClass: BookingRequest }))
            ).resolves.toBeUndefined();
            await expect(
                validationService.validateBody({ booking: { flexible: false } }, bodyMeta({ modelClass: BookingRequest }))
            ).rejects.toThrow('booking.endsAt: is required');
        });

        it('hands a required function the item of an array the property is on', async () => {
            await expect(
                validationService.validateBody(
                    { booking: { flexible: true }, alternatives: [{ flexible: true }, { flexible: false }] },
                    bodyMeta({ modelClass: BookingRequest })
                )
            ).rejects.toThrow(expect.objectContaining({
                problems: [expect.objectContaining({ key: 'alternatives.1.endsAt', code: 'required' })]
            }));
        });

        it('compares a date with another property of the object it is on', async () => {
            const endsAt: Date = new Date('2024-06-10T00:00:00.000Z');
            await expect(validationService.validateBody(
                { stay: { startsAt: new Date('2024-06-01T00:00:00.000Z'), endsAt } },
                bodyMeta({ modelClass: StayRequest })
            )).resolves.toBeUndefined();
            await expect(validationService.validateBody(
                { stay: { startsAt: new Date('2024-06-11T00:00:00.000Z'), endsAt } },
                bodyMeta({ modelClass: StayRequest })
            )).rejects.toThrow(expect.objectContaining({
                problems: [expect.objectContaining({ key: 'stay.startsAt', code: 'before' })]
            }));
        });

        describe('the checks of an entity', () => {
            it('answers a body breaking a check with the code and message of the check', async () => {
                await expect(validationService.validateBody(
                    // eslint-disable-next-line unicorn/no-null
                    { status: 'done', completedAt: null, estimate: 2 },
                    bodyMeta({ modelClass: ChoreCreateData })
                )).rejects.toThrow(expect.objectContaining({
                    problems: [{ key: 'body', code: 'completedAtRequired', message: 'a done chore has a completion date' }]
                }));
                await expect(validationService.validateBody(
                    { status: 'done', completedAt: new Date(), estimate: 2 },
                    bodyMeta({ modelClass: ChoreCreateData })
                )).resolves.toBeUndefined();
            });

            // 01 §D19: a check comparing two properties of the body
            it('answers a body whose one property breaks a comparison with another, and leaves an update lacking either to the data source', async () => {
                const startsAt: Date = new Date('2026-05-01T08:00:00.000Z');
                await expect(validationService.validateBody(
                    { status: 'open', estimate: 2, startsAt, endsAt: startsAt },
                    bodyMeta({ modelClass: ChoreCreateData })
                )).rejects.toThrow(expect.objectContaining({
                    problems: [{ key: 'body', code: 'endsBeforeStart', message: 'a chore ends after it starts' }]
                }));
                await expect(validationService.validateBody(
                    { status: 'open', estimate: 2, startsAt, endsAt: new Date('2026-05-01T09:00:00.000Z') },
                    bodyMeta({ modelClass: ChoreCreateData })
                )).resolves.toBeUndefined();
                // the start it is compared with is stored, which only the data source knows
                await expect(validationService.validateBody(
                    { endsAt: startsAt },
                    bodyMeta({ modelClass: ChoreUpdateData })
                )).resolves.toBeUndefined();
            });

            it('answers a check declared as its filter alone with the code check', async () => {
                await expect(validationService.validateBody(
                    { status: 'open', estimate: 0 },
                    bodyMeta({ modelClass: ChoreCreateData })
                )).rejects.toThrow(expect.objectContaining({
                    problems: [{ key: 'body', code: 'check', message: 'breaks the check on "estimate"' }]
                }));
            });

            it('reports a nested object breaking a check under the key of the object', async () => {
                await expect(validationService.validateBody(
                    // eslint-disable-next-line unicorn/no-null
                    { first: { status: 'done', completedAt: null, estimate: 2 } },
                    bodyMeta({ modelClass: ChoreList })
                )).rejects.toThrow(expect.objectContaining({
                    problems: [expect.objectContaining({ key: 'first', code: 'completedAtRequired' })]
                }));
            });

            it('leaves a check to the data source when the body lacks a property it compares', async () => {
                // an update leaves out what it does not change, so only the stored row can answer it
                await expect(validationService.validateBody(
                    { status: 'done' },
                    bodyMeta({ modelClass: ChoreUpdateData })
                )).resolves.toBeUndefined();
                // null is a value the body sets
                await expect(validationService.validateBody(
                    // eslint-disable-next-line unicorn/no-null
                    { status: 'done', completedAt: null },
                    bodyMeta({ modelClass: ChoreUpdateData })
                )).rejects.toThrow(expect.objectContaining({
                    problems: [expect.objectContaining({ code: 'completedAtRequired' })]
                }));
            });

            it('leaves out a check that compares a property the derived model does not have', async () => {
                await expect(validationService.validateBody(
                    { status: 'done', estimate: 2 },
                    bodyMeta({ modelClass: ChoreWithoutCompletion })
                )).resolves.toBeUndefined();
            });
        });

        describe('custom rules', () => {
            const leavesAt: Date = new Date('2024-06-01T00:00:00.000Z');

            it('reports what a rule finds under the property it names, or under the object', async () => {
                await expect(validationService.validateBody(
                    { trip: { leavesAt, returnsAt: new Date('2024-05-01T00:00:00.000Z'), seats: 1, travelers: ['Ada', 'Grace'] } },
                    bodyMeta({ modelClass: TripRequest })
                )).rejects.toThrow(expect.objectContaining({
                    problems: [
                        { key: 'trip.returnsAt', code: 'returnBeforeDeparture', message: 'has to be after leavesAt' },
                        { key: 'trip', code: 'tooManyTravelers', message: 'has more travelers than seats' }
                    ]
                }));
                await expect(validationService.validateBody(
                    { trip: { leavesAt, returnsAt: new Date('2024-06-05T00:00:00.000Z'), seats: 2, travelers: ['Ada', 'Grace'] } },
                    bodyMeta({ modelClass: TripRequest })
                )).resolves.toBeUndefined();
            });

            it('runs a rule only on an object whose properties are valid', async () => {
                // a rule reads the values as their types say, which a travelers of the wrong type is not
                await expect(validationService.validateBody(
                    { leavesAt, returnsAt: leavesAt, seats: 1, travelers: 'Ada' },
                    bodyMeta({ modelClass: Trip })
                )).rejects.toThrow(expect.objectContaining({
                    problems: [expect.objectContaining({ key: 'travelers', code: 'type' })]
                }));
            });

            it('applies a rule to a class extending the model, and not to a partial one', async () => {
                const returnsAt: Date = new Date('2024-05-01T00:00:00.000Z');
                await expect(validationService.validateBody(
                    { leavesAt, returnsAt, seats: 1, travelers: [], group: 'Team' },
                    bodyMeta({ modelClass: GroupTrip })
                )).rejects.toThrow(expect.objectContaining({
                    problems: [expect.objectContaining({ key: 'returnsAt', code: 'returnBeforeDeparture' })]
                }));
                await expect(validationService.validateBody({ returnsAt }, bodyMeta({ modelClass: TripChange }))).resolves.toBeUndefined();
            });

            it('refuses to decorate a class other than the one the rule was written for', () => {
                // @ts-expect-error - a rule of a Trip, on a class that is no Trip
                @ValidateCustom((trip: Trip) => trip.seats > 0 ? [] : [{ code: 'noSeats', message: $ts`has no seats` }])
                class Elsewhere extends Lodging {}

                expect(Elsewhere).toBeDefined();
            });
        });

        describe('array bodies', () => {
            it('rejects a non-array value when isArray is true', async () => {
                await expect(
                    validationService.validateBody({ name: 'Alice' }, bodyMeta({ isArray: true }))
                ).rejects.toThrow(ValidationError);
            });

            it('validates each item of an array body', async () => {
                await expect(
                    validationService.validateBody([{ name: 'Alice' }, { name: 42 }], bodyMeta({ isArray: true }))
                ).rejects.toThrow(ValidationError);
            });

            it('accepts a valid array body', async () => {
                await expect(
                    validationService.validateBody([{ name: 'Alice' }, { name: 'Bob' }], bodyMeta({ isArray: true }))
                ).resolves.toBeUndefined();
            });
        });

        describe('form-data bodies', () => {
            it('wraps form-data bodies in a Temp class requiring value + tempFolder', async () => {
                await expect(
                    validationService.validateBody(
                        { value: { name: 'Alice' }, tempFolder: '/tmp/upload' },
                        bodyMeta({ type: MimeType.FORM_DATA, cleanupAfterInMs: 1000 })
                    )
                ).resolves.toBeUndefined();
            });

            it('rejects a form-data body missing tempFolder', async () => {
                await expect(
                    validationService.validateBody(
                        { value: { name: 'Alice' } },
                        bodyMeta({ type: MimeType.FORM_DATA, cleanupAfterInMs: 1000 })
                    )
                ).rejects.toThrow(ValidationError);
            });
        });
    });

    describe('validateWebsocketRequest', () => {
        it('resolves for an empty request', async () => {
            await expect(validationService.validateWebsocketRequest({})).resolves.toBeUndefined();
        });

        it('resolves for a request with query/headers/params/body', async () => {
            await expect(
                validationService.validateWebsocketRequest({
                    query: { a: '1' },
                    headers: { 'x-request-id': 'abc' },
                    params: { id: '1' },
                    body: { anything: true }
                })
            ).resolves.toBeUndefined();
        });

        it('rejects an unknown top-level key', async () => {
            await expect(validationService.validateWebsocketRequest({ notAField: true })).rejects.toThrow(ValidationError);
        });
    });
});