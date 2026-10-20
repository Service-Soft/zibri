import { beforeAll, describe, expect, it } from 'vitest';

import { ValidationProblem } from './validation-problem.model.ts';
import { ValidationService } from './validation.service.ts';
import { initDiContainer } from '../di/init-di-container.function.ts';
import { Property } from '../entity/decorators/property.decorator.ts';
import { type OneOf } from '../entity/models/one-of.model.ts';
import { GlobalRegistry } from '../global/global-registry.ts';
import { JsonBodyParser } from '../parsing/json/json.body-parser.ts';
import { BodyMetadata, JsonBodyMetadata, JsonBodyShapeMetadataInput } from '../routing/decorators/body-metadata.model.ts';
import { BodyDeclaration, resolveBodyMetadata } from '../routing/resolve-body-metadata.function.ts';
import { Newable } from '../types/newable.type.ts';
import { JsonUtilities } from '../utilities/json.utilities.ts';
import { WebsocketRequest } from '../websocket/models/websocket-request.model.ts';

/**
 * What a body turned into once it was read and checked.
 */
type Received = {
    /**
     * The body as the handler would get it.
     */
    value: unknown,
    /**
     * What validation found wrong with it.
     */
    problems: ValidationProblem[]
};

/**
 * Reads a json body the way a request does: parsed by the json body parser, then validated - the two
 * steps the router runs, in its order.
 * @param declaration - What the body is declared as.
 * @param body - What the caller sent, before it became json.
 * @returns The value the handler would get, and what validation reported.
 */
async function receive(declaration: BodyDeclaration, body: unknown): Promise<Received> {
    const metadata: BodyMetadata = resolveBodyMetadata(declaration, 0);
    const request: WebsocketRequest = new WebsocketRequest();
    request.body = JsonUtilities.parse<unknown>(JsonUtilities.stringify(body));
    const value: unknown = new JsonBodyParser().parseFromWebsocketRequest(request, metadata as JsonBodyMetadata);
    const problems: ValidationProblem[] = await new ValidationService().getBodyValidationProblems(value, metadata);
    return { value, problems };
}

/**
 * Reads a json body declared as one model.
 * @param cls - The model.
 * @param body - What the caller sent.
 * @returns The value the handler would get, and what validation reported.
 */
async function receiveModel(cls: Newable<unknown>, body: unknown): Promise<Received> {
    return await receive({ modelClass: cls }, body);
}

/**
 * Reads a json body declared as the first of several shapes it fits.
 * @param shapes - The shapes, in order.
 * @param body - What the caller sent.
 * @returns The value the handler would get, and what validation reported.
 */
async function receiveAnyOf(shapes: JsonBodyShapeMetadataInput[], body: unknown): Promise<Received> {
    return await receive({ shapes }, body);
}

class EmailChannel {
    @Property.string({ regex: /^[^\s@]+@[^\s@]+$/ })
    address!: string;

    @Property.date({ required: false })
    verifiedAt?: Date;
}

class SmsChannel {
    @Property.string({ regex: /^\+\d+$/ })
    address!: string;

    @Property.date({ required: false })
    verifiedAt?: Date;

    @Property.string({ required: false })
    carrier?: string;
}

class Subscription {
    @Property.oneOf({ shapes: { Email: { type: 'object', cls: () => EmailChannel }, Sms: { type: 'object', cls: () => SmsChannel } } })
    channel!: OneOf<{ Email: EmailChannel, Sms: SmsChannel }>;
}

beforeAll(() => {
    initDiContainer();
    // validation problems are translated, which needs an application that exists
    GlobalRegistry.markAppAsCreated();
});

