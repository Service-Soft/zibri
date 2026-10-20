import { beforeAll, describe, expect, it } from 'vitest';

import { parseObject } from './parse-object.function.ts';
import { parseShape } from './parse-one-of.function.ts';
import { initDiContainer } from '../../di/init-di-container.function.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { type OneOf } from '../../entity/models/one-of.model.ts';
import { GlobalRegistry } from '../../global/global-registry.ts';
import { BodyShapeMetadata, JsonBodyShapeMetadataInput } from '../../routing/decorators/body-metadata.model.ts';
import { resolveStructuredBodyMetadata } from '../../routing/resolve-body-metadata.function.ts';

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
}

class Subscription {
    @Property.oneOf({ shapes: { Email: { type: 'object', cls: () => EmailChannel }, Sms: { type: 'object', cls: () => SmsChannel } } })
    channel!: OneOf<{ Email: EmailChannel, Sms: SmsChannel }>;
}

class Reminder {
    @Property.oneOf({ shapes: { Due: { type: 'date' }, Note: { type: 'string' } } })
    due!: OneOf<{ Due: Date, Note: string }>;
}

beforeAll(() => {
    initDiContainer();
    GlobalRegistry.markAppAsCreated();
});

describe('parsing a value of several named shapes', () => {
    // parsing is what a version file, a backup, a cached value and a stored row go through without any
    // validation behind them, so it reads the shape the value names and nothing else

    it('reads the value as the shape it names, and restores that shape\'s dates', () => {
        expect(parseObject({ channel: { shape: 'Sms', value: { address: '+49123456', verifiedAt: '2026-03-01T10:00:00.000Z' } } }, Subscription))
            .toEqual({ channel: { shape: 'Sms', value: { address: '+49123456', verifiedAt: new Date('2026-03-01T10:00:00.000Z') } } });
    });

    it('reads a date and a text apart by name, although json writes both as text', () => {
        expect(parseObject({ due: { shape: 'Due', value: '2026-03-01T10:00:00.000Z' } }, Reminder))
            .toEqual({ due: { shape: 'Due', value: new Date('2026-03-01T10:00:00.000Z') } });
        expect(parseObject({ due: { shape: 'Note', value: '2026-03-01T10:00:00.000Z' } }, Reminder))
            .toEqual({ due: { shape: 'Note', value: '2026-03-01T10:00:00.000Z' } });
    });

    it('does not fall back to another shape when the value breaks the rules of the one it names', () => {
        // which shape a value is, is what it says it is - validation reports what is wrong with it
        expect(parseObject({ channel: { shape: 'Email', value: { address: '+49123456', verifiedAt: '2026-03-01T10:00:00.000Z' } } }, Subscription))
            .toEqual({ channel: { shape: 'Email', value: { address: '+49123456', verifiedAt: new Date('2026-03-01T10:00:00.000Z') } } });
    });

    it('reads a value that arrived as json text', () => {
        expect(parseObject({ due: '{"shape":"Due","value":"2026-03-01T10:00:00.000Z"}' }, Reminder))
            .toEqual({ due: { shape: 'Due', value: new Date('2026-03-01T10:00:00.000Z') } });
    });

    it('leaves a value that names no known shape as it arrived, for validation to report', () => {
        expect(parseObject({ due: { shape: 'Later', value: 'x' } }, Reminder)).toEqual({ due: { shape: 'Later', value: 'x' } });
        expect(parseObject({ due: '2026-03-01T10:00:00.000Z' }, Reminder)).toEqual({ due: '2026-03-01T10:00:00.000Z' });
        expect(parseObject({ due: { value: 'x' } }, Reminder)).toEqual({ due: { value: 'x' } });
    });

    it('reads each item of an array by the shape it names', () => {
        class Agenda {
            @Property.array({ items: { type: 'oneOf', shapes: { At: { type: 'date' }, Note: { type: 'string' } } } })
            entries!: OneOf<{ At: Date, Note: string }>[];
        }

        expect(parseObject({ entries: [{ shape: 'At', value: '2026-03-01T10:00:00.000Z' }, { shape: 'Note', value: 'lunch' }] }, Agenda))
            .toEqual({ entries: [{ shape: 'At', value: new Date('2026-03-01T10:00:00.000Z') }, { shape: 'Note', value: 'lunch' }] });
    });

    it('reads a value it already read into the same value again', () => {
        const once: unknown = parseObject({ due: { shape: 'Due', value: '2026-03-01T10:00:00.000Z' } }, Reminder);

        expect(parseObject(once, Reminder)).toEqual({ due: { shape: 'Due', value: new Date('2026-03-01T10:00:00.000Z') } });
    });
});

describe('parsing a value that is the first of several shapes it fits', () => {
    // what a body or a parameter of several shapes is: a format described rather than owned, so the
    // value names nothing and is read as the first shape it fits

    /**
     * The shape a json body of the given shapes is declared as.
     * @param shapes - The shapes of the body, in order.
     * @returns The body's shape.
     */
    function bodyOf(...shapes: JsonBodyShapeMetadataInput[]): BodyShapeMetadata {
        return resolveStructuredBodyMetadata({ shapes }, 0).shape;
    }

    it('becomes the first shape in declaration order that the value fits', () => {
        const dateFirst: BodyShapeMetadata = bodyOf({ type: 'date' }, { type: 'string' });

        expect(parseShape('2026-03-01T10:00:00.000Z', dateFirst)).toEqual(new Date('2026-03-01T10:00:00.000Z'));
        expect(parseShape('next week', dateFirst)).toBe('next week');
    });

    it('goes on to the next class when the value breaks a rule of the first, and restores that class\'s dates', () => {
        const channels: BodyShapeMetadata = bodyOf({ type: 'object', cls: () => EmailChannel }, { type: 'object', cls: () => SmsChannel });

        expect(parseShape({ address: '+49123456', verifiedAt: '2026-03-01T10:00:00.000Z' }, channels))
            .toEqual({ address: '+49123456', verifiedAt: new Date('2026-03-01T10:00:00.000Z') });
    });

    it('does not let a class it tried and moved past change the value the next class is handed', () => {
        // every shape is tried on a copy of its own. Trying the first class on the value itself would
        // turn the code into a number before failing on the address, and the second class - which
        // holds the code as text - would then be handed a number and not fit either
        class NumericCode {
            @Property.string({ regex: /^[^\s@]+@[^\s@]+$/ })
            address!: string;

            @Property.number()
            code!: number;
        }
        class TextCode {
            @Property.string({ regex: /^\+\d+$/ })
            address!: string;

            @Property.string()
            code!: string;
        }

        expect(parseShape({ address: '+49123456', code: '0042' }, bodyOf({ type: 'object', cls: () => NumericCode }, { type: 'object', cls: () => TextCode })))
            .toEqual({ address: '+49123456', code: '0042' });
    });

    it('counts a property that is left out as fitting when whether it is required is decided by the request', () => {
        class Invited {
            @Property.string({ required: () => true })
            email!: string;
        }
        class Anonymous {
            @Property.boolean()
            anonymous!: boolean;
        }

        expect(parseShape({}, bodyOf({ type: 'object', cls: () => Invited }, { type: 'object', cls: () => Anonymous }))).toEqual({});
    });

    it('reads a named value inside a class it chose', () => {
        expect(parseShape(
            { channel: { shape: 'Sms', value: { address: '+49123456', verifiedAt: '2026-03-01T10:00:00.000Z' } } },
            bodyOf({ type: 'object', cls: () => Subscription }, { type: 'string', enum: { none: 'none' } })
        )).toEqual({ channel: { shape: 'Sms', value: { address: '+49123456', verifiedAt: new Date('2026-03-01T10:00:00.000Z') } } });
    });

    it('leaves a value no shape fits as it arrived, for validation to report', () => {
        expect(parseShape(5, bodyOf({ type: 'string', enum: { all: 'all' } }, { type: 'array', items: { type: 'date' } }))).toBe(5);
    });
});