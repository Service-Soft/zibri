import { describe, expect, it } from '@jest/globals';

import { Property, PropertyMetadata } from './property.decorator';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { type OneOf } from '../models/one-of.model';

class EmailChannel {
    @Property.string()
    address!: string;
}

class SmsChannel {
    @Property.string()
    number!: string;
}

/**
 * Reads a property's metadata the way everything that parses, validates or documents one does.
 * @param cls - The class the property is on.
 * @param key - The name of the property.
 * @returns What the property was declared as.
 */
function metadataOf(cls: Newable<unknown>, key: string): PropertyMetadata | undefined {
    return MetadataUtilities.getModelProperties(cls)[key];
}

describe('declaring a property that holds one of several shapes', () => {
    it('records every shape under its name, with the defaults of its own kind', () => {
        class Route {
            @Property.oneOf({
                shapes: {
                    All: { type: 'string', enum: { all: 'all' } },
                    Matchers: { type: 'array', items: { type: 'string' } }
                }
            })
            versions!: OneOf<{ All: string, Matchers: string[] }>;
        }

        expect(metadataOf(Route, 'versions')).toEqual(expect.objectContaining({
            type: 'oneOf',
            required: true,
            shapes: {
                All: expect.objectContaining({ type: 'string', enum: { all: 'all' }, required: true, maxLength: undefined }),
                Matchers: expect.objectContaining({ type: 'array', items: expect.objectContaining({ type: 'string' }) })
            }
        }));
    });

    it('takes what the property as a whole is declared with beside the shapes', () => {
        class Route {
            @Property.oneOf({
                shapes: { All: { type: 'string', enum: { all: 'all' } }, Matchers: { type: 'array', items: { type: 'string' } } },
                required: false,
                description: 'which versions the route serves'
            })
            versions?: OneOf<{ All: string, Matchers: string[] }>;
        }

        expect(metadataOf(Route, 'versions')).toEqual(expect.objectContaining({
            type: 'oneOf',
            required: false,
            description: 'which versions the route serves'
        }));
    });

    it('takes several classes, and shapes json writes the same way', () => {
        class Subscription {
            @Property.oneOf({
                shapes: { Email: { type: 'object', cls: () => EmailChannel }, Sms: { type: 'object', cls: () => SmsChannel } }
            })
            channel!: OneOf<{ Email: EmailChannel, Sms: SmsChannel }>;

            // a value names its shape, so a date and a text are two shapes even though json writes both as text
            @Property.oneOf({ shapes: { Due: { type: 'date' }, Note: { type: 'string' } } })
            due!: OneOf<{ Due: Date, Note: string }>;
        }

        expect(metadataOf(Subscription, 'channel')).toEqual(expect.objectContaining({
            type: 'oneOf',
            shapes: {
                Email: expect.objectContaining({ type: 'object', allowAdditionalProperties: false }),
                Sms: expect.objectContaining({ type: 'object', allowAdditionalProperties: false })
            }
        }));
        expect(metadataOf(Subscription, 'due')).toEqual(expect.objectContaining({ type: 'oneOf' }));
    });

    it('takes a property that may be null, undefined or left out', () => {
        class Reminder {
            @Property.oneOf({ shapes: { Due: { type: 'date' }, Note: { type: 'string' } }, required: false })
            due?: OneOf<{ Due: Date, Note: string }> | null;

            @Property.oneOf({ shapes: { Due: { type: 'date' }, Note: { type: 'string' } }, required: false })
            snoozedUntil!: OneOf<{ Due: Date, Note: string }> | undefined;

            @Property.oneOf({ shapes: { Due: { type: 'date' }, Note: { type: 'string' } }, required: false })
            doneAt!: OneOf<{ Due: Date, Note: string }> | null | undefined;
        }

        expect(metadataOf(Reminder, 'due')).toEqual(expect.objectContaining({ type: 'oneOf', required: false }));
        expect(metadataOf(Reminder, 'snoozedUntil')).toEqual(expect.objectContaining({ type: 'oneOf', required: false }));
        expect(metadataOf(Reminder, 'doneAt')).toEqual(expect.objectContaining({ type: 'oneOf', required: false }));
    });

    it('takes one of several shapes as the kind of an array item', () => {
        class Inbox {
            @Property.array({ items: { type: 'oneOf', shapes: { Text: { type: 'string' }, Count: { type: 'number' } } } })
            values!: OneOf<{ Text: string, Count: number }>[];
        }

        expect(metadataOf(Inbox, 'values')).toEqual(expect.objectContaining({
            type: 'array',
            items: expect.objectContaining({ type: 'oneOf', shapes: { Text: expect.anything(), Count: expect.anything() } })
        }));
    });

    it('takes narrower text where a shape declares text, while compiling', () => {
        class Route {
            @Property.oneOf({
                shapes: {
                    All: { type: 'string', enum: { all: 'all' } },
                    Matchers: { type: 'array', items: { type: 'string' } }
                }
            })
            versions!: OneOf<{ All: 'all', Matchers: `^${number}`[] }>;
        }

        expect(metadataOf(Route, 'versions')).toEqual(expect.objectContaining({ type: 'oneOf' }));
    });

    it('refuses a property whose type disagrees with the shapes, while compiling', () => {
        class Contact {
            // @ts-expect-error - the property calls a shape Text that the decorator calls Note
            @Property.oneOf({ shapes: { Due: { type: 'date' }, Note: { type: 'string' } } })
            due!: OneOf<{ Due: Date, Text: string }>;

            // @ts-expect-error - the property holds a number where the decorator declares text
            @Property.oneOf({ shapes: { Due: { type: 'date' }, Note: { type: 'string' } } })
            other!: OneOf<{ Due: Date, Note: number }>;

            // @ts-expect-error - the property is not a value of several shapes at all
            @Property.oneOf({ shapes: { Due: { type: 'date' }, Note: { type: 'string' } } })
            plain!: string;

            // @ts-expect-error - the property names the classes the other way around
            @Property.oneOf({ shapes: { Email: { type: 'object', cls: () => EmailChannel }, Sms: { type: 'object', cls: () => SmsChannel } } })
            channel!: OneOf<{ Email: SmsChannel, Sms: EmailChannel }>;

            // @ts-expect-error - the property leaves out the shape Note that the decorator declares
            @Property.oneOf({ shapes: { Due: { type: 'date' }, Note: { type: 'string' } } })
            reminder!: OneOf<{ Due: Date }>;

            // @ts-expect-error - the property holds a single text where the decorator declares a list of them
            @Property.oneOf({ shapes: { All: { type: 'string' }, Matchers: { type: 'array', items: { type: 'string' } } } })
            versions!: OneOf<{ All: 'all', Matchers: 'latest' }>;
        }

        expect(metadataOf(Contact, 'due')).toEqual(expect.objectContaining({ type: 'oneOf' }));
    });

    it('refuses a single shape', () => {
        expect(() => {
            class Route {
                @Property.oneOf({ shapes: { Text: { type: 'string' } } })
                versions!: OneOf<{ Text: string }>;
            }
            return Route;
        }).toThrow(/Route\.versions.*at least two shapes/s);
    });

    it('refuses one of several shapes written directly as a shape', () => {
        expect(() => {
            class Nested {
                // @ts-expect-error - refused by the type as well; this is the refusal a caller without types gets
                @Property.oneOf({ shapes: { Inner: { type: 'oneOf', shapes: { Text: { type: 'string' }, Count: { type: 'number' } } }, Flag: { type: 'boolean' } } })
                value!: unknown;
            }
            return Nested;
        }).toThrow(/Nested\.value.*Inner.*cannot be one of the shapes/s);
    });

    it('refuses a file as a shape, which json cannot carry', () => {
        expect(() => {
            class Upload {
                // @ts-expect-error - refused by the type as well
                @Property.oneOf({ shapes: { Attachment: { type: 'file' }, Link: { type: 'string' } } })
                attachment!: unknown;
            }
            return Upload;
        }).toThrow(/Upload\.attachment.*Attachment.*file/s);
    });

    it('refuses two names a filter could not tell apart', () => {
        // a filter names a shape as `when` followed by its name with the first letter capitalized
        expect(() => {
            class Contact {
                @Property.oneOf({ shapes: { email: { type: 'string' }, Email: { type: 'number' } } })
                value!: OneOf<{ email: string, Email: number }>;
            }
            return Contact;
        }).toThrow(/Contact\.value.*"email".*"Email".*whenEmail/s);
    });

    it('refuses an empty name', () => {
        expect(() => {
            class Contact {
                @Property.oneOf({ shapes: { '': { type: 'string' }, Count: { type: 'number' } } })
                value!: OneOf<{ '': string, Count: number }>;
            }
            return Contact;
        }).toThrow(/Contact\.value.*empty name/s);
    });
});

describe('a value of one of several shapes', () => {
    it('narrows to its shape by its name', () => {
        /**
         * Reads where a channel sends to, whichever channel it is.
         * @param channel - The channel.
         * @returns The address or number.
         */
        function destinationOf(channel: OneOf<{ Email: EmailChannel, Sms: SmsChannel }>): string {
            switch (channel.shape) {
                case 'Email': {
                    return channel.value.address;
                }
                case 'Sms': {
                    return channel.value.number;
                }
            }
        }

        expect(destinationOf({ shape: 'Sms', value: { number: '+49123' } })).toBe('+49123');
        expect(destinationOf({ shape: 'Email', value: { address: 'a@b.c' } })).toBe('a@b.c');
    });

    it('checks the name and the value together', () => {
        // @ts-expect-error - an sms channel under the name of the email one
        // eslint-disable-next-line unicorn/no-unused-properties
        const wrong: OneOf<{ Email: EmailChannel, Sms: SmsChannel }> = { shape: 'Email', value: { number: '+49123' } };

        expect(wrong.shape).toBe('Email');
    });
});