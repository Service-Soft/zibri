# Models
Models are plain classes with their properties decorated by `@Property`. The same class can describe a request body, a response, an entity in a data source or anything else Zibri reads, and it is what values get parsed and validated against.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `Property` | decorator | Decorators for defining model properties |
| `AnyObject` | class | An object with any properties, keyed by string |
| `StringPropertyMetadataInput`, `IncomingStringPropertyMetadataInput` | type, type | What `@Property.string` takes, and what a string of a request or a response takes, with no `encryption` and no `hash` |
| `StringFormat` | type | What `format` of a string checks: `'uuid'`, `'email'` or `'phone'` |
| `NumberPropertyMetadataInput` | type | What `@Property.number` takes |
| `NumberFormat` | type | What kind of number a `@Property.number` holds: `'number'`, `'integer'`, `'bigint'` or `'bignumber'` |
| `BooleanPropertyMetadataInput`, `DatePropertyMetadataInput`, `ObjectPropertyMetadataInput`, `FilePropertyMetadataInput`, `UnknownPropertyMetadataInput` | type, type, type, type, type | What `@Property.boolean`, `@Property.date`, `@Property.object`, `@Property.file` and `@Property.unknown` take |
| `FileSize`, `fileSizeToBytes` | type, function | A file size such as `'5mb'`, in `b`, `kb`, `mb` or `gb`, and the bytes it stands for |
| `ArrayPropertyMetadataInput` | type | What `@Property.array` takes |
| `DefaultArrayPropertyMetadataInput`, `FileArrayPropertyMetadataInput`, `ArrayPropertyItemMetadataInput` | type, type, type | The two forms `@Property.array` takes, of values and of files with a `totalMaxSize`, and what its `items` take |
| `OneOfPropertyMetadataInput`, `OneOfShapesMetadataInput`, `OneOfShapeMetadataInput` | type, type, type | What `@Property.oneOf` takes, its `shapes` by name, and one of those shapes |
| `ManyToOnePropertyMetadataInput`, `OneToManyPropertyMetadataInput`, `BelongsToOnePropertyMetadataInput`, `HasOnePropertyMetadataInput`, `ManyToManyPropertyMetadataInput` | type, type, type, type, type | What `@Property.manyToOne`, `@Property.oneToMany`, `@Property.belongsToOne`, `@Property.hasOne` and `@Property.manyToMany` take |
| `AnyEnum` | type | An enum, or an object of string or number values, as `enum` takes it |
| `timezoneEnum` | constant | Every IANA time zone as an enum, for `@Property.string({ enum: timezoneEnum })` |
| `BigNumber` | class | An exact decimal of any size, which a `@Property.number({ format: 'bignumber' })` holds |
| `NumberUtilities` | class | Arithmetic and comparison over every shape a number takes: `number`, `bigint`, `BigNumber` |
| `OmitClass` | function | Creates a class that omits given properties from a base class |
| `PickClass` | function | Creates a class that picks given properties from a base class |
| `PartialClass` | function | Creates a class where every property of a base class is optional |
| `IntersectionClass` | function | Combines multiple classes into one |
| `OmitStrict` | type | A type without the given keys, which have to be keys of it |
| `ExcludeStrict` | type | A union without the given members, which have to be members of it |
| `IntRange`, `Percentage` | type, type | The whole numbers from a lower bound up to an upper one, the upper one left out, and the whole numbers from 0 to 100 |
| `OneOf` | type | A value of one of several named shapes, `{ shape, value }` |
| `OpenApiFileProvider`, `OpenApiFileProviderOptions` | class, type | Generates model classes from an OpenAPI document on disk, and the options it takes |
| `OpenApiUrlProvider`, `OpenApiUrlProviderOptions` | class, type | Generates model classes from an OpenAPI document at a URL, and the options it takes |
| `EntityGenerationProvider` | interface | What a source of generated model classes implements: the OpenAPI document, the `prefix` of the class names, and whether they are marked as entities |

## Defining a model

```ts
// src/models/article.model.ts
import { Property } from 'zibri';

export class Article {
    @Property.string({ maxLength: 120 })
    title!: string;

    @Property.number({ format: 'integer', min: 0 })
    views!: number;

    @Property.boolean()
    published!: boolean;

    @Property.date({ required: false })
    publishedAt?: Date;
}
```

Every property is required unless it says otherwise. These are the kinds a property can be:

| Decorator | Holds |
|---|---|
| `@Property.string` | Text, optionally restricted by `format`, `regex`, `enum`, `minLength` and `maxLength` |
| `@Property.number` | A number of the kind its `format` names, see [below](#what-kind-of-number-a-property-holds) |
| `@Property.boolean` | `true` or `false` |
| `@Property.date` | A `Date`, optionally [bounded](./validation.md#bounding-a-date) by `before` and `after` |
| `@Property.object` | An instance of the class it names |
| `@Property.array` | A list of items of one kind |
| `@Property.file` | An uploaded file, see [handling file uploads](./creating-endpoints.md#handling-file-uploads) |
| `@Property.oneOf` | One of several shapes, see [below](#a-value-of-several-shapes) |
| `@Property.unknown` | Whatever JSON holds |
| `@Property.manyToOne` | The one entity this entity points to, among many that can point to it |
| `@Property.oneToMany` | The entities pointing to this entity through their `manyToOne` |
| `@Property.belongsToOne` | The one entity this entity belongs to, which it keeps the key of |
| `@Property.hasOne` | The one entity that belongs to this entity through its `belongsToOne` |
| `@Property.manyToMany` | Entities related to this one through a join table |

The relation decorators connect [entities](./data-source.md#defining-entities) to each other.
Each names its `target` and the `inverseSide`, the property of the target pointing back. The target
declares that property with `@Property`. `manyToOne` and `belongsToOne` keep the key of the row they
point to, and name the property holding it as `joinColumn`, which the entity declares as well: it is
what a filter or a write names to reach the row by its id, such as `{ teamId }`.

A string's `format` is one of:

| `format` | Holds |
|---|---|
| `'uuid'` | A uuid |
| `'email'` | An email address |
| `'phone'` | A phone number in international format, such as `+4915112345678` |

A `regex` takes time linear to the value it checks, and needs the `re2` package. It cannot use
lookarounds or backreferences. The same goes for a `regex` on a parameter.

A `default` fills a property in when a row is created without a value for it. It applies to the
models the row holds and to a related row a write creates, too. An update writes what it is given and
fills nothing in, a nested object or array it writes included. `null` is a value, so it is stored as
`null`:

```ts
// src/models/member.model.ts
import { Property } from 'zibri';

export class Member {
    @Property.string({ default: 'active', required: false })
    status?: string | null;
}
```

## What kind of number a property holds

A number property says which kind of number it is, and that decides what type it has in TypeScript:

| `format` | TypeScript type | Holds |
|---|---|---|
| `number` (the default) | `number` | What a JavaScript number is: fractions, exact up to `Number.MAX_SAFE_INTEGER` |
| `integer` | `number` | A whole number inside that same range, such as a counter, a duration or a status code |
| `bigint` | `bigint` | A whole number of any size |
| `bignumber` | `BigNumber` | An exact decimal of any size, such as a price |

```ts
// src/models/line-item.model.ts
import { BigNumber, Property } from 'zibri';

export class LineItem {
    @Property.number({ format: 'integer' })
    quantity!: number;

    @Property.number({ format: 'bigint' })
    sequence!: bigint;

    @Property.number({ format: 'bignumber' })
    total!: BigNumber;
}
```

The TypeScript type has to match the format. When the type is written as a union, like `sequence?: bigint | null`, the value is checked against the format instead.

`bigint` and `bignumber` are sent as strings in JSON, and the OpenAPI document says so. A request can still send either as a plain JSON number where it fits.

Arithmetic on a `BigNumber` goes through `NumberUtilities`, which takes any of the three shapes:

```ts
// src/services/line-item.service.ts
import { BigNumber, Injectable, NumberUtilities } from 'zibri';

@Injectable()
export class LineItemService {
    withShipping(total: BigNumber): BigNumber {
        return NumberUtilities.add(total, 19.99);
    }
}
```

## What an object or array property holds

The class an object property names says what each value inside it is, all the way down: a date inside an object comes back as a `Date`, a whole number of any size as a `bigint`, an exact decimal as a `BigNumber`. Array properties work the same way, whatever their items are.

```ts
// src/models/reading.model.ts
import { BigNumber, Property } from 'zibri';

class Sample {
    @Property.date()
    takenAt!: Date;

    @Property.number({ format: 'bignumber' })
    value!: BigNumber;
}

export class Reading {
    @Property.object({ cls: () => Sample })
    latest!: Sample;

    @Property.array({ items: { type: 'object', cls: () => Sample } })
    samples!: Sample[];

    @Property.array({ items: { type: 'number', format: 'bigint' } })
    sequences!: bigint[];
}
```

`@Property.unknown` describes nothing about its contents, so what you get back is plain JSON: objects, arrays, strings, numbers and booleans. Name a class wherever you know the shape.

## A value of several shapes

When a value can take one of several shapes, like one of several classes or `Date | string`, give each shape a name and list them with `@Property.oneOf`. The property is typed as `OneOf` of the same names:

```ts
// src/models/notification.model.ts
import { OneOf, Property } from 'zibri';

export class EmailChannel {
    @Property.string({ format: 'email' })
    address!: string;
}

export class SmsChannel {
    @Property.string({ regex: /^\+\d+$/ })
    number!: string;
}

export class Notification {
    @Property.oneOf({
        shapes: {
            Email: { type: 'object', cls: () => EmailChannel },
            Sms: { type: 'object', cls: () => SmsChannel }
        }
    })
    channel!: OneOf<{ Email: EmailChannel, Sms: SmsChannel }>;

    @Property.oneOf({
        shapes: { At: { type: 'date' }, Note: { type: 'string' } },
        required: false
    })
    sendAt?: OneOf<{ At: Date, Note: string }>;

    @Property.array({ items: { type: 'oneOf', shapes: { Text: { type: 'string' }, Count: { type: 'number' } } } })
    references!: OneOf<{ Text: string, Count: number }>[];
}
```

A value names its shape, in memory, in JSON and in the data source alike:

```json
{ "channel": { "shape": "Sms", "value": { "number": "+49123456" } } }
```

Checking `shape` narrows `value` to that shape:

```ts
// src/services/notification.service.ts
import { Injectable, OneOf } from 'zibri';

import { EmailChannel, SmsChannel } from '../models/notification.model';

@Injectable()
export class NotificationService {
    destinationOf(channel: OneOf<{ Email: EmailChannel, Sms: SmsChannel }>): string {
        switch (channel.shape) {
            case 'Email': {
                return channel.value.address;
            }
            case 'Sms': {
                return channel.value.number;
            }
        }
    }
}
```

A value is read and validated as the shape it names, and nothing else. A name that is none of the shapes is reported on `channel.shape`, a problem with the value on `channel.value` and below. In the OpenAPI document the property is `oneOf` its shapes, told apart by `shape`.

The type of the property has to match the shapes, which the compiler checks: the same names, each with the type of its shape. `?`, `| null` and `| undefined` are fine, and so is narrower text under a shape of text, like `OneOf<{ All: 'all', Matchers: string[] }>`. The check needs the property to be visible from outside the class, so it doesn't work on `private` properties.

Shapes can be array items, and a class used as a shape can have `oneOf` properties of its own. Encrypted, hashed, excluded and defaulted properties of a class used as a shape work the same as anywhere else. A `oneOf` has at least two shapes. Their names are not empty, and differ in more than the case of their first letter. A shape is neither a `oneOf` nor a `file`.

A request body, a parameter and a response read by the http client can be one of several shapes too. Those are sent by whoever calls you, so they carry no name and become the first shape they fit, see [request bodies](./creating-endpoints.md#a-body-of-several-shapes), [parameters](./creating-endpoints.md#path-query-and-header-params) and [the http client](./http-client.md#body).

## Deriving models

A model can be built from another one instead of repeating its properties:

```ts
// src/models/user.model.ts
import { OmitClass, PartialClass, Property } from 'zibri';

export class User {
    @Property.string({ format: 'uuid' })
    id!: string;

    @Property.string({ format: 'email' })
    email!: string;

    @Property.string()
    name!: string;
}

export class UserCreateDTO extends OmitClass(User, ['id']) {}

export class UserUpdateDTO extends PartialClass(UserCreateDTO) {}
```

A derived model takes over the declarations of the properties it keeps. A declaration cannot be
changed once it is made, so a derived model that needs a property declared differently declares it
again:

```ts
// src/models/user.model.ts
import { Property } from 'zibri';

export class UserRegistrationDTO extends UserCreateDTO {
    @Property.string({ required: false })
    override name: string = '';
}
```

## Requirements
| Package | Used for |
|---|---|
| `bignumber.js` | Exact decimals of any size, the `BigNumber` of a `bignumber` property |
| `re2` | Checking a `regex` in time linear to the value. You install it |

## See also
- [Validating requests](./validation.md) — what a refused value is answered with, and rules of your own
- [Creating endpoints](./creating-endpoints.md) — models as request bodies and responses
- [Data sources](./data-source.md) — models as entities
- [Excluding properties](./excluding-properties.md) — keeping a property from leaving the server
- [Encryption and hashing](./encryption-and-hashing.md) — encrypted and hashed properties