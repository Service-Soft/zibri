# Validating requests
Every value a request brings is checked against what its model declares before the handler runs:
the body, the path, query and header parameters, and a websocket request. A value that breaks a
rule is answered with a `400` that lists every problem, each under the path to the value it is
about, with a code a client can act on. The same checks run on a response read through the
[http client](./http-client.md) and on an [XML document](./xml.md) read or written.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ValidateCustom` | decorator | Adds a rule to a model that its properties cannot say on their own, such as one comparing two of them |
| `CustomValidationRule` | type | What `@ValidateCustom` takes: given the object and the request, returns its problems |
| `CustomValidationProblem` | type | A problem a custom rule finds: the `property` it is with, a `code` and a `message` |
| `ValidationProblem` | class | One problem of a refused request: its `key`, `code` and `message` |
| `ValidationProblemCode` | enum | The code of every problem the property options find, such as `required` or `maxLength` |
| `DateBound` | type | What `before` and `after` of a date take: given the object and the request, returns the date |
| `EntityCheck` | type | A check of an entity written out, with the `code` and `message` it is answered with |
| `ValidationService`, `ValidationServiceInterface` | class, interface | Validates values against their models. Replaceable through `ZIBRI_DI_TOKENS.VALIDATION_SERVICE` |

## Reading a refused request
A refused request is answered with the [error body](./error-handling.md#how-the-global-error-handler-processes-an-error)
every error has, and with `problems`:

```json
{
    "status": 400,
    "name": "ValidationError",
    "message": "Validation failed for request body\n- tasks.3.title: needs to be at most 120 characters long",
    "paragraphs": ["Validation failed for request body", "- tasks.3.title: needs to be at most 120 characters long"],
    "problems": [{ "key": "tasks.3.title", "code": "maxLength", "message": "needs to be at most 120 characters long" }],
    "traceId": "4bf92f3577b34da6a3ce929d0e0e4736"
}
```

| Field | What it is |
|---|---|
| `key` | The path to the value, with array items by their index. `body` for the body as a whole, the name of the parameter for a parameter |
| `code` | What kind of problem it is. One of the codes below, or the code of a [check](#answering-the-checks-of-an-entity) or a [custom rule](#writing-a-rule-of-your-own) |
| `message` | The problem, translated for the [locale of the request](./localization.md#resolving-the-locale-of-a-request) |

An XML answer has a `problem` element for each, and a websocket answer carries the same `problems` on
its error.

These are the codes the options of a property answer with:

| Code | The value |
|---|---|
| `required` | is missing, and the property is required |
| `type` | is of another type than the property holds |
| `format` | is not in the `format` of the property |
| `regex` | does not match the `regex` of the property |
| `enum` | is none of the `enum` of the property |
| `minLength`, `maxLength` | is shorter or longer than the property allows |
| `min`, `max` | is below or above what the property allows |
| `before`, `after` | is a date outside the bounds of the property |
| `maxSize`, `allowedMimeTypes` | is a file that is too large, or of another type |
| `unknownKey` | is under a key the model does not have |
| `relation` | holds a relation, which create and update data cannot |
| `noShapeFits`, `unknownShape` | fits none of the [shapes](./models.md#a-value-of-several-shapes) of the property, or names none of them |
| `check` | breaks a check of its entity that was declared as its filter alone |

## Making a property required by another one
`required` takes a function as well. It is given the object the property is on and the current
request:

```ts
// src/models/task.model.ts
import { Property } from 'zibri';

export class TaskCreateData {
    @Property.boolean()
    recurring!: boolean;

    @Property.date({ required: (task: TaskCreateData) => !task.recurring })
    dueAt?: Date;
}
```

## Bounding a date
`before` and `after` take a function that returns the date. It is asked each time a value is
validated, so a date in the future stays one:

```ts
// src/models/reminder.model.ts
import { Property } from 'zibri';

export class ReminderCreateData {
    @Property.date({ after: () => new Date() })
    remindAt!: Date;
}
```

It is given the object the date is on and the current request, so a date can be bounded by another
property. Returning nothing sets no bound:

```ts
// src/models/project.model.ts
import { Property } from 'zibri';

export class ProjectCreateData {
    @Property.date({ before: (project: ProjectCreateData) => project.endsAt })
    startsAt!: Date;

    @Property.date({ required: false })
    endsAt?: Date;
}
```

A bound is judged once a value of [several shapes](./models.md#a-value-of-several-shapes) is chosen
as a date, not while it is chosen.

## Answering the checks of an entity
The [checks of an entity](./data-source.md#rules-every-row-follows) are answered for a body of the
entity, and of every model derived from it with `OmitClass`, `PickClass`, `PartialClass` or
`IntersectionClass`. A check written out says what the problem is called:

```ts
// src/models/task.entity.ts
import { $t, BaseTenantEntity, Entity, OmitClass, Property, whereFor } from 'zibri';

@Entity({
    checks: [
        {
            // a done task has a completion date
            where: whereFor<Task>([{ status: { not: 'done' } }, { completedAt: { not: null } }]),
            code: 'completedAtRequired',
            message: $t`a done task has a completion date`
        },
        whereFor<Task>({ points: { greaterThanEquals: 0 } })
    ]
})
export class Task extends BaseTenantEntity() {
    @Property.string()
    status!: string;

    @Property.date({ required: false })
    completedAt?: Date | null;

    @Property.number()
    points!: number;
}

export class TaskImportData extends OmitClass(Task, ['id', 'tenantId']) {}
```

A body breaking it is answered under the key of the object, here `body`, with the code and message
of the check. A check written as its filter alone is answered with the code `check` and a message
naming the properties it compares.

A check is judged when the body holds every property it compares, `null` included. An update
leaving one out keeps the stored value, which only the data source knows, so the data source judges
it when it writes. A write it refuses is answered the same way, with the code and message of the
check under `body`, and with the name `CheckConstraintViolationError`. A model derived without a
property the check compares does not take the check.

## Writing a rule of your own
`@ValidateCustom` adds a rule to a model that its properties cannot say on their own. It is given the
object, once every property of it is valid, and the current request, and returns what is wrong:

```ts
// src/models/project-staffing.model.ts
import { $ts, CustomValidationProblem, Property, ValidateCustom } from 'zibri';

@ValidateCustom((staffing: ProjectStaffingData): CustomValidationProblem<ProjectStaffingData>[] => {
    if (staffing.memberIds.length <= staffing.maxMembers) {
        return [];
    }
    return [{ property: 'memberIds', code: 'tooManyMembers', message: $ts`has more members than maxMembers allows` }];
})
export class ProjectStaffingData {
    @Property.number({ format: 'integer', min: 1 })
    maxMembers!: number;

    @Property.array({ items: { type: 'string', format: 'uuid' } })
    memberIds!: string[];
}
```

A problem is answered under the key of the `property` it names, here `memberIds`, or under the key
of the object when it names none. The rule runs wherever the model is validated, an object inside a
body included. It applies to a class extending the model, and not to one derived with `PartialClass`,
`OmitClass`, `PickClass` or `IntersectionClass`. A rule returns its problems, not a promise of them,
and decorating a class other than the one it is written for is a compile error.

## Choosing where a rule goes

| Use | When |
|---|---|
| An option of the property | The rule is about the value alone, such as its length |
| A function for `required`, `before` or `after` | It depends on another property of the same object for this request alone, or on the request |
| A [check](./data-source.md#rules-every-row-follows) | Every stored row follows it, whoever writes the row, such as an end after a start |
| `@ValidateCustom` | Anything else about the values of one object |
| A [unique](./data-source.md#defining-entities) | No two rows may share a value, such as an email address. It is answered with `409` by the write |

## Replacing the validation
Provide your own `ValidationServiceInterface` under `ZIBRI_DI_TOKENS.VALIDATION_SERVICE`, see
[replacing a service](./configuration.md#replacing-a-service).

## See also
- [Models](./models.md) — the properties a model declares and their options
- [Creating endpoints](./creating-endpoints.md) — bodies and parameters of a route
- [Data sources](./data-source.md#rules-every-row-follows) — the checks every stored row follows
- [Error handling](./error-handling.md) — the body every refused request is answered with
- [Localization](./localization.md) — translating the messages of problems