describe('reading a value of several named shapes', () => {
    it('reads a value as the shape it names', async () => {
        await expect(receiveModel(Subscription, { channel: { shape: 'Sms', value: { address: '+49123456', verifiedAt: '2026-03-01T10:00:00.000Z' } } }))
            .resolves.toEqual({
                value: { channel: { shape: 'Sms', value: { address: '+49123456', verifiedAt: new Date('2026-03-01T10:00:00.000Z') } } },
                problems: []
            });
    });

    it('reports what is wrong with the value as the shape it names, rather than trying another', async () => {
        const { problems } = await receiveModel(Subscription, { channel: { shape: 'Email', value: { address: '+49123456' } } });

        expect(problems).toEqual([expect.objectContaining({ key: 'channel.value.address' })]);
    });

    it('reports a name that is none of the shapes, and lists the ones there are', async () => {
        const { problems } = await receiveModel(Subscription, { channel: { shape: 'Fax', value: { address: '+49123456' } } });

        expect(problems).toHaveLength(1);
        expect(problems[0]).toEqual(expect.objectContaining({ key: 'channel.shape' }));
        expect(problems[0]?.message).toMatch(/Email.*Sms/s);
    });

    it('reports a value that names no shape at all', async () => {
        const { problems } = await receiveModel(Subscription, { channel: { value: { address: '+49123456' } } });

        expect(problems).toEqual([expect.objectContaining({ key: 'channel.shape' })]);
    });

    it('reports a value that is not a shape and a value at all', async () => {
        const { problems } = await receiveModel(Subscription, { channel: '+49123456' });

        expect(problems).toEqual([expect.objectContaining({ key: 'channel' })]);
    });

    it('reports a key beside the shape and the value', async () => {
        const { problems } = await receiveModel(Subscription, { channel: { shape: 'Sms', value: { address: '+49123456' }, extra: true } });

        expect(problems).toEqual([expect.objectContaining({ key: 'channel.extra', message: 'this key is unknown' })]);
    });

    it('reports a named shape whose value is missing', async () => {
        const { problems } = await receiveModel(Subscription, { channel: { shape: 'Sms' } });

        expect(problems).toEqual([expect.objectContaining({ key: 'channel.value', message: 'is required' })]);
    });

    it('asks the request whether a property of the named shape is required', async () => {
        class Invited {
            @Property.string({ required: () => true })
            email!: string;
        }
        class Anonymous {
            @Property.boolean()
            anonymous!: boolean;
        }
        class Guest {
            @Property.oneOf({ shapes: { Invited: { type: 'object', cls: () => Invited }, Anonymous: { type: 'object', cls: () => Anonymous } } })
            who!: OneOf<{ Invited: Invited, Anonymous: Anonymous }>;
        }

        const { problems } = await receiveModel(Guest, { who: { shape: 'Invited', value: {} } });

        expect(problems).toEqual([expect.objectContaining({ key: 'who.value.email', message: 'is required' })]);
    });

    it('reports a missing value once, and nothing when it is not required', async () => {
        class Optional {
            @Property.oneOf({ shapes: { Text: { type: 'string' }, Count: { type: 'number' } }, required: false })
            value?: OneOf<{ Text: string, Count: number }>;
        }

        await expect(receiveModel(Subscription, {})).resolves.toEqual(expect.objectContaining({
            problems: [expect.objectContaining({ key: 'channel', message: 'is required' })]
        }));
        await expect(receiveModel(Optional, {})).resolves.toEqual({ value: {}, problems: [] });
    });

    it('reports the item of an array by its index', async () => {
        class Agenda {
            @Property.array({ items: { type: 'oneOf', shapes: { At: { type: 'date' }, Count: { type: 'number' } } } })
            entries!: OneOf<{ At: Date, Count: number }>[];
        }

        const { problems } = await receiveModel(Agenda, { entries: [{ shape: 'At', value: '2026-03-01T10:00:00.000Z' }, { shape: 'Count', value: 'many' }] });

        expect(problems).toEqual([expect.objectContaining({ key: 'entries.1.value' })]);
    });
});

describe('reading a body that is the first of several shapes it fits', () => {
    it('becomes the first shape in declaration order that the value fits', async () => {
        await expect(receiveAnyOf([{ type: 'date' }, { type: 'string' }], '2026-03-01T10:00:00.000Z'))
            .resolves.toEqual({ value: new Date('2026-03-01T10:00:00.000Z'), problems: [] });
        await expect(receiveAnyOf([{ type: 'date' }, { type: 'string' }], 'next week'))
            .resolves.toEqual({ value: 'next week', problems: [] });
        // the same text, with text declared first: every date is also text, so text is what fits first
        await expect(receiveAnyOf([{ type: 'string' }, { type: 'date' }], '2026-03-01T10:00:00.000Z'))
            .resolves.toEqual({ value: '2026-03-01T10:00:00.000Z', problems: [] });
    });

    it('goes on to the next class when the value breaks a rule, or carries a key only that class declares', async () => {
        const channels: JsonBodyShapeMetadataInput[] = [{ type: 'object', cls: () => EmailChannel }, { type: 'object', cls: () => SmsChannel }];

        await expect(receiveAnyOf(channels, { address: '+49123456', verifiedAt: '2026-03-01T10:00:00.000Z' }))
            .resolves.toEqual({ value: { address: '+49123456', verifiedAt: new Date('2026-03-01T10:00:00.000Z') }, problems: [] });
        await expect(receiveAnyOf(channels, { address: '+49123456', carrier: 'network' }))
            .resolves.toEqual({ value: { address: '+49123456', carrier: 'network' }, problems: [] });
    });

    it('chooses by declaration order rather than by which shape finishes deciding first', async () => {
        // the first shape takes longer to decide than the second, and both fit. Choosing whichever
        // settled first would make the same request read differently from one call to the next
        class Slow {
            @Property.date({ required: async () => await new Promise<boolean>(resolve => setTimeout(() => resolve(true), 30)) })
            at!: Date;
        }
        class Fast {
            @Property.string()
            at!: string;
        }

        for (let i: number = 0; i < 5; i++) {
            await expect(receiveAnyOf([{ type: 'object', cls: () => Slow }, { type: 'object', cls: () => Fast }], { at: '2026-03-01T10:00:00.000Z' }))
                .resolves.toEqual({ value: { at: new Date('2026-03-01T10:00:00.000Z') }, problems: [] });
        }
    });

    it('reports one problem that names every shape when none fits', async () => {
        const { problems } = await receiveAnyOf([{ type: 'object', cls: () => EmailChannel }, { type: 'object', cls: () => SmsChannel }], { address: 'neither' });

        expect(problems).toHaveLength(1);
        expect(problems[0]).toEqual(expect.objectContaining({ key: 'body' }));
        expect(problems[0]?.message).toMatch(/EmailChannel.*SmsChannel/s);
    });

    it('reports what the chosen shape requires once the request decides it', async () => {
        // left out, the property fits while the shape is chosen - which shape a value is cannot depend
        // on who sent it. Checking the chosen shape completely is where the request is asked
        class Invited {
            @Property.string({ required: () => true })
            email!: string;
        }
        class Anonymous {
            @Property.boolean()
            anonymous!: boolean;
        }

        const { problems } = await receiveAnyOf([{ type: 'object', cls: () => Invited }, { type: 'object', cls: () => Anonymous }], {});

        expect(problems).toEqual([expect.objectContaining({ key: 'email', message: 'is required' })]);
    });
});