# Data sources
A data source connects your application to a database, such as Postgres or Valkey. You declare
your entities on it, and get a repository for each of them to read and write its rows. A data source
also runs your migrations and transactions, and an application can use several data sources side by
side.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `DataSource` | decorator | Registers a class as a data source |
| `DataSourceInterface` | interface | Contract a data source must implement |
| `PostgresDataSource` | class | Predefined data source for Postgres, extend from this instead of implementing `DataSourceInterface` directly |
| `PostgresOptions` | interface | Connection/config options for `PostgresDataSource` |
| `SchemaManagement` | type | Who makes the database match the entities of a SQL data source: `'synchronize'`, `'migrations'` or `'external'`. Required |
| `ValKeyDataSource` | class | Predefined data source for Valkey, extend from this instead of implementing `DataSourceInterface` directly |
| `ValKeyOptions` | interface | Connection/config options for `ValKeyDataSource` |
| `RepositoryDriverInterface` | interface | The storage specific part of a repository, implemented once per data source type |
| `BaseEntity` | class | Base class entities must extend, defines an id property |
| `BaseTenantEntity` | class | `BaseEntity` with the uuid `tenantId`, for an entity whose rows each belong to a tenant |
| `Entity` | decorator | Registers a class as an entity, and declares the `scope` restricting its rows |
| `whereFor` | function | Types a filter in `uniques`, `unique` or `checks` against the entity it is declared on |
| `scopeFor` | function | Types a `scope` against the entity it is declared on |
| `EntityScopeContext` | type | What a `scope` is told about the caller it decides for |
| `denyAll` | constant | Returned from a `scope` to give the caller no rows at all |
| `Property` | decorator | Maps a class property to a data source column, also used for validation |
| `BigNumber` | class | An exact decimal of any size, which a `@Property.number({ format: 'bignumber' })` holds |
| `NumberUtilities` | class | Arithmetic and comparison over every shape a number takes: `number`, `bigint`, `BigNumber` |
| `Newable` | type | Helper type for referencing a class (constructor) |
| `InjectRepository` | decorator | Injects a `Repository` for a given entity into a constructor parameter |
| `RepositoryFor` | decorator | Declares a class as the repository of an entity, in every data source that lists it in its `repositories` |
| `RepositoryClass` | type | A repository class, as a data source lists them in `repositories` |
| `Repository` | class | Generic repository exposing `findAll`, `findAllPaginated`, `findAllAfter`, `stream`, `findOne`, `findById`, `count`, `sum`, `average`, `minimum`, `maximum`, `exists`, `createAll`, `create`, `updateAll`, `updateById`, `upsert`, `upsertAll`, `deleteAll`, `deleteById` |
| `StreamOptions` | type | What `stream` accepts: a filter and relations, with no limit and no order |
| `KeysetPage` | type | A page `findAllAfter` reads: the items, how many rows match, and the cursor of the next page |
| `ChangeSetRepository` | class | Extended `Repository` that tracks who changed what, and when |
| `ChangeSetEntity` | class | Base class for an entity whose changes are recorded, which gets a `ChangeSetRepository` |
| `SoftDeleteRepository` | class | Extended `ChangeSetRepository` that adds soft delete functionality |
| `SoftDeleteEntity` | class | Base class for an entity that deletes softly, which gets a `SoftDeleteRepository` |
| `ChangeSet`, `Change` | entity | The recorded change sets |
| `Transaction` | class | Represents a started transaction (`commit`/`rollback`/`afterCommit`/`afterFinish`) |
| `IsolationLevel` | enum | The isolation level a transaction is started with |
| `Migration` | class | Base class to extend when defining a migration |
| `SemVerVersion` | type | Version type used for `Migration.version` |
| `ValueConversion` | enum | What `changePropertyOfEntity` does with a stored value its `convert` does not list |

## Defining a data source
A data source implements `DataSourceInterface`. Extend a predefined one such as `PostgresDataSource`
instead of implementing it yourself, and decorate it with `@DataSource`:

```ts
// src/data-sources/db/db.data-source.ts
import { BaseEntity, DataSource, Migration, Newable, OmitStrict, PostgresDataSource, PostgresOptions, RepositoryClass, SchemaManagement } from 'zibri';

import { Task } from '../../models/task.model';
import { TaskRepository } from '../../repositories/task.repository';
import { RenameTaskNameMigration } from './migrations/rename-task-name.migration';

@DataSource()
export class DbDataSource extends PostgresDataSource {
    options: OmitStrict<PostgresOptions, 'type' | 'entities'> = {
        host: 'localhost',
        port: 5432,
        username: 'postgres',
        password: 'password',
        database: 'db',
        ssl: true
    };

    entities: Newable<BaseEntity>[] = [
        // ...
        Task
    ];
    repositories: RepositoryClass[] = [TaskRepository];
    migrations: Newable<Migration>[] = [RenameTaskNameMigration];
    schemaManagement: SchemaManagement = 'synchronize';
}
```

`repositories` lists the repositories of your own, an empty list when there are none, see
[writing a repository of your own](#writing-a-repository-of-your-own).

`entities` holds your own entities and the ones the framework stores rows in. The page of each
feature lists those under Requirements, with when they are needed: [audit](./audit.md#requirements),
[cron](./cron.md#requirements), [email](./email.md#requirements), [events](./events.md#requirements),
[encryption and hashing](./encryption-and-hashing.md#requirements), [leases](./leases.md#requirements)
and [multithreading](./multithreading.md#requirements) need theirs in every application.

`pg` and `pg-query-stream` are optional peer dependencies. Install them alongside a Postgres data
source:

```bash
npm i pg pg-query-stream
```

`ssl` says whether the connection is encrypted. Every Postgres data source sets it:

| Value | What happens |
|---|---|
| `true` | The connection is encrypted, and the server's certificate is verified against the system's certificate authorities |
| an object | Node's TLS options, for your own `ca`, a client certificate or anything else the connection needs |
| `false` | The connection is unencrypted. For a database reachable only on the same machine or a network you trust, such as a Docker network |

The `PGSSLMODE` environment variable does not apply to the connection. The client tools a
[backup](./backup.md) runs read it. When it names no mode, they use `require` when `ssl` is set, and
`disable` when it is `false`.

`schemaManagement` says who makes the database match your entities. Every SQL data source sets it,
because no value is safe everywhere:

| Value | What happens | When it is right |
|---|---|---|
| `'synchronize'` | The database is altered to match your entity classes on every start | While the model is still moving and nothing stored matters yet |
| `'migrations'` | Only the data source's own migrations change the schema | Anywhere real data lives |
| `'external'` | No DDL is issued at all | The schema belongs to someone else: a DBA, another service or a separate migration tool |

> [!WARNING]
> `'synchronize'` issues the `ALTER` and `DROP` statements that make the database agree with the
> classes. Rename a property and the old column is dropped, with what it held. It also runs after
> migrations, so it can undo one. Move to `'migrations'` before anything stored is worth keeping.

`'migrations'` needs at least one migration. Use `'external'` for a schema that something else
creates. [Handling migrations](#handling-migrations) describes the migrations a data source lists.

`createAll`, `upsertAll`, `updateAll` and `deleteAll` take as many rows as you pass them. A call that
holds more values than one statement can is split into several statements inside one transaction, so
it lands whole or not at all. `maxBoundValuesPerStatement` in the options says how many values that
is, and defaults to what the database accepts.

List every data source you define in your application options. A data source you define without
always running it, such as one of several a shared module offers, or one a factory builds per call,
says so on the declaration:

```ts
// src/data-sources/reporting/reporting.data-source.ts
import { BaseEntity, DataSource, Newable, OmitStrict, PostgresDataSource, PostgresOptions, RepositoryClass, SchemaManagement } from 'zibri';

@DataSource({ allowOrphan: true })
class ReportingDataSource extends PostgresDataSource {
    options: OmitStrict<PostgresOptions, 'type' | 'entities'> = { host: 'reporting.internal', database: 'reporting', ssl: true };
    entities: Newable<BaseEntity>[] = [];
    repositories: RepositoryClass[] = [];
    schemaManagement: SchemaManagement = 'external';
}
```

## Using Valkey
`ValKeyDataSource` connects to Valkey. It is configured the same way and has the same repositories,
so everything below (filters, transactions, migrations, change sets, soft deletes) works with it as
well:

```ts
// src/data-sources/cache-db/cache-db.data-source.ts
import { BaseEntity, DataSource, Newable, RepositoryClass, ValKeyDataSource, ValKeyOptions } from 'zibri';

import { Session } from '../../models/session.model';

@DataSource()
export class CacheDbDataSource extends ValKeyDataSource {
    options: ValKeyOptions = {
        host: 'localhost',
        port: 6379,
        useTLS: true,
        keyPrefix: 'my-app'
    };

    entities: Newable<BaseEntity>[] = [
        // ...
        Session
    ];
    repositories: RepositoryClass[] = [];
}
```

`useTLS` says whether the connection is encrypted, and is set like `ssl`: `true` encrypts it and
verifies the server's certificate, `false` connects unencrypted.

> [!NOTE]
> `ValKeyDataSource` connects to a single Valkey server: a standalone one, or the primary endpoint of
> a primary with replicas. Every instance of your application connects to that same server. A server
> in cluster mode is refused when the application starts.

`@valkey/valkey-glide` is an optional peer dependency. Install it when you use this data source:

```bash
npm i @valkey/valkey-glide
```

### Sharing one server
`keyPrefix` separates data sources, or applications, that share one server. A backup of the data
source holds exactly what is stored under its prefix.

### Differences to a SQL data source
A Valkey data source answers every call the way a Postgres one does. Where they differ:

- A filter costs more. One that names no id, no unique and no index of the entity reads every row of
  the entity, and one on a relation reads the related rows first. Keep entities narrow. See
  [costs](./costs.md).
- A transaction applies all of its writes when it commits, or none of them. Reads inside it see its
  own writes. Two transactions writing the same row run one after the other, and two writing
  different rows do not wait for each other. A read outside the transaction sees the rows as they
  were until the commit.
- The isolation level of a transaction is ignored, and a warning says so.
- A migration changes the stored values only: `addPropertyToEntity` writes the default, or `null`,
  into every stored row, and `changePropertyOfEntity` moves each value to its new name and converts
  it to its new type.

## Defining entities

The data source above lists one entity, `Task`:

```ts
// src/models/task.model.ts
import { BaseTenantEntity, Entity, Property } from 'zibri';

@Entity()
export class Task extends BaseTenantEntity {
    @Property.string()
    title!: string;

    @Property.string()
    status!: string;
}
```

An entity to be included in a data source needs to extend `BaseEntity`, which defines an id property,
or `BaseTenantEntity`, which adds the [tenant](./tenancy.md) of each row in `tenantId`.

An entity is stored in the table its class is named after, `task` here, and `tableName` on `@Entity`
names another. Every entity of a data source needs a table of its own, and every entity of the
application a name of its own.

Every entity says which tenant its rows belong to: the property holding the tenant of each row, or
`'shared'` for rows every tenant shares. See [tenants](./tenancy.md).

Decorate every property the data source stores with `@Property`, as for any other [model](./models.md).

A single column that has to be unique says so on the property: `@Property.string({ unique: true })`. When a *combination* has to be unique, and neither column is unique on its own, declare it on the entity:

```ts
// src/models/number-invoices.model.ts
import { BaseTenantEntity, Entity, Property } from 'zibri';

@Entity({ uniques: [['year', 'recipientId']] })
export class NumberInvoices extends BaseTenantEntity {
    @Property.number()
    year!: number;

    @Property.string()
    recipientId!: string;

    @Property.number()
    number!: number;
}
```

The property names are checked against the entity, so a typo is a compile error. A unique declaration is also what [`upsert`](#changing-a-value-based-on-what-is-stored) identifies its row by.

On a tenant's entity, a unique holds within each tenant, see [uniques and indexes](./tenancy.md#uniques-and-indexes).

A write that would leave two rows carrying the same values is refused with a `UniqueConstraintViolationError`, on every data source. Its `properties` name what is already taken. In a response, it answers 409 Conflict.

A row holding no value for one of the properties takes nothing up, so any number of rows without a value are stored side by side. The properties can be optional.

> [!NOTE]
> A unique the stored rows already break cannot be created. When you add `uniques` to an entity that has data, the application refuses to start and names the values the rows share. Remove the duplicates in a migration of the same release: migrations run first, and the unique is created right after them, see [keeping indexes and uniques](#keeping-indexes-and-uniques).

### Unique among only some rows

A `where` narrows which rows a unique declaration covers, so the value stays free for every row the filter leaves out. Both places take it, and `whereFor` names the entity the filter is written against:

```ts
// src/models/account.model.ts
import { Entity, Property, SoftDeleteEntity, whereFor } from 'zibri';

@Entity({
    uniques: [{ properties: ['email', 'handle'], where: whereFor<Account>({ deleted: false }) }]
})
export class Account extends SoftDeleteEntity {
    @Property.string({ unique: { where: whereFor<Account>({ deleted: false }) } })
    inviteCode!: string;

    @Property.string({ format: 'uuid' })
    tenantId!: string;

    @Property.string()
    email!: string;

    @Property.string()
    handle!: string;
}
```

`whereFor` type-checks the filter against the entity you name: its columns and their value types. A filter written without it is not accepted.

The filter becomes part of the schema, so it compares properties against plain values only: a string, a number, a boolean or null, as they are, or with `not`, `oneOf`, `notOneOf` or a comparison of numbers. Anything else is refused while the schema is built.

On a `SoftDeleteEntity`, every unique says whether a soft deleted row still holds its value. A unique that does not say is refused where it is declared:

```
Account.email: "unique" on a soft delete entity has to say whether soft deleted rows still hold the value.
Add "where: whereFor<Account>({ deleted: false })" to it so a deleted row stops occupying the value,
or "where: {}" to keep the value taken for good.
```

| `where` | A soft deleted row |
|---|---|
| `whereFor<Account>({ deleted: false })` | Frees its value, so someone can sign up again with the same address. Restoring the row fails with a `UniqueConstraintViolationError` when another row took the value meanwhile |
| `{}` | Keeps its value taken for good |

A key covering only some rows is an `upsert` target like any other, and the rows it leaves out are not in its way. An `upsert` identified by an account's email and handle lands on the live row holding them, and inserts beside the deleted ones that still hold them.

Indexes are declared the same way: `@Property.string({ index: true })` for a single column, and on the
entity for a lookup that uses several:

```ts
// src/models/order.model.ts
import { BaseTenantEntity, Entity, Property } from 'zibri';

@Entity({ indexes: [['customerId', 'status']] })
export class Order extends BaseTenantEntity {
    @Property.string()
    customerId!: string;

    @Property.string()
    status!: string;

    @Property.date({ index: true })
    placedAt!: Date;
}
```

The order of a group is the order of the index, and an index answers a lookup by any leading part of
itself: `['customerId', 'status']` covers a lookup by `customerId`, where one by `status` alone reads
the table. A unique declaration comes with an index of its own, so a column that is unique needs no
second one. On a tenant's entity, every index starts with the tenant property, see
[uniques and indexes](./tenancy.md#uniques-and-indexes).

Each key is declared once. `primary`, `unique` and `index` beside each other on the same property are
refused while the class is being declared, as is a group that names a column which is already unique
on its own. That column matches at most one row wherever it sits in the group, so what follows it is
never read. One key written twice is refused as well: two unique groups over the same columns, or a group of one
column that already carries the `index` flag.

An index that is the leading part of another is refused the same way: `index` on `customerId` beside
the group `['customerId', 'status']`, or a group that begins a unique group in its order. The longer one
already answers every lookup the shorter one does.

### Rules every row follows

`checks` on the entity are rules every row has to follow, each a filter every row has to match. A
check is written out with the `code` and `message` a request breaking it is answered with, or as the
filter alone:

```ts
// src/models/project.model.ts
import { $t, BaseTenantEntity, Entity, Property, whereFor } from 'zibri';

@Entity({
    checks: [
        {
            // a project is not done, or has a completion date
            where: whereFor<Project>([{ status: { not: 'done' } }, { completedAt: { not: null } }]),
            code: 'completedAtRequired',
            message: $t`a done project has a completion date`
        },
        whereFor<Project>({ budget: { greaterThanEquals: 0 } })
    ]
})
export class Project extends BaseTenantEntity {
    @Property.string()
    status!: string;

    @Property.date({ required: false })
    completedAt?: Date | null;

    @Property.number()
    budget!: number;
}
```

A create, update or upsert leaving a row that breaks a check is refused with a
`CheckConstraintViolationError`, which answers 400 and names the properties the check compares. Nothing
of the write is stored. A request body of the entity, or of a model derived from it, is answered
before the handler runs, see [answering the checks of an entity](./validation.md#answering-the-checks-of-an-entity).

A check compares the same way a `where` on a unique does. A row holding null matches `not` and
`notOneOf` unless they name null, and never matches a comparison, so `{ budget: { greaterThanEquals: 0 } }`
also says the budget is there.

### Keeping indexes and uniques

Your data source keeps the indexes and uniques your entities declare. Every time the application
starts, once the [migrations](#handling-migrations) have run, it creates each declared one it does not
have yet, over the rows already stored, and removes each one that no entity declares. Declaring an
index or a unique, changing which rows it covers, or deleting it is all a release has to do.

- Creating one does not block writes to the entity, so instances still serving the previous version
  keep working while it is built.
- A unique the stored rows already break stops the start, naming the values they share. Remove the
  duplicates in a migration, which runs before the unique is created.
- Checks are kept the same way. A check a stored row breaks stops the start, naming the row.
- An index you create yourself on an entity's table is left alone, whatever you name it. Every index
  the data source removes is logged at `info`.
- Once a release has changed the indexes and uniques, an older release refuses to start, the same way
  it refuses a database migrated past it, see [going back](#going-back).
- A transaction that commits while a newer release next to it changes the indexes and uniques of an
  entity it wrote fails with `KeyDeclarationsChangedError`. Nothing it wrote is applied, so run it
  again.

With `schemaManagement: 'synchronize'`, synchronizing keeps them instead. With `'external'`, whoever
owns the schema does.

### What a property holds

The kinds a property can be, the number formats and what object and array properties hold are the
same for entities as for any other model, see [models](./models.md). A value is read back from the
data source as the type its property declares.

Filters are the one place a number can be written as something other than what the property holds.
A bound on a `bignumber` can be a plain number or a `bigint`, so `{ total: { greaterThanEquals: 0 } }`
needs no `BigNumber` around the zero. A plain number property takes plain number bounds.

A declaration can change after rows were written, and those rows keep the value they were written
with. Such a value is read back as it is stored. A filter that compares a number, date or boolean
property holding one, by the value itself, `not`, `oneOf`, `notOneOf` or an ordering, raises a
`StoredValueTypeMismatchError` naming the property, the type it declares and the value found in its
place. `null` and `{ not: null }` do not compare the value, so they answer for that row as for any
other.

## Accessing the data source
You read and write the rows of an entity through its repository. Inject it; you do not define it:

```ts
// src/services/task.service.ts
import { InjectRepository, Repository } from 'zibri';

import { TaskCreateData, TaskUpdateData } from '../models';
import { Task } from '../models/task.model';

export class TaskService {
    constructor(
        @InjectRepository(Task)
        private readonly taskRepository: Repository<Task, TaskCreateData, TaskUpdateData>,
    ) {}
}
```

The create and update data types are optional. Without them, a create or an update takes any part of
a `Task`.

Outside a constructor, such as in a helper function, a cron job or a migration, `repositoryTokenFor` resolves the same repository:

```ts
// src/services/task.functions.ts
import { inject, Repository, repositoryTokenFor } from 'zibri';

import { TaskCreateData, TaskUpdateData } from '../models';
import { Task } from '../models/task.model';

const taskRepository: Repository<Task, TaskCreateData, TaskUpdateData> = inject(repositoryTokenFor(Task));
```

The examples below are written against that name.

A repository always exposes the methods:
- findAll
- findAllPaginated
- findAllAfter
- stream
- findOne
- findById
- count
- sum
- average
- minimum
- maximum
- exists
- createAll
- create
- updateAll
- updateById
- upsert
- upsertAll
- deleteAll
- deleteById

The full, detailed definition can be found under the [repository typedoc](./generated/classes/data-source_repository.Repository.html).

`findOne` and `findById` throw a `NotFoundError` when nothing matches. When a missing row is an
answer, such as when you check whether a name is taken, pass `required: false` and get `undefined`
instead:

```ts
// src/services/task.functions.ts
import { Task } from '../models/task.model';

async function findExisting(): Promise<Task | undefined> {
    return await taskRepository.findOne({ where: { title: 'Write the release notes' }, required: false });
}
```

The return type follows the flag.

A `findAll` that names no limit throws when more than ten thousand rows match. Name the limit you
want:

```ts
// src/services/task.functions.ts
async function readSome(): Promise<void> {
    await taskRepository.findAll({ take: 100 });       // at most this many
    await taskRepository.findAllPaginated(1, 100);     // a page at a time
    await taskRepository.findAll({ take: 'all' });     // every row that matches
}
```

A page, a limit and a `take` are whole numbers of at least 1, and a `skip` is one of at least 0. Any
other value throws before the data source is asked.

`create` and `createAll` give every row its id. With `allowId` a row is created with the id you give
it, and an id a stored row holds already, deleted or not, is refused with a
`UniqueConstraintViolationError`.

A page comes with the total that belongs to it. `findAllPaginated` reads the rows and counts them as
of one moment, so `items` and `totalAmount` describe the same table. Both narrow by the same
[scopes](#restricting-which-rows-a-caller-may-see): "20 of 137" is 137 rows this caller may see.

Every read that returns part of a result is ordered down to the single row: the primary key comes
after whatever order you ask for, so a position on a page always holds the same row. Set the order
with `defaultOrder` on the entity, or `order` on the call. An order can also reach through a
relation, see [Reading relations](#reading-relations).

Each page is its own read. A row written before the walk reaches its position moves every page after
it. `findAllAfter` reads by cursor instead, and continues from the row the last page ended at:

```ts
// src/services/task.functions.ts
import { KeysetPage } from 'zibri';

import { Task } from '../models/task.model';

async function remindEveryone(): Promise<void> {
    let cursor: string | undefined = undefined;
    do {
        const page: KeysetPage<Task> = await taskRepository.findAllAfter(cursor, 100, { where: { status: 'new' } });
        for (const task of page.items) {
            await taskRepository.updateById(task.id, { status: 'reminded' });
        }
        cursor = page.nextCursor;
    }
    while (cursor != undefined);
}
```

Every row that exists when the walk starts is returned exactly once, however much is written while
it runs. A row written during the walk is reached when it sorts after the cursor, and passed over
when it sorts before it. Order by properties that do not change: a row whose ordering property is
edited mid-walk can move across the cursor, and is then read twice or not at all.

`totalAmount` counts what the filter matches, so a walk reports the same total on every page.
`nextCursor` is absent on the last page. The cursor is opaque and belongs to the read that produced
it, with its order and its filter. Hand it back as it came, and use one filter per walk. It is safe in
a URL or a JSON response, and `@Response.keysetPage()` documents an endpoint that hands one out.

`findAllAfter` refuses an order that does not give every row a position: one on a property that can
hold null, or on a value that has no order. The primary key is appended for you.

| Use | When |
|---|---|
| `findAllPaginated` | A numbered page someone clicks |
| `findAllAfter` | A walk that spans requests |
| `stream` | A job that reads everything in one go, holding only part of it at a time |

`take: 'all'` returns every row at once. `stream` reads them without holding them all:

```ts
// src/services/task.functions.ts
async function archiveEveryone(): Promise<void> {
    for await (const task of taskRepository.stream({ where: { status: 'new' } })) {
        await taskRepository.updateById(task.id, { status: 'archived' });
    }
}
```

Only a bounded part of the result is in memory at any moment, and `break` stops the reading. A
stream is narrowed by the same [scopes](#restricting-which-rows-a-caller-may-see) every other read
is, and each row is decrypted the same way, so it returns what `findAll` would.

A stream takes no `take`, no `skip` and no order. Order what you keep, or use `findAll` with an order
and a limit.

`count` and `exists` answer how many rows match, and whether any do, without reading them:

```ts
// src/services/task.functions.ts
async function howMuchIsLeft(): Promise<void> {
    const open: number = await taskRepository.count({ where: { status: 'new' } });
    const anyLeft: boolean = await taskRepository.exists({ where: { status: 'new' } });
}
```

Both narrow by the same scopes a read does, so a count reports the rows the caller may see. `count`
has no upper bound. `exists` loads no relation and decrypts nothing.

### Adding up what rows hold

`sum`, `average`, `minimum` and `maximum` take a value over the rows a filter matches, without reading
them:

```ts
// src/models/sale.model.ts
import { BaseTenantEntity, Entity, inject, Property, Repository, repositoryTokenFor } from 'zibri';

@Entity()
export class Sale extends BaseTenantEntity {
    @Property.string()
    region!: string;

    @Property.number({ format: 'integer' })
    quantity!: number;

    @Property.date()
    soldAt!: Date;
}

// src/services/sale.service.ts
const saleRepository: Repository<Sale> = inject(repositoryTokenFor(Sale));

async function report(): Promise<void> {
    const sold: number = await saleRepository.sum('quantity', { where: { region: 'north' } });
    const latest: Date | undefined = await saleRepository.maximum('soldAt');
    const perRegion: { region: string, sum: number }[] = await saleRepository.sum('quantity', { groupBy: ['region'] });
    const salesPerRegion: { region: string, count: number }[] = await saleRepository.count({ groupBy: ['region'] });
}
```

- `sum` and `average` take a number property; `minimum` and `maximum` a number or a date property.
- A row that holds no value for the property is left out. A sum of no rows is 0; the others answer `undefined`.
- `groupBy` answers one row per group instead, holding the values the group shares and the value under the name of the method, in no order. A group is formed by properties holding a single plain value, not by an encrypted property.
- `count` takes `groupBy` as well.
- Every one of them is narrowed by the same scopes a read is.


`updateAll` and `deleteAll` answer with how many entities they changed. The entities themselves are
handed back only when they are asked for:

```ts
// src/services/task.functions.ts
import { Task } from '../models/task.model';

async function archive(): Promise<void> {
    const archived: number = await taskRepository.updateAll({ status: 'new' }, { status: 'archived' });
    const rows: Task[] = await taskRepository.updateAll({ status: 'new' }, { status: 'archived' }, { returnUpdated: true });
    const removed: number = await taskRepository.deleteAll({ status: 'archived' });
}
```

The return type follows the flag, as it follows `required` on `findOne`. With `returnUpdated`, the
bound of `findAll` applies: when more than ten thousand rows match, the call is refused before
anything is written. Without it, the call has no limit.

### Reading only some properties

`select` names the properties a read hands back. Every read takes it: `findAll`, `findOne`, `findById`,
`findAllPaginated`, `findAllAfter` and `stream`. Name them in a list, or as an object that also reaches
into what a property holds:

```ts
// src/services/task.functions.ts
async function listTitles(): Promise<{ id: string, title: string }[]> {
    return await taskRepository.findAll({ select: ['title'], take: 'all' });
}
```

The return type is narrowed to what you named, so a property you left out is a type error. Every
entity keeps its `id`, the related ones included.

The object form reaches into an object property, into the items of an array of objects, and into a
relation the read includes, such as `{ name: true, orders: { total: true } }` with `relations: ['orders']`.
With the `Customer` of [Updating part of an object](#updating-part-of-an-object) below:

```ts
// src/services/customer.service.ts
async function listStreets(): Promise<{ id: string, address: { street: string } }[]> {
    return await customerRepository.findAll({ select: { address: { street: true } }, take: 100 });
}
```

`relations` decides which relations a read includes, the entity's `defaultRelations` among them, and
`select` narrows what they hold. A relation the read includes and the selection leaves out is not
handed back. A selection naming a relation the read does not include, a property the entity does not
declare, or the inside of a value that has no properties is refused before anything is read.

A property whose `exclude` or `encryption` is decided by a function is decided on the whole row. When
you select one, its rows are read whole, the result is still narrowed to what you selected, and a
warning says the selection saves no reading there.

### Updating part of an object

An update changes the properties it names and keeps the others, and an object property works the
same way: the object you pass is merged into the stored one, as deep as the objects go.

```ts
// src/models/customer.model.ts
import { BaseTenantEntity, Entity, Property } from 'zibri';

export class Address {
    @Property.string()
    street!: string;

    @Property.string()
    number!: string;

    @Property.string({ required: false })
    note?: string | null;
}

@Entity()
export class Customer extends BaseTenantEntity {
    @Property.object({ cls: () => Address })
    address!: Address;
}
```

```ts
// src/services/customer.service.ts
import { inject, Repository, repositoryTokenFor } from 'zibri';

import { Customer } from '../models/customer.model';

const customerRepository: Repository<Customer> = inject(repositoryTokenFor(Customer));

async function moveNextDoor(id: string): Promise<Customer> {
    // the street and the note stay as they are
    return await customerRepository.updateById(id, { address: { number: '42' } });
}
```

An array is a list, and is replaced whole, as is a value of several shapes. `null` is stored as `null`,
for the whole object or for one property of it. An object passed where the row holds none is stored
as you pass it.

### What a write hands back

Every write answers with the rows as they now stand: every column of them, not only the ones you
wrote, the same as finding them would give.

The data you pass stays as you passed it, the objects and arrays it holds included: values are
encrypted, hashed and given their defaults in the write's own copy, so you can write the same data
again.

Relations are the part you decide. Name them on the options the same way [a read names
them](#reading-relations), and the entity's `defaultRelations` are used when you name none:

```ts
// src/models/team.model.ts
import { BaseTenantEntity, Entity, Property } from 'zibri';

import { Seat } from './seat.model';

@Entity()
export class Team extends BaseTenantEntity {
    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => Seat, inverseSide: 'team' })
    seats!: Seat[];
}
```

```ts
// src/models/seat.model.ts
import { BaseTenantEntity, Entity, Property } from 'zibri';

import { Team } from './team.model';

@Entity()
export class Seat extends BaseTenantEntity {
    @Property.string()
    occupant!: string;

    @Property.manyToOne({ target: () => Team, joinColumn: 'teamId', inverseSide: 'seats', required: false })
    team?: Team;

    @Property.string({ format: 'uuid', required: false })
    teamId?: string;
}
```

```ts
// src/services/seat.service.ts
import { inject, Repository, repositoryTokenFor } from 'zibri';

import { Seat } from '../models/seat.model';

const seatRepository: Repository<Seat> = inject(repositoryTokenFor(Seat));

async function moveSeat(seatId: string, teamId: string): Promise<Seat> {
    return await seatRepository.updateById(seatId, { teamId }, { relations: { team: true } });
}
```

Resolving the relations is a read of its own, after the write. A write with no relations to resolve
makes no such read.

`createAll`, `updateAll` and `deleteAll` take the same option and answer the same way. Their read
covers the whole batch, so asking a bulk write for its rows costs one read however many rows come
back.

### Reading relations

Every read takes the same option, and a relation of a relation is asked for by naming it in turn:

```ts
// src/services/seat.service.ts
async function readSeats(): Promise<void> {
    await seatRepository.findAll({ take: 100, relations: ['team'] });
    await seatRepository.findAll({ take: 100, relations: { team: true } });
    await seatRepository.findAll({ take: 100, relations: { team: { seats: true } } });
}
```

It goes as deep as the relations go, and what a tree asks for is what it costs, see
[Costs](./costs.md). A relation nobody named comes back unset, which is not the same as empty.
`defaultRelations` on the entity says what every read of it resolves. `relations` on the call
replaces it, and `relations: []` reads the row on its own. A relation
holds the rows of the related entity the caller may see, see
[restricting which rows a caller may see](#restricting-which-rows-a-caller-may-see), and never a soft
deleted one, see [soft deleting rows](#soft-deleting-rows).

An order reaches through a relation the same way:

```ts
// src/services/seat.service.ts
async function readSeatsByTeam(): Promise<void> {
    await seatRepository.findAll({ take: 100, order: { team: { name: 'ASC' } } });
    await seatRepository.findAll({ take: 100, order: { team: { name: 'ASC' }, occupant: 'ASC' } });
}
```

An order reaches through a relation that holds one row: "the team's name" names one value, and "the
seats' occupants" names none in particular.

Ordering or filtering by a relation reads it. The rows you get back hold only the relations their
own `relations` asked for, however they were found and sorted.

### Saving and deleting the rows of a relation

A `oneToMany` or `hasOne` value you give a write is saved along with the row, in the same
transaction:

```ts
// src/services/team.service.ts
import { inject, Repository, repositoryTokenFor } from 'zibri';

import { Team } from '../models/team.model';

const teamRepository: Repository<Team> = inject(repositoryTokenFor(Team));

async function createTeam(tenantId: string): Promise<Team> {
    return await teamRepository.create({ tenantId, name: 'Blue', seats: [{ tenantId, occupant: 'Ada' }] });
}

async function replaceSeats(teamId: string, keptSeatId: string, tenantId: string): Promise<Team> {
    return await teamRepository.updateById(teamId, { seats: [{ id: keptSeatId }, { tenantId, occupant: 'Grace' }] });
}
```

The value is the whole relation:

| What you give | What happens |
|---|---|
| A row without an `id` | It is created, pointing at the row you write |
| A row with an `id` | It is linked to the row you write, and its other values are written when the relation's `cascade` includes `'update'`. With `allowId`, a row with an `id` that no row has yet is created with it |
| No row that is there already | It is deleted when its foreign key is required, and its foreign key is set to `null` otherwise |
| An empty list, or `null` | Every row there already is left out |
| Nothing | The rows stay as they are |

All of this happens when the relation's `cascade` includes `'insert'`, which it does by default.
`updateAll` gives the value to every row it matches, and each gets its own copy of the rows without an
`id`. A row with an `id` belongs to one row only, so `updateAll` refuses one when it matches more.

The rows are written through the repository of their own entity, so its scope, hooks and change sets
apply to them as they do to a write of your own. A row with an `id` that you may not see is not
found, and the whole write is refused. A row that is left out and whose entity soft deletes is soft
deleted.

When the relation's `cascade` includes `'remove'`, which it does by default, deleting a row deletes
the rows of the relation the same way, and theirs in turn, however the scope of their entity
restricts:

| How the row is deleted | What happens to the rows of its relation |
|---|---|
| Hard deleted | They are hard deleted, also when their entity soft deletes |
| Soft deleted | They are soft deleted |
| Restored | The rows its soft delete took along are restored, and not the ones deleted on their own before |

An entity that soft deletes can only remove rows of entities that soft delete as well.

When the relation's `cascade` leaves out `'remove'`, hard deleting a row that rows of the relation
still point at, soft deleted ones included, throws a `ConflictError` and deletes nothing. Unlink or
delete those rows first. Rows deleted in the same call may point at each other.

### Two people editing the same thing

By default the last write wins. When two people may edit a property at once, declare
`optimisticLocking` on it. An update that writes it then names the value the edit was based on:

```ts
// src/models/company.model.ts
import { BaseTenantEntity, Entity, Property } from 'zibri';

@Entity()
export class Company extends BaseTenantEntity {
    @Property.string({ optimisticLocking: true })
    name!: string;
}
```

```ts
// src/services/company.service.ts
import { inject, Repository, repositoryTokenFor } from 'zibri';

import { Company } from '../models/company.model';

const companyRepository: Repository<Company> = inject(repositoryTokenFor(Company));

async function rename(id: string, name: string, seen: string): Promise<void> {
    await companyRepository.updateById(id, { name }, { where: { name: seen } });
}
```

The condition is checked as part of the write. The update lands only when the property still holds
the value the edit was based on.

When it does not, the answer depends on what the caller may see:

- A caller who may read the row gets a `ConflictError`, so the client can read it again and show
  both versions.
- A caller who may not see the row gets a `NotFoundError`, the same as for an id that does not
  exist.

Which one is decided by reading the row again through its
[scope](#restricting-which-rows-a-caller-may-see), so a scoped entity reveals none of its ids.

The lock is per property: one person editing `name` and another editing `phone` do not collide. A
condition can also name a property the write only reads, such as `{ where: { price: seenPrice } }`
beside a write to `discount`.

Only the caller knows the value the edit was based on, so a write to a locked property without a
condition on it is refused. Name the property with no value to overwrite it regardless:

```ts
// src/services/company.service.ts
async function renameRegardless(id: string, name: string): Promise<void> {
    await companyRepository.updateById(id, { name }, { where: { name: undefined } });
}
```

Naming the property is what counts, so a filter you built that came out empty is still refused.

An [`upsert`](#changing-a-value-based-on-what-is-stored) whose `onConflict` sets a locked
property says what it read the same way, with `where` in its options. In `upsertAll` each row brings
its own `where`:

```ts
// src/models/workspace.model.ts
import { BaseTenantEntity, Entity, inject, Property, Repository, repositoryTokenFor } from 'zibri';

@Entity({ uniques: [['slug']] })
export class Workspace extends BaseTenantEntity {
    @Property.string()
    slug!: string;

    @Property.string({ optimisticLocking: true })
    name!: string;
}

// src/services/workspace.service.ts
const workspaceRepository: Repository<Workspace> = inject(repositoryTokenFor(Workspace));

async function nameWorkspace(tenantId: string, slug: string, name: string, seen: string): Promise<void> {
    await workspaceRepository.upsert(
        { slug },
        { tenantId, slug, name },
        { name: { set: name } },
        { where: { name: seen } }
    );
}
```

The condition applies to the row that already holds the identity. When that row does not match
it, nothing is written and the call fails with a `ConflictError`. A row you may not see is answered as
inserting its identity would be. An `increment` adds to whatever is stored, so it needs no condition.

A filter asking for a value a property cannot hold matches no rows. A property declares its format,
and a value outside that format names nothing. Every method answers it the way it answers any other
filter that matches nothing:

```ts
// src/services/task.functions.ts
async function lookUpAMistypedId(): Promise<void> {
    await taskRepository.findAll({ where: { id: 'not-an-id' } });     // []
    await taskRepository.findById('not-an-id', { required: false });  // undefined
    await taskRepository.findById('not-an-id');                       // NotFoundError
}
```

A mistyped path or query parameter is a missing row, so you can pass one straight to the repository.
Name the format on the parameter as well, `@Param.path('id', { type: 'string', format: 'uuid' })`,
to refuse the request as invalid input before the handler runs. That tells the caller more than an
empty result does.

Listing several values keeps the ones that are possible, so `{ oneOf: ['not-an-id', realId] }`
finds `realId`. The same holds for a filter reaching through a relation, such as
`{ team: { where: { id: 'not-an-id' } } }`.

A number with a fraction is such a value for a property of the `integer` format: `{ count: 1.5 }`
finds no row. A bound with a fraction on it asks what the bound on the whole number next to it asks,
so `{ count: { greaterThan: 0.5 } }` finds the rows `{ count: { greaterThan: 0 } }` finds.

Excluding a value a property cannot hold, with `not` or `notOneOf`, fails with a `BadRequestError`,
which a request is answered `400` with.

## Writing a repository of your own
A repository with methods of its own extends the one the data source builds for the entity. Declare it with `@RepositoryFor`, and list it in the `repositories` of the data source, as in [defining a data source](#defining-a-data-source):

```ts
// src/repositories/task.repository.ts
import { Repository, RepositoryFor } from 'zibri';

import { Task } from '../models/task.model';

@RepositoryFor(Task)
export class TaskRepository extends Repository<Task> {
    async findNew(): Promise<Task[]> {
        return await this.findAll({ where: { status: 'new' } });
    }
}
```

`@InjectRepository(Task)`, `repositoryTokenFor(Task)` and `inject(TaskRepository)` then hand out the one instance of it, and the framework reads and writes tasks through it too. It reads and writes the way the one it is built on does: through the same data source, with the same hooks, narrowed by the same scopes.

The repository is built over the one the data source builds, so it declares no constructor. It reaches anything else it needs through `inject`, the way [dependency injection](./di.md) describes.

An entity that records change sets or soft deletes is built as a `ChangeSetRepository` or a `SoftDeleteRepository`, and a repository of your own on it extends that class.

The repositories of the users, the memberships and the roles extend the bases the framework ships, see [creating and registering user models](./auth.md#creating-and-registering-user-models), [members and their roles](./tenancy.md#members-and-their-roles) and [roles](./roles-and-permissions.md#roles).

## Using one entity in multiple data sources
An entity belongs to one data source, so `@InjectRepository(Task)` names none. To keep the same entity
in several, such as a Valkey data source mirroring entities a Postgres one owns, declare it on the
entity:

```ts
// src/models/session.model.ts
import { BaseEntity, Entity, Property } from 'zibri';

@Entity({ tenant: 'shared', allowDuplicate: true })
export class Session extends BaseEntity {
    @Property.string()
    token!: string;
}
```

The repository of a duplicated entity is resolved by the entity and its data source:

```ts
// src/services/session.service.ts
import { InjectRepository, Repository } from 'zibri';

import { CacheDbDataSource } from '../data-sources/cache-db/cache-db.data-source';
import { DbDataSource } from '../data-sources/db/db.data-source';
import { Session } from '../models/session.model';

export class SessionService {
    constructor(
        @InjectRepository(Session, DbDataSource)
        private readonly sessions: Repository<Session>,
        @InjectRepository(Session, CacheDbDataSource)
        private readonly cachedSessions: Repository<Session>
    ) {}
}
```

`repositoryTokenFor(Session, DbDataSource)` names the data source the same way when you resolve
repositories dynamically.

`MigrationEntity` is a built-in example: every data source keeps track of its own migrations, so it
is marked `allowDuplicate`, and each data source resolves its own migration repository.

## Filtering data
Every read takes a `where` filter:

```ts
// src/services/task.functions.ts
async function findByTitle(): Promise<void> {
    // returns all tasks whose title is exactly '42'
    await taskRepository.findAll({ where: { title: '42' } });
    // returns all tasks whose title ends with '42'
    await taskRepository.findAll({ where: { title: { iLike: '%42' } } });
    // returns all tasks whose title ends with '42' AND is not '42'
    await taskRepository.findAll({ where: { title: { iLike: '%42', not: '42' } } });
    // returns all tasks whose title either:
    // - ends with '42' AND is not '42'
    // - OR is '43'
    await taskRepository.findAll({ where: { title: [{ iLike: '%42', not: '42' }, '43'] } });
    // returns all tasks whose title starts with 'rent' AND ends with '2026'
    await taskRepository.findAll({ where: { title: { like: ['rent%', '%2026'] } } });
    // returns all tasks whose title neither starts with 'rent' nor ends with '2026'
    await taskRepository.findAll({ where: { title: { notLike: ['rent%', '%2026'] } } });
}
```

`like`, `iLike`, `notLike`, `notILike` and `fuzzyLike` take one value or several, and several means
every one of them has to hold. Every other operator says what
it means once: a list under `oneOf` is a list of values the property may be.

In a pattern, `%` stands for any text and `_` for any one character. A backslash makes the character
after it literal: `{ like: '50\\%%' }` finds the values starting with `50%`.

A property holding no value counts as holding `null`. So `{ not: 'a' }` and `{ notOneOf: ['a'] }`
find it, because no value is not `'a'`, `{ notLike: 'a%' }` finds it, because no value is like
nothing, and `{ oneOf: ['a'] }` does not. Name `null` to say otherwise:
`{ oneOf: ['a', null] }` finds it as well, and `{ not: null }` or `{ notOneOf: ['a', null] }` leave it
out. A list under `oneOf` or `notOneOf` can be as long as you need.

Text is ordered by the application's default locale, so `after` and `before` sort alphabetically,
and a filter agrees with an `order` over the same property. [Localization](./localization.md)
describes that order and what an application supporting several languages sets for it.

An id is always a UUID that is generated for you. To name rows by something you choose, such as a
slug, a key or an id from another system, give it its own property and declare it `unique`. Looking a
row up by a unique property costs what looking it up by id costs.

A UUID is stored in lower case, whichever case it was written in, and a filter finds it in either
case. That holds for the id, for every property declared `format: 'uuid'`, and for the ids of related
rows.

Everything a filter carries is data, never part of the query. A search term forwarded from a request,
an id taken out of a URL, the name of a field inside a JSON object: each is handed to the data source
as a value, so none of them can change what the query asks for. Build filters out of request data
without escaping anything yourself.

### Searching for something similar

`fuzzyLike` finds the values that resemble what you searched for. `minSimilarity` is a percentage
between 1 and 99, and defaults to 30. 1 matches nearly everything, and 99 is close to an exact match:

```ts
// src/models/contact.model.ts
import { BaseTenantEntity, Entity, Property } from 'zibri';

@Entity()
export class Contact extends BaseTenantEntity {
    @Property.string()
    name!: string;

    @Property.string({ fuzzySearchable: false })
    notes!: string;
}
```

```ts
// src/services/contact.service.ts
import { inject, Repository, repositoryTokenFor } from 'zibri';

import { Contact } from '../models/contact.model';

const contactRepository: Repository<Contact> = inject(repositoryTokenFor(Contact));

async function findByName(): Promise<void> {
    // returns the contacts whose name resembles 'Miller Holding'
    await contactRepository.findAll({ where: { name: { fuzzyLike: { value: 'Miller Holding' } } } });
    // and the ones that resemble it closely
    await contactRepository.findAll({ where: { name: { fuzzyLike: { value: 'Miller Holding', minSimilarity: 70 } } } });
}
```

Every string property can be searched this way, and each one is kept ready for it, so a search at the
default similarity or above costs what a lookup costs. A `minSimilarity` under the default asks for
more rows than a lookup narrows to, so it reads every row instead, and the data source says so once
per property that happens to. A data source that mostly answers looser searches than that declares
`searchesFromSimilarity`, and then that is the figure the two cases divide at. Searching a string
inside an object property reads every row either way.

With `fuzzySearchable: false`, nothing is kept for the property, and a `fuzzyLike` naming it is
refused. Declare it on a column that is written far more often than it is searched.

A search is also refused where a similarity says nothing about the values: a property holding a
UUID, one of an enum, a hashed value or an encrypted one. Search those with `is` or `oneOf`.

`{ similarTo }` in place of a direction orders by the same measure, the most similar values first and
a property holding nothing last:

```ts
// src/services/contact.service.ts
async function findByNameClosestFirst(): Promise<void> {
    // the contacts whose name resembles 'Miller Holding', the closest one first
    await contactRepository.findAll({
        where: { name: { fuzzyLike: { value: 'Miller Holding' } } },
        order: { name: { similarTo: 'Miller Holding' } }
    });
}
```

It orders with or without a `fuzzyLike` beside it, takes part in an order of several keys like a
direction does, reaches through a relation, and pages with `findAllPaginated` and `findAllAfter`. It
is refused on the same properties a search is, apart from `fuzzySearchable: false`, which orders by
similarity as well.

A similarity counts letters of every alphabet, so "Müller" and "Möller" are two different words. On
Postgres, create the database with a UTF-8 character type, as the official images do. With `C`, only
ASCII counts as a letter, and the data source says so when it starts.

### Filtering inside an object property

`where` reaches into an object property, and the properties inside it take the same operators as the
ones on the entity itself:

```ts
// src/models/product.model.ts
import { BaseTenantEntity, Entity, inject, Property, Repository, repositoryTokenFor } from 'zibri';

class ProductMetadata {
    @Property.string({ required: false })
    color: string | undefined | null;
}

@Entity()
export class Product extends BaseTenantEntity {
    @Property.object({ cls: () => ProductMetadata, required: false })
    metadata: ProductMetadata | undefined | null;
}

// src/services/product.service.ts
const productRepository: Repository<Product> = inject(repositoryTokenFor(Product));

async function findByColor(): Promise<void> {
    // returns all products whose metadata says the color is red
    await productRepository.findAll({ where: { metadata: { where: { color: 'red' } } } });
    // returns all products whose metadata names no color
    await productRepository.findAll({ where: { metadata: { where: { color: null } } } });
}
```

`null` there finds a property written as null and one that was never written: a value left
undefined is absent once it is stored. `{ not: null }` finds exactly the rows `null` leaves out, so
the two together cover every row that has the object. A row whose object property is empty is in
neither of them.

### Filtering an array

`includes` asks for an array holding every value it lists. `isIncludedIn` asks for an array holding at
least one item, each of them one it lists. `where` asks for an array holding at least one item that
matches it, with the operators of the type the items have, and several conditions match an item
that matches any of them:

```ts
// src/models/story.model.ts
import { BaseTenantEntity, Entity, inject, Property, Repository, repositoryTokenFor } from 'zibri';

@Entity()
export class Story extends BaseTenantEntity {
    @Property.array({ items: { type: 'string' }, required: false })
    tags: string[] | undefined | null;
}

// src/services/story.service.ts
const storyRepository: Repository<Story> = inject(repositoryTokenFor(Story));

async function findByTags(): Promise<void> {
    // returns the stories tagged both 'news' and 'sport'
    await storyRepository.findAll({ where: { tags: { includes: ['news', 'sport'] } } });
    // returns the stories that have tags, all of them either 'news' or 'sport'
    await storyRepository.findAll({ where: { tags: { isIncludedIn: ['news', 'sport'] } } });
    // returns the stories tagged 'news' or 'sport', and maybe more
    await storyRepository.findAll({ where: [{ tags: { includes: ['news'] } }, { tags: { includes: ['sport'] } }] });
    // returns the stories holding a tag that is neither 'news' nor 'sport'
    await storyRepository.findAll({ where: { tags: { where: { notOneOf: ['news', 'sport'] } } } });
    // returns the stories holding a tag that starts with 'local' or is 'weather'
    await storyRepository.findAll({ where: { tags: { where: [{ like: 'local%' }, 'weather'] } } });
    // returns the stories whose tags are an empty list
    await storyRepository.findAll({ where: { tags: { length: 0 } } });
    // returns the stories without a list of tags
    await storyRepository.findAll({ where: { tags: null } });
}
```

An empty array is found by `{ length: 0 }`, and a missing one by `null`. Every other operator on an
array passes over both, so `{ isIncludedIn: [] }` finds nothing. To find the stories tagged only
`'news'` together with the ones without tags, ask for both:
`[{ tags: { isIncludedIn: ['news'] } }, { tags: { length: 0 } }]`.

A relation to many rows takes the same operators, with the related rows as its items. It always holds
a list, so `{ length: 0 }` finds the rows without related rows.

### Filtering a value of several shapes

A [property of several shapes](./models.md#a-value-of-several-shapes) is filtered by one filter per
shape, named `when` followed by the name of the shape. Each row is matched by the filter of the shape
it holds. Every shape has to be named: `false` matches no row of that shape, and `{}` every one.

```ts
// src/models/lead.model.ts
import { BaseTenantEntity, Entity, inject, OneOf, Property, Repository, repositoryTokenFor } from 'zibri';

class Signup {
    @Property.string()
    email!: string;
}

class Invite {
    @Property.string()
    code!: string;
}

@Entity()
export class Lead extends BaseTenantEntity {
    @Property.oneOf({ shapes: { Signup: { type: 'object', cls: () => Signup }, Invite: { type: 'object', cls: () => Invite } } })
    contact!: OneOf<{ Signup: Signup, Invite: Invite }>;
}

// src/services/lead.service.ts
const leadRepository: Repository<Lead> = inject(repositoryTokenFor(Lead));

async function findLeads(): Promise<void> {
    // returns the signups with this email, and no invites
    await leadRepository.findAll({ where: { contact: { whenSignup: { where: { email: 'a@example.com' } }, whenInvite: false } } });
    // returns every signup, and the invites with this code
    await leadRepository.findAll({ where: { contact: { whenSignup: {}, whenInvite: { where: { code: 'A1' } } } } });
}
```

The same filter works inside an object property, and in `where` on an array whose items are of
several shapes.

## Restricting which rows a caller may see
When an entity's rows are not all visible to everybody, say so on the entity. A scope is a function of the request: it returns the filter every query on that entity is narrowed by.

```ts
// src/models/invoice.model.ts
import { $ts, BaseTenantEntity, Entity, Property, scopeFor, UnauthorizedError } from 'zibri';

@Entity({
    scope: {
        restrictedTo: scopeFor<Invoice>(ctx => {
            if (!ctx.currentUser) {
                throw new UnauthorizedError($ts`Invoices belong to a user.`);
            }
            return { userId: ctx.currentUser.id };
        })
    }
})
export class Invoice extends BaseTenantEntity {
    @Property.string()
    title!: string;

    @Property.boolean()
    paid!: boolean;

    @Property.string({ format: 'uuid' })
    userId!: string;
}
```

Wrap the function in `scopeFor<YourEntity>` so the filter is typed against the entity: its columns, their value types and the operators each one allows.

From then on every repository call is narrowed by it, reads and writes alike:

```ts
// src/services/invoice.service.ts
import { inject, Repository, repositoryTokenFor } from 'zibri';

import { Invoice } from '../models/invoice.model';

export const invoiceRepository: Repository<Invoice> = inject(repositoryTokenFor(Invoice));

async function readInvoices(id: string): Promise<void> {
    // only the rows the caller may see, without a filter to write or to forget
    await invoiceRepository.findAll();
    // combined with your own filter rather than replacing it
    await invoiceRepository.findAll({ where: { paid: false } });
    // the page and its totalAmount both count only the rows the caller may see
    await invoiceRepository.findAllPaginated(1, 20);
    // throws a NotFoundError for an invoice the caller may not see
    await invoiceRepository.findById(id);
}
```

A row the caller may not see is answered with a `404`, so an id that exists and an id that does not are answered alike.

Writes are restricted too. A row that would land outside the filter is refused with a `403`, whether it is created there or moved there by an update. An update is judged only on the columns it carries, so renaming a row you can already reach is never refused. A write that points a row at a row the caller may not see is refused with a `403` as well, the same as pointing it at a row of another tenant.

A relation holds only the rows the caller may see. Reading an account with `relations: ['invoices']` resolves the invoices the caller may see, a filter through the relation, `{ invoices: { where: { paid: false } } }`, is judged on those rows, and `{ invoices: { length: 0 } }` counts them. A relation to one row is `undefined` when the caller may not see that row. The same holds at every level of a relation of a relation.

An [`upsert`](#changing-a-value-based-on-what-is-stored) only ever changes a row the caller may see. When its identity is held by a row they may not see, it is refused with the same `UniqueConstraintViolationError` inserting that identity would be. Its changes are judged the way an update's are: a value it sets before anything is written, and an amount it adds on the row once it is written, so an increment that carries the row outside the filter is refused and rolled back. Inside a transaction you passed, that increment stays until you roll the transaction back. An `upsertAll` is all or nothing: when one of its rows is refused, none of the others are written either.

### What a scope is told
The function is handed an `EntityScopeContext`:

| Field | What it is |
|---|---|
| `currentUser` | the requesting user, a `CurrentUser` with the [permissions](./roles-and-permissions.md#in-your-own-code) the request may use; undefined for an anonymous request and outside a request |
| `tenantId` | the active [tenant](./tenancy.md), if there is one |
| `currentMembership` | the membership the user acts through in that tenant, without its roles |
| `hasPermission(permission)` | whether a role of that membership carries the [permission](./roles-and-permissions.md), answered as `@Auth.hasPermission` answers it; no outside a request |
| `hasPlatformPermission(permission)` | whether a role of the user's own carries the permission, answered as `@Auth.hasPlatformPermission` answers it; no outside a request |
| `requestContext` | the request being handled, if there is one |
| `entityClass` | the entity being read or written, so one scope can serve several |

### What a scope can answer
| Returns | Meaning |
|---|---|
| a filter | the caller sees the rows matching it |
| an array of filters | the caller sees the rows matching **any** of them |
| `undefined` | the caller is not restricted at all |
| `denyAll` | the caller sees no rows: an empty list, and `404` for a single row |
| *throws* | the request itself is refused, with whatever you threw |

Return `denyAll` for a caller who sees none of the rows. Throw for a caller who may not ask at all.

An array of filters lets one table hold public rows and private ones:

```ts
// src/models/document.model.ts
import { BaseTenantEntity, Entity, Property, scopeFor } from 'zibri';

import { Permissions } from './permissions';

@Entity({
    scope: {
        restrictedTo: scopeFor<Document>(async ctx => {
            // anonymous callers see what is published
            if (!ctx.currentUser) return { published: true };
            // a member whose role carries the permission sees everything
            if (await ctx.hasPermission(Permissions.DOCUMENTS_READ_ALL)) return undefined;
            // everyone else sees what is published, plus their own
            return [{ published: true }, { userId: ctx.currentUser.id }];
        })
    }
})
export class Document extends BaseTenantEntity {
    @Property.boolean()
    published!: boolean;

    @Property.string({ format: 'uuid' })
    userId!: string;
}
```

The filter the handler passes is combined with the scope in both directions: asking for `{ userId: someoneElse }` against the scope above reaches the published rows, and only those.

> [!WARNING]
> A scope returns an ordinary where filter, and a condition whose value is `undefined` is dropped. For an anonymous caller, `{ userId: ctx.currentUser?.id }` is an empty filter and matches every row. Return `denyAll` for a caller who sees no rows, and never a filter built from a value that may be absent.

### When both sides filter the same property
Both conditions have to hold, so they become the one condition that says both:

- Two lists of allowed values become the values on both lists.
- Two bounds become the one that allows the fewest rows.
- Two patterns are both required.
- A value of several shapes is combined shape by shape. A shape either side rules out is ruled out, and a shape whose two conditions contradict each other leaves the other shapes reachable.

A pair nothing can satisfy, `{ userId: someoneElse }` against a scope of `{ userId: ctx.currentUser.id }`, is answered with no rows without asking the data source.

What a property holds inside it is asked for both at once, of the same row. A scope requiring `{ payments: { where: { payerId: ctx.currentUser.id } } }` and a caller asking `{ payments: { where: { amount: { greaterThan: 100 } } } }` find the invoices with a payment of the caller's that is over 100. An invoice with a payment of the caller's and a different payment over 100 is not found.

### Reading across the restriction
`currentUser` is undefined for an anonymous request, and for anything running outside a request: a cron job, a migration, a startup task. The scope decides what that means. The first example throws for it.

Code that has to read across the restriction says so:

```ts
// src/services/invoice.service.ts
async function readAcrossTheRestriction(): Promise<void> {
    // every scope on the entity
    await invoiceRepository.findAll({ unscoped: true });
    // one of them by name
    await invoiceRepository.findAll({ unscoped: ['restrictedTo'] });
}
```

`unscoped` is accepted by every repository method, and lifts the scopes of the related entities the call reaches as well. It is set per call, so searching for `unscoped` lists every place the restriction is lifted.

### Filling in who a row belongs to
A scope says which rows a caller may see; it cannot supply a value. A property default does that:

```ts
// src/models/receipt.model.ts
import { BaseTenantEntity, CurrentUser, Entity, HttpRequestContext, inject, Property, WebsocketRequestContext, ZIBRI_DI_TOKENS, ZIBRI_REQUEST_CONTEXT_TOKENS } from 'zibri';

async function currentUser(): Promise<CurrentUser | undefined> {
    const ctx: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
    return await ctx?.get(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_USER);
}

@Entity()
export class Receipt extends BaseTenantEntity {
    @Property.string({ format: 'uuid', default: async () => (await currentUser())?.id ?? '' })
    userId!: string;
}
```

Defaults are applied before the scope checks the write, so the value a default produces is the one that gets checked.

## Using transactions
A transaction can be started from a data source:

```ts
// src/services/task-batch.service.ts
import { InjectRepository, Repository, Transaction } from 'zibri';

import { DbDataSource } from '../data-sources/db/db.data-source';
import { TaskCreateData, TaskUpdateData } from '../models';
import { Task } from '../models/task.model';

export class TaskBatchService {
    constructor(
        @InjectRepository(Task)
        private readonly taskRepository: Repository<Task, TaskCreateData, TaskUpdateData>,
        private readonly dataSource: DbDataSource
    ) {}

    async createReleaseTasks(): Promise<void> {
        const transaction: Transaction = await this.dataSource.startTransaction();
        try {
            const notes: Task = await this.taskRepository.create({ title: 'Write the release notes', status: 'new' }, { transaction });
            const publish: Task = await this.taskRepository.create({ title: 'Publish the release', status: 'new' }, { transaction });
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
    }
}
```

From the moment it starts until it commits or rolls back, a transaction holds a connection out of the
pool and every row it writes. The `catch` above hands them back when the work fails.

Two transactions that each hold a row the other one writes next wait on each other. One of them is
ended to let the other go on, and its write fails with a `TransactionDeadlockError`: nothing it wrote
is applied, so roll it back and run it again from the start.

A transaction started with the isolation level `REPEATABLE READ` or `SERIALIZABLE` is ended the same
way when another one changed what it read in a way that level does not allow, and fails with a
`TransactionSerializationError`, at a write or at its commit. Both errors are a
`TransactionConflictError`.

`runInTransaction` starts a transaction, commits it once your work is done, rolls it back when your
work fails, and runs your work again from the start after a `TransactionConflictError`, until it has
run `maxAttempts` times:

```ts
// src/services/task-limit.function.ts
import { IsolationLevel, Repository, Transaction } from 'zibri';

import { DbDataSource } from '../data-sources/db/db.data-source';
import { Task } from '../models/task.model';

async function createTaskWithinLimit(dataSource: DbDataSource, taskRepository: Repository<Task>): Promise<Task | undefined> {
    return await dataSource.runInTransaction(async (transaction: Transaction) => {
        if (await taskRepository.count({ transaction }) >= 100) {
            return undefined;
        }
        return await taskRepository.create({ title: 'Write the release notes', status: 'new' }, { transaction });
    }, { isolationLevel: IsolationLevel.SERIALIZABLE, maxAttempts: 3 });
}
```

Your work may run more than once, so keep it to what it writes through the transaction: an email sent
from inside it goes out once per attempt. Send it from `afterCommit` instead.

Work that has to follow the writes only once they landed goes to `afterCommit`. It runs once the
commit is done, in the order it was added, and never after a rollback:

```ts
// src/services/task-announcement.service.ts
import { Repository, Transaction } from 'zibri';

import { Task } from '../models/task.model';
import { announceTask } from './announce-task.function';

async function createAndAnnounce(taskRepository: Repository<Task>, transaction: Transaction): Promise<void> {
    const task: Task = await taskRepository.create({ title: 'Publish the release', status: 'new' }, { transaction });
    transaction.afterCommit(async () => await announceTask(task.id));
}
```

Work that has to follow the end of the transaction however it ended goes to `afterFinish`. It runs once the
transaction is committed, rolled back or its commit failed, and is told whether it was committed. A
[lease held until a transaction ends](./leases.md#holding-a-lease-until-a-transaction-ends) is handed back
this way.

A transaction that reaches neither a commit nor a rollback is rolled back once it has sat idle for
ten seconds: everything it held is handed back, its `afterFinish` work runs as for any rollback, and a
later `commit` throws a `TransactionAlreadyFinishedError`. The clock runs from the last thing it did, so a
transaction that keeps working keeps its full allowance however long it runs. A transaction that
waits on something slow between two of its writes says so when it starts:

```ts
// src/services/task.functions.ts
import { inject, Transaction } from 'zibri';

import { DbDataSource } from '../data-sources/db/db.data-source';

async function startPatientTransaction(): Promise<Transaction> {
    return await inject(DbDataSource).startTransaction({
        idleTimeoutInMs: 60000
    });
}
```

Set it to `0` for a transaction that may sit idle for as long as it likes.

## Handling migrations
Migrations are listed on the data source, next to its entities: the `migrations` property on
[`DbDataSource`](#defining-a-data-source) above lists them, in the order they are written.

`RenameTaskNameMigration` renames the property `name` of `Task` to `title`:

```ts
// src/data-sources/db/migrations/rename-task-name.migration.ts
import { Injectable, Migration, SemVerVersion, Transaction } from 'zibri';

import { Task } from '../../../models/task.model';
import { DbDataSource } from '../db.data-source';

@Injectable()
export class RenameTaskNameMigration extends Migration {
    version: SemVerVersion = '0.0.1';

    constructor() {
        super(DbDataSource);
    }

    override async up(transaction: Transaction): Promise<void> {
        await this.dataSource.changePropertyOfEntity({
            entity: Task,
            currentProperty: { name: 'name', type: 'string' },
            property: { name: 'title', type: 'string' },
            transaction
        });
    }

    override async down(transaction: Transaction): Promise<void> {
        await this.dataSource.changePropertyOfEntity({
            entity: Task,
            currentProperty: { name: 'title', type: 'string' },
            property: { name: 'name', type: 'string' },
            transaction
        });
    }
}
```

A migration says how each property is stored, with the same metadata the `@Property` decorator takes plus its `type`, instead of reading it off the entity. It runs again on every new database, long after the entity may have changed. `unique`, `index` and `fuzzySearchable` are left out: the data source [keeps the indexes and uniques](#keeping-indexes-and-uniques) the entity declares, once the migrations have run.

| Helper | What it does |
|---|---|
| `addPropertyToEntity` | Adds a property. It is empty in the entities already stored, so the migration can fill it |
| `changePropertyOfEntity` | Changes a property from `currentProperty` to `property`: its name, its type, or both. It fails when `currentProperty` does not describe what is stored. `convert` says what each stored value becomes, see below |
| `removePropertyFromEntity` | Removes a property and what it holds |
| `renameEntity` | Moves every stored entity from `currentTableName` to the table name the entity declares, with its relations, indexes and uniques. It fails when entities are stored under the declared table name already |
| `mergeEntity` | Moves every stored entity from `currentTableName` to the entity, next to the ones it stores, with its relations. An entity that holds what a stored one holds under its id or a unique the entity declares is left out |
| `createEntity` | Creates what an entity is stored in. `properties` is written out or `'resolveFromEntity'`. Relations are only created when it is resolved |

Something written out means the same in every later version. Something resolved means whatever the entity has become by the time the migration runs.

Setting the schema up and running each migration take as long as they need. They run under the data
source's `migrationTimeoutInMs`, not under [the time a statement may take](#how-long-a-call-may-take),
and it sets no limit unless the data source declares one. A migration that should stop sooner, or
may take longer than the data source allows, declares a `timeoutInMs` of its own:

```ts
// src/data-sources/db/migrations/remove-paid-invoices.migration.ts
import { Injectable, Migration, SemVerVersion, Transaction } from 'zibri';

import { invoiceRepository } from '../../../services/invoice.service';
import { DbDataSource } from '../db.data-source';

@Injectable()
export class RemovePaidInvoicesMigration extends Migration {
    version: SemVerVersion = '0.0.2';

    override readonly timeoutInMs: number = 15 * 60 * 1000;

    constructor() {
        super(DbDataSource);
    }

    override async up(transaction: Transaction): Promise<void> {
        await invoiceRepository.deleteAll({ paid: true }, { transaction });
    }

    override async down(): Promise<void> {
        throw new Error('The removed invoices cannot be restored.');
    }
}
```

### Converting values
`changePropertyOfEntity` converts every stored value, and fails without changing anything when one of them cannot be converted. The error names each of those values. `convert` lists values that become specific other values, and its `default` says what happens to all the others:

```ts
// src/data-sources/db/migrations/replace-active-with-state.function.ts
import { CronJobEntity, CronJobState, DataSourceInterface, Transaction, ValueConversion } from 'zibri';

async function replaceActiveWithState(dataSource: DataSourceInterface, transaction: Transaction): Promise<void> {
    await dataSource.changePropertyOfEntity({
        entity: CronJobEntity,
        currentProperty: { name: 'active', type: 'boolean' },
        property: { name: 'state', type: 'string', enum: CronJobState },
        convert: {
            values: [{ from: true, to: CronJobState.ACTIVE }, { from: false, to: CronJobState.INACTIVE }],
            default: ValueConversion.NONE
        },
        transaction
    });
}
```

- `ValueConversion.NONE` converts only the listed values, and fails on any other value.
- `ValueConversion.CAST` casts the other values. It is what happens without `convert`.

A cast keeps the value, or fails:

| From | To | A value is kept when |
|---|---|---|
| any type | the same type | the new property can hold it: a string has to be one of its `enum`, at most `maxLength` characters long, and a uuid if it has to be one |
| number | number of another `format` | it is the same number afterwards and the `format` holds it: `1.5` and `2 ** 53` fail as an `'integer'` |
| number | string | always, written the way JavaScript writes it, such as `'1.5'` or `'1e+21'`. A `'bigint'` or `'bignumber'` is written in decimal digits |
| string | number | it is a number written out, such as `'-1.5'` or `'2e3'`, and that number fits the `format`. An `'integer'` or `'bigint'` takes digits only. `' 7'` and `'0x10'` fail |

Any other change of type has no cast, so `convert` with `ValueConversion.NONE` is required. A missing value fails when the new property is required.

`down` undoes what `up` did. [Going back](#going-back) runs it, so write it for every migration.

### Versioning
Each migration has a version. It is compared against the application's version, which is the
version in `package.json` by default. Your routes declare themselves against the same version, so
one number says which API a build serves and which schema it expects.

A version says which application versions a schema state belongs to, so several migrations share
one when a release carries more than one schema change. A migration is recorded by its class name:
the name decides whether it has run, and which record a revert removes. Give every migration a class
name of its own.

> [!WARNING]
> Renaming a migration after it shipped makes it look unapplied, and it runs again.

On boot, every migration up to and including the app's version that the database has not recorded yet is applied, in the order the data source lists them. A [restore](./backup.md#a-backup-of-another-release) applies them the same way to what it restored.

### Going back
An application whose database is migrated past its own version refuses to start, and says which migrations it found:

```
This app is version 1.2.0, but its database has already been migrated to "AddInvoiceTable" (1.3.0).
Running an older instance against a newer schema is not supported, so it refuses to start rather
than reverting the schema that the newer instances are using.
```

The schema is shared with the instances already serving on it, so an instance that starts late, after
a rollback, a restart or a scale event, never reverts it.

A release that changed the [indexes and uniques](#keeping-indexes-and-uniques) counts the same: its version is recorded under `zibri:indexes-and-uniques`, and an older release refuses to start against it. `revertMigrationsAfter` removes that record along with the migrations, and the older build then brings the indexes and uniques back to what its own entities declare when it starts.

To roll back past a migration:

1. Stop the instances running the newer version.
2. Run `await dataSource.revertMigrationsAfter('1.2.0')`. It runs `down()` for everything above that version, in the reverse of the order it was applied in.
3. Deploy the older build.

> [!WARNING]
> Step 2 takes the schema away from any newer instance still serving, and a `down()` that drops a column drops its data. Stop the newer instances first.

During a rolling deploy, instances of both versions serve at the same time. Keep each migration backward compatible with the version before it: add a nullable column instead of renaming one in place, and remove the old column in a later release.

### Running more than one instance
Schema setup runs on one instance at a time: creating the migration table, running migrations, keeping the indexes and uniques, and whatever `schemaManagement` asks for. The first instance to start sets the schema up, and the others find the work done. There is nothing to configure.

An instance waits for the schema setup of another for one minute at most, then fails to start. `ZIBRI_DI_TOKENS.SCHEMA_LOCK_TIMEOUT_IN_MS` sets the wait:

```ts
// src/providers.ts
import { defineProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({ token: ZIBRI_DI_TOKENS.SCHEMA_LOCK_TIMEOUT_IN_MS, useFactory: () => Ms.MINUTE * 5 })
```

Raise it when your migrations take longer than that.

## Making your own writes safe across instances

| Use | When |
|---|---|
| [`upsert`](#changing-a-value-based-on-what-is-stored) | The new value of one row depends on the stored one, such as a counter or a running total |
| [`updateAll`](#changing-every-row-that-matches-a-filter) | Every row that matches a filter changes, such as when claiming queued work |
| [`{ increment }`](#adding-to-what-every-matching-row-stores) | An amount is added to what every matching row stores |
| [a lease](#serializing-work-with-a-lease) | Only one instance may do a piece of work |

### Changing a value based on what is stored

When the new value depends on the current one, such as a counter, a stock level or a running total, use `upsert`. It reads and writes in one step, so no other write lands in between:

```ts
// src/services/invoice-number.service.ts
import { inject, Repository, repositoryTokenFor, Transaction } from 'zibri';

import { NumberInvoices } from '../models/number-invoices.model';

const numberInvoicesRepository: Repository<NumberInvoices> = inject(repositoryTokenFor(NumberInvoices));

async function nextNumber(year: number, recipientId: string, transaction: Transaction): Promise<number> {
    const counter: NumberInvoices = await numberInvoicesRepository.upsert(
        { year, recipientId },                       // identifies the row, and is the conflict target
        { year, recipientId, number: 1 },            // inserted when there is no row yet
        { number: { increment: 1 } },                // applied when there is
        { transaction }
    );
    return counter.number; // already the new value
}
```

The properties you identify the row by are declared together as a unique on the entity, in any
order: the `uniques: [['year', 'recipientId']]` on [`NumberInvoices`](#defining-entities) above.
Without that declaration the call is refused. `increment` is offered on number properties; every
other property takes `{ set: value }`.

The identity holds the same values as the row you insert, and the changes leave it as it is. A call that breaks either is refused.

Pass your `transaction`. The result comes back before the transaction commits, so you can use it while the transaction is open, and it rolls back with everything else. An abandoned invoice then leaves no gap in the numbering.

A `belongsToOne` or `manyToOne` may be named in the row you insert, and is written as the foreign key it resolves to. Pass the related entity or its id, whichever you have. The other three relation kinds keep their key on the row at the other end, or in a join table, so naming one is refused, and the error names the property. Write that side separately, or use `create`.

What comes back has its relations resolved, the same as any other read, see [What a write hands back](#what-a-write-hands-back).

To do the same for several rows in one call, use `upsertAll`. You name the identity once, and each row brings what to insert and its own changes:

```ts
// src/services/invoice-number.service.ts
import { Transaction } from 'zibri';

import { NumberInvoices } from '../models/number-invoices.model';

async function nextNumbers(year: number, recipientIds: string[], transaction: Transaction): Promise<number[]> {
    const counters: NumberInvoices[] = await numberInvoicesRepository.upsertAll(
        ['year', 'recipientId'],                     // read off each row's `create`
        recipientIds.map(recipientId => ({
            create: { year, recipientId, number: 1 },
            onConflict: { number: { increment: 1 } }
        })),
        { transaction }
    );
    return counters.map(c => c.number);
}
```

Every rule of `upsert` applies to each row. The rows come back in the order you passed them. A call in which two rows hold the same identity is refused before anything is written. Calls running at the same time may name the same rows in any order: each waits for the other, and neither fails.

### Changing every row that matches a filter

`updateAll` is safe across instances with nothing to add. Claiming work by changing a column is safe: two callers never get back the same row, because each row is held from the moment it is read until the change commits. A caller that loses the race gets the rows still left to take, often none.

```ts
// src/models/job.model.ts
import { BaseTenantEntity, Entity, inject, Property, Repository, repositoryTokenFor } from 'zibri';

@Entity()
export class Job extends BaseTenantEntity {
    @Property.string()
    status!: string;
}

// src/services/job.service.ts
const jobRepository: Repository<Job> = inject(repositoryTokenFor(Job));

async function claim(): Promise<Job[]> {
    return await jobRepository.updateAll(
        { status: 'QUEUED' },
        { status: 'SENT' },
        { returnUpdated: true }
    );
}
```

Claiming is the case that wants `returnUpdated`: the rows it comes back with are the ones this instance now owns, and nothing else can be handed them.

You do not have to pass a transaction for that. One is taken for the operation when you did not, and yours is used when you did, so the change rolls back with everything else.

> [!NOTE]
> `updateAll` changes the rows that matched when it read them, on every data source. A row inserted a moment later is left as it is. Only a serializable isolation level covers rows that start matching while it runs.

### Adding to what every matching row stores

A number property takes `{ increment: amount }` instead of a value. The amount is added to what each row stores, in the same write, so two callers adding at the same time both land:

```ts
// src/models/page-view.model.ts
import { BaseTenantEntity, Entity, inject, Property, Repository, repositoryTokenFor } from 'zibri';

@Entity()
export class PageView extends BaseTenantEntity {
    @Property.string()
    path!: string;

    @Property.number({ format: 'integer' })
    views!: number;

    @Property.string({ required: false })
    lastReferrer?: string | null;
}

// src/services/page-view.service.ts
const pageViewRepository: Repository<PageView> = inject(repositoryTokenFor(PageView));

async function countView(path: string, referrer: string): Promise<void> {
    await pageViewRepository.updateAll({ path }, { views: { increment: 1 }, lastReferrer: referrer });
}
```

- A negative amount subtracts.
- A property that holds no value counts as 0.
- A property of whole numbers takes whole amounts only.
- Only a number property takes an amount. For a property holding an object, `{ increment }` is a value like any other.
- A change set records the value each row holds afterwards.
- When your [scope](#restricting-which-rows-a-caller-may-see) reads the property, each row is judged on what it holds after the amount was added, and the whole update is undone with a `403` when one of them left what you may see.

To add to one row that may not exist yet, use `upsert` above.

### Serializing work with a lease

When only one instance may do a piece of work, such as an import, a report or a third-party call that must happen once, take a [lease](./leases.md):

```ts
// src/services/feed.service.ts
import { inject, Ms, ZIBRI_DI_TOKENS } from 'zibri';

export class FeedService {
    async import(feedId: string): Promise<void> {
        await inject(ZIBRI_DI_TOKENS.LEASE_SERVICE).withLease(
            { key: `import:${feedId}`, leaseInMs: Ms.MINUTE },
            async () => await this.importFeed(feedId)
        );
    }

    private async importFeed(feedId: string): Promise<void> {
        // the work that has to happen once
    }
}
```

Pick the narrowest key that keeps the work correct. `import:${feedId}` lets two feeds import at once, and a plain `'import'` serializes every import in the deployment. The key is a plain string, and only callers using the same one wait for each other. Prefix your keys: the key space is shared with the framework's own.

> [!WARNING]
> A write made with `{ transaction }` becomes visible on commit. Commit inside the lease body, and reading, changing and writing a value is safe. Commit after the lease ends, in a transaction the caller passed in, and the next holder reads a value that is already taken, with no error. Pass that transaction as `heldUntil` to [hold the lease until it ends](./leases.md#holding-a-lease-until-a-transaction-ends), or use [`upsert`](#changing-a-value-based-on-what-is-stored) for the value.
>
> A write made while holding a lease, in a transaction that is still open when the lease ends, logs a warning naming the lease. The check runs on the code path that ran, so a branch that never runs never warns.

### Acquisition order

Anything holding more than one grant at a time can deadlock when two callers take them in opposite orders: one takes `a` then `b`, the other `b` then `a`. Decide an order for your keys and keep to it.

Transactions and `upsert` hold rows of their own, so two transactions touching the same rows in opposite orders can deadlock the same way.

## Recording who changed what
A `ChangeSetRepository` is a `Repository` that tracks who changed what, and when. An entity with a
`changeSets` property, such as one extending `ChangeSetEntity`, gets one, with nothing to configure.

`excludeFromChangeSets` leaves a property out of the tracking:

```ts
// src/models/note.model.ts
import { ChangeSetEntity, Entity, Property } from 'zibri';

@Entity()
export class Note extends ChangeSetEntity {
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    @Property.string({ excludeFromChangeSets: true })
    draft!: string;
}
```

Change sets are stored in the same data source as the entity they record. A change set belongs to the
[tenant](./tenancy.md#work-outside-a-request) of the row it describes, also when the change was made
across tenants. Hard deleting a row deletes its change sets along with it, and a soft delete keeps
them.

A change set is found by the id of its row, and the change sets of all entities share one table. An id
you give a row through `allowId` is one that no row of another change set entity has, or the two
share a history. Resetting a change set or rolling back to one refuses a change set of another row.

A change of an object property records the whole object, before and after. Resetting it writes the
object back as it was, with `null` for a property added to it since.

### A change and its record are one write

Every method that writes a change set takes a transaction over both, so a row and the change set
describing it arrive together or neither does. That holds for creating, updating, deleting,
resetting a change set and rolling back to one, in bulk as well as singly. A rollback covers every
change set it walks through, so the row never stops between two of them.

Pass your own `transaction` and it is used instead, which is what puts the change sets in the same
unit as the rest of your work:

```ts
// src/services/note.service.ts
import { ChangeSetRepository, Transaction } from 'zibri';

import { Note } from '../models/note.model';

async function renameInside(noteRepository: ChangeSetRepository<Note>, id: string, transaction: Transaction): Promise<void> {
    // the note, its change set, and whatever else the transaction carries
    await noteRepository.updateById(id, { draft: 'rewritten' }, { transaction });
}
```

The user who made a change is read from the request. A write from a cron job, a migration or a
startup task records a change set with no user on it.

## Soft deleting rows
A `SoftDeleteRepository` is a `ChangeSetRepository` that deletes softly. An entity extending
`SoftDeleteEntity` gets one.

A delete marks the row as deleted and keeps it. Every read and write leaves soft deleted rows out,
unless the call's `deleted` option says otherwise:

| `deleted` | The call reaches |
|---|---|
| `'exclude'` | Rows that are not soft deleted. The default |
| `'include'` | Every row |
| `'only'` | Soft deleted rows alone |

```ts
// src/services/account.service.ts
import { SoftDeleteRepository } from 'zibri';

import { Account } from '../models/account.model';

async function listTrash(accountRepository: SoftDeleteRepository<Account>): Promise<Account[]> {
    return await accountRepository.findAll({ deleted: 'only' });
}

async function restore(accountRepository: SoftDeleteRepository<Account>, id: string): Promise<Account> {
    return await accountRepository.updateById(id, { deleted: false }, { deleted: 'only' });
}
```

The option is the only way to choose: a filter naming `deleted` with a value the option does not
give it is refused. An update hands back the row it wrote, whether or not that row is still reached
afterwards.

`deleted` chooses among the rows of the entity the call is on. A relation holds only the rows of the
related entity that are not soft deleted, a filter through the relation is judged on those, and a
count of it counts those; a soft deleted row is reached through the repository of its own entity.

`hardDelete: true` on `deleteById` or `deleteAll` removes rows for good, soft deleted ones included.

## How long a call may take
Every statement a data source runs has a time limit, inside a request or not, in a cron job, an
event subscriber and a thread job as well. A statement past it fails. A Postgres data source gives a
statement 30 seconds, and `statementTimeoutInMs` sets another limit. A Valkey data source gives a
command the `requestTimeout` of its options, 5 seconds by default.

A call that needs longer, or should give up sooner, names `timeoutInMs` on its options. Each statement
of the call may take that long, and the call as a whole as well: once it has run out of time, the
statement still running is stopped where the store can stop one, and nothing further is asked of the
store. `0` lifts the limit. A single Valkey command keeps its `requestTimeout` either way.

```ts
// src/data-sources/warehouse/warehouse.data-source.ts
import { BaseEntity, DataSource, Newable, OmitStrict, PostgresDataSource, PostgresOptions, RepositoryClass, SchemaManagement } from 'zibri';

@DataSource()
class WarehouseDataSource extends PostgresDataSource {
    options: OmitStrict<PostgresOptions, 'type' | 'entities'> = { host: 'warehouse.internal', database: 'warehouse', ssl: true };
    entities: Newable<BaseEntity>[] = [];
    repositories: RepositoryClass[] = [];
    schemaManagement: SchemaManagement = 'external';

    protected override readonly statementTimeoutInMs: number = 60000;
}
```

```ts
// src/services/invoice.service.ts
async function removePaidInvoices(): Promise<void> {
    await invoiceRepository.deleteAll({ paid: true }, { timeoutInMs: 10 * 60 * 1000 });
}
```

A stream counts the time between two of its rows too: it has run out of time once it has been open
for longer than its `timeoutInMs`, however much of it was read.

A call that finds every connection of a postgres data source's pool taken waits for one to come free,
for 30 seconds at most, and fails past that. `connectTimeoutMS` in the data source's `options` says
otherwise. A call's `timeoutInMs`, and the request it belongs to, end the wait sooner. Starting a
transaction waits the same way.

## Reads and writes inside a request
A repository operation belongs to the request that asked for it. When that request runs out of the
time its route allows, the next operation is refused, and a statement already running is stopped
where the store can stop one. Both fail with the `GatewayTimeoutError` the caller was answered with.

A statement inside a transaction is stopped the same way, and the transaction rolls back with it.
The rows it held are free again.

A call naming a [`timeoutInMs`](#how-long-a-call-may-take) inside a request ends with whichever of the
two runs out first.

See [deadlines](./creating-endpoints.md#deadlines).

## Requirements
| Package | Used for |
|---|---|
| `typeorm` | Reading and writing a Postgres data source |
| `pg` | Connecting to Postgres. You install it |
| `pg-query-stream` | Reading the rows of a Postgres data source with `stream`. You install it |
| `@valkey/valkey-glide` | Connecting to Valkey. You install it |

Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `MigrationEntity` | Its `schemaManagement` is `'migrations'`, see [handling migrations](#handling-migrations) |
| `ChangeSet`, `Change` | One of its entities records who changed what, see [recording who changed what](#recording-who-changed-what) |

## See also
- [Costs](./costs.md) — how many round trips each repository call takes
- [Models](./models.md) — the `@Property` decorators entities are declared with
- [Validating requests](./validation.md) — the checks of an entity, answered for a request body
- [Replication](./replication.md) — the shared data source every instance coordinates through
- [Leases](./leases.md) — the grant behind everything only one instance may do at a time
- [Cron](./cron.md) — cron jobs are persisted as entities in a data source
- [Application lifecycle](./application-lifecycle.md) — data sources are provided to the `ZibriApplication`
- [Encryption & Hashing](./encryption-and-hashing.md) — encrypting/hashing entity properties defined via `@Property`
- [Auth](./auth.md) — who the requesting user a `scope` restricts rows to is, and what a refused request answers