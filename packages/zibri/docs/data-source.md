# Data Sources
Data sources in Zibri are used to connect eg. to databases.

They provide a lot of functionality out of the box, including:
- defining entity classes that are mapped to the data source
- repositories used to access the items of an entity in the data source
- migrations
- transactions 
- using multiple data sources simultaneously

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `DataSource` | decorator | Registers a class as a data source |
| `DataSourceInterface` | interface | Contract a data source must implement |
| `PostgresDataSource` | class | Predefined data source for Postgres, extend from this instead of implementing `DataSourceInterface` directly |
| `PostgresOptions` | interface | Connection/config options for `PostgresDataSource` |
| `ValKeyDataSource` | class | Predefined data source for ValKey, extend from this instead of implementing `DataSourceInterface` directly |
| `ValKeyOptions` | interface | Connection/config options for `ValKeyDataSource` |
| `RepositoryDriverInterface` | interface | The storage specific part of a repository, implemented once per data source type |
| `BaseEntity` | class | Base class entities must extend, defines an id property |
| `Entity` | decorator | Registers a class as an entity, and declares the `scope` restricting its rows |
| `scopeFor` | function | Types a `scope` against the entity it is declared on |
| `denyAll` | value | Returned from a `scope` to give the caller no rows at all |
| `Property` | decorator | Maps a class property to a data source column, also used for validation |
| `BigNumber` | class | An exact decimal of any size, which a `@Property.number({ format: 'bignumber' })` holds |
| `NumberUtilities` | class | Arithmetic and comparison over every shape a number takes — `number`, `bigint`, `BigNumber` |
| `Newable` | type | Helper type for referencing a class (constructor) |
| `InjectRepository` | decorator | Injects a `Repository` for a given entity into a constructor parameter |
| `Repository` | class | Generic repository exposing `findAll`, `findAllPaginated`, `stream`, `findOne`, `findById`, `count`, `exists`, `createAll`, `create`, `updateAll`, `updateById`, `upsert`, `deleteAll`, `deleteById` |
| `StreamOptions` | type | What `stream` accepts — a filter and relations, with no limit and no order |
| `ChangeSetRepository` | class | Extended `Repository` that automatically tracks who changed what & when |
| `SoftDeleteRepository` | class | Extended `ChangeSetRepository` that adds soft delete functionality |
| `Transaction` | class | Represents a started transaction (`commit`/`rollback`) |
| `Migration` | class | Base class to extend when defining a migration |
| `SemVerVersion` | type | Version type used for `Migration.version` |

## Usage
### Defining a data source
A data source needs too implement DataSourceInterface. Zibri also provides more specific, predefined classes, like the PostgresDataSource that you can extend from instead.

The data source then needs to be decorated with `@DataSource`.

The example below illustrates how a data source might be setup:

```ts
// src/data-sources/db/db.data-source.ts
import { BaseEntity, DataSource, Migration, Newable, OmitStrict, PostgresDataSource, PostgresOptions, SchemaManagement } from 'zibri';

@DataSource()
export class DbDataSource extends PostgresDataSource {
    options: OmitStrict<PostgresOptions, 'type' | 'entities'> = {
        host: 'localhost',
        port: 5432,
        username: 'postgres',
        password: 'password',
        database: 'db'
    };

    entities: Newable<BaseEntity>[] = [Test];
    // see "Handling migrations" below
    migrations: Newable<Migration>[] = [RenameValuePropertyMigration];
    schemaManagement: SchemaManagement = 'synchronize';
}
```

`pg` and `pg-query-stream` are optional peer dependencies, install them alongside a postgres data
source:

```bash
npm i pg pg-query-stream
```

They are optional so that an application on another store carries neither, and a postgres data source
refuses to start without them — `pg-query-stream` is what a cursor is opened through, so it is what
[`stream`](#a-findall-that-names-no-limit) reads a large table with.

`schemaManagement` says who makes the database match your entities, and every sql data source has to
state it. There is no default because there is no answer that is safe everywhere:

| Value | What happens | When it is right |
|---|---|---|
| `'synchronize'` | Zibri alters the database to match your entity classes on every boot | While the model is still moving and nothing stored matters yet |
| `'migrations'` | Only the data source's own migrations change the schema | Anywhere real data lives |
| `'external'` | Zibri issues no ddl at all | The schema belongs to someone else — a dba, another service, a separate migration tool |

`'synchronize'` issues the `ALTER` and `DROP` statements needed to make the database agree with the
classes. Rename a property and the old column goes, taking what was in it. It also runs after
migrations, so it can undo one. Use it while you are still shaping the model, and move to
`'migrations'` before there is anything worth keeping.

Saying `'migrations'` and shipping none is refused at boot, because nothing would ever create a
table — say `'external'` if that is deliberate.

Every data source you define has to be listed in your application options, and one that is not is
refused at boot: a data source the application meant to use connects to nothing, and the first query
is where you would otherwise find out. Where defining one is not the same as intending to run it —
a shared module offering several for its callers to choose between, or a factory that builds one per
call — say so on the declaration:

```ts
@DataSource({ allowOrphan: true })
class ReportingDataSource extends PostgresDataSource {
    entities: Newable<BaseEntity>[] = [];
    schemaManagement: SchemaManagement = 'external';
}
```

### Using ValKey
Next to Postgres, Zibri ships a `ValKeyDataSource`. It is configured the same way and exposes the exact
same repositories, so everything below (filters, transactions, migrations, change sets, soft deletes)
works with it as well:

```ts
// src/data-sources/cache-db/cache-db.data-source.ts
import { BaseEntity, DataSource, Newable, ValKeyDataSource, ValKeyOptions } from 'zibri';

@DataSource()
export class CacheDbDataSource extends ValKeyDataSource {
    options: ValKeyOptions = {
        host: 'localhost',
        port: 6379,
        keyPrefix: 'my-app'
    };

    entities: Newable<BaseEntity>[] = [Session];
}
```

`@valkey/valkey-glide` is an optional peer dependency, install it when you use this data source:

```bash
npm i @valkey/valkey-glide
```

#### How entities are stored
Every entity becomes a hash under `{keyPrefix}:{tableName}:{id}`, with one json encoded value per
property. All ids of an entity are kept in the set `{keyPrefix}:{tableName}:ids` so that finding
entities never has to scan the whole keyspace, and many to many relations are stored as a set of the
related ids under `{keyPrefix}:{tableName}:{id}:{property}`.

The `keyPrefix` is what separates multiple data sources (or multiple apps) that share one server. It
is also the scope of a backup: `createBackupData` dumps exactly the keys below that prefix.

#### Differences to a sql data source
Valkey is a key value store, so a few things behave differently than they do with Postgres:

- **Filtering happens in the app.** Valkey cannot filter hashes server side, so a `findAll` loads the
  entities of that type and applies the where filter in process. Filters are therefore identical in
  behaviour but not in cost — prefer narrow entity types over huge ones.
- **Transactions are atomic and serialize per row, by a different mechanism.** Valkey has no
  interactive transactions, it can only apply a queued batch atomically (`MULTI` / `EXEC`). A
  `Transaction` therefore buffers every write until `commit` and applies them in one batch. To get
  the isolation that buys nothing on its own, it takes a grant on each row key as the write is
  buffered and holds it until the transaction ends — the same effect as a row lock, so two
  transactions writing the same entity run one after the other and two writing different ones do not
  wait for each other. Index updates are left free, exactly as a database does not hold an index
  locked for a transaction that inserted into it.

  Two things still differ from Postgres. Readers outside the transaction are not blocked; they see
  the pre-commit state, because nothing is applied until `EXEC`. And a cycle of transactions waiting
  on each other's rows ends by timing out after
  `ZIBRI_DI_TOKENS.VAL_KEY_TRANSACTION_LOCK_TIMEOUT_IN_MS` (ten seconds by default) rather than by
  being detected, so a deadlock costs the wait instead of being reported the instant it forms.

  `startTransaction` still ignores the isolation level and logs a warning when one is passed.
- **Migrations only rewrite data.** There is no schema, so `addPropertyToEntity` writes the default
  (or null) into the stored hashes and `changePropertyOfEntity` moves a value to its new field name.
  A changed type needs no migration at all.
- **Filtering by a relation resolves it first.** A where filter on a relation has to load the related
  entities before it can be applied, so filtering by relations is considerably more expensive than
  filtering by a column of the entity itself.

### Defining entities

As you can see, the configuration of a data source is pretty straightforward. We also added our first entity to the data source, `Test`:

```ts
// src/models/test.model.ts
import { BaseEntity, Entity, Property } from 'zibri';

@Entity()
export class Test extends BaseEntity {
    @Property.string()
    value!: string;
}
```

An entity to be included in a data source needs to extend `BaseEntity`, which defines an id property.

In order for the data source to map the properties, you need to decorate them with the `@Property` decorator, the same way as for any other [model](./models.md).

A single column that has to be unique is expressed on the property itself with `@Property.string({ unique: true })`. When a *combination* has to be unique — neither column being unique on its own — declare it on the entity:

```ts
@Entity({ uniques: [['year', 'recipientId']] })
export class NumberInvoices extends BaseEntity {
    @Property.number()
    year!: number;

    @Property.string()
    recipientId!: string;

    @Property.number()
    number!: number;
}
```

The property names are checked against the entity, so a typo is a compile error rather than a constraint that silently covers the wrong columns. Besides rejecting duplicates, this is what [`upsert`](#changing-a-value-based-on-what-is-stored--upsert) needs in order to have at most one row to change.

A write that would leave two rows carrying the same values is refused with a `UniqueConstraintViolationError`, whose `properties` name what is already taken. Every data source answers the declaration that way, so code that reacts to a duplicate — retrying, reporting it, falling back to a read — works the same wherever the entity is stored.

> **Adding `uniques` to an entity that already has data.** The constraint cannot be created if rows already violate it, so a table that accumulated duplicates first has to be cleaned up. Under `schemaManagement: 'synchronize'` this surfaces as a failure on the next boot, so check the table before deploying the change.

#### Unique among only some rows

A `where` narrows which rows a unique declaration covers, so the value stays free for every row the filter leaves out. Both places take it, and `whereFor` names the entity the filter is written against:

```ts
// src/models/membership.model.ts
import { Entity, Property, SoftDeleteEntity, whereFor } from 'zibri';

@Entity({
    uniques: [{ properties: ['tenantId', 'email'], where: whereFor<Membership>({ deleted: false }) }]
})
export class Membership extends SoftDeleteEntity {
    @Property.string({ unique: { where: whereFor<Membership>({ deleted: false }) } })
    inviteCode!: string;

    @Property.string()
    tenantId!: string;

    @Property.string()
    email!: string;
}
```

`whereFor` is what type-checks the filter: a property decorator receives its options before it knows which class it was written on, so the entity has to be named for its columns and their value types to be checked. A filter that did not go through it is not accepted, which is what keeps a mistyped column a compile error.

The filter compares properties against plain values — a string, a number, a boolean or null — because it becomes part of the schema rather than part of a query. Anything else is refused while the schema is built.

**On a `SoftDeleteEntity` this is not optional.** A soft deleted row is present and absent at once, and both readings are ordinary: an address that a deleted account no longer holds is what lets somebody register again, while one that stays taken is how deleting an account stops being a way to shed its history. Nothing in `unique: true` says which is meant, so a soft delete entity that does not answer is refused where it is declared:

```
Account.email: "unique" on a soft delete entity has to say whether soft deleted rows still hold the value.
Add "where: whereFor<Account>({ deleted: false })" to it so a deleted row stops occupying the value,
or "where: {}" to keep the value taken for good.
```

An empty filter is how the second answer is written down. Restoring a soft deleted row can then fail, because the value it held may have been taken while it was gone — which is the same conflict any other write gets, at the point the row comes back.

A key covering only some rows is an `upsert` target like any other, and the rows it leaves out are not in its way. An `upsert` identified by an account's email lands on the live row holding that address, and inserts beside the deleted ones that still hold it.

Indexes are declared the same way — `@Property.string({ index: true })` for a single column, and on the
entity for a lookup that uses several:

```ts
@Entity({ indexes: [['tenantId', 'status']] })
export class Order extends BaseEntity {
    @Property.string()
    tenantId!: string;

    @Property.string()
    status!: string;

    @Property.date({ index: true })
    placedAt!: Date;
}
```

The order of a group is the order of the index, and an index answers a lookup by any leading part of
itself: `['tenantId', 'status']` covers a lookup by `tenantId`, where one by `status` alone reads the
table. A unique declaration comes with an index of its own, so a column that is unique needs no
second one.

Each key is declared once. `primary`, `unique` and `index` beside each other on the same property are
refused while the class is being declared, as is a group that names a column which is already unique
on its own — that column matches at most one row wherever it sits in the group, so what follows it is
never read. So is one key written twice: two unique groups over the same columns, or a group of one
column that already carries the `index` flag. Each refusal names the class, the columns and the
declaration to drop.

A property that declares `index` and a group that begins with the same column stand next to each
other. They are two lookups — one column, and that column with more beside it — so both are declared.

#### What a property holds

The kinds a property can be, the number formats and what object and array properties hold are the
same for entities as for any other model, see [models](./models.md). A value is read back from the
data source as the type its property declares.

Filters are the one place a number can be written as something other than what the property holds.
A bound on a `bignumber` can be a plain number or a `bigint`, so `{ total: { greaterThanEquals: 0 } }`
needs no `BigNumber` around the zero. A plain number property takes plain number bounds.

### Accessing the data source
To access data from the data source, you use repositories for specific entities. They can simply be injected without needing you to define them:

```ts
// src/services/test.service.ts
import { InjectRepository, Repository } from 'zibri';

import { TestCreateData, TestUpdateData } from '../models';

export class TestService {
    constructor(
        @InjectRepository(Test)                    // The last 2 generics are not required
        private readonly testRepository: Repository<Test, TestCreateData, TestUpdateData>,
    ) {}
}
```

Outside a constructor — a helper function, a cron job, a migration — `repositoryTokenFor` resolves the same repository:

```ts
import { inject, KeysetPage, repositoryTokenFor } from 'zibri';

const testRepository: Repository<Test, TestCreateData, TestUpdateData> = inject(repositoryTokenFor(Test));
```

The examples below are written against that name.

A repository always exposes the methods:
- findAll
- findAllPaginated
- stream
- findOne
- findById
- count
- exists
- createAll
- create
- updateAll
- updateById
- upsert
- deleteAll
- deleteById

The full, detailed definition can be found under the [repository typedoc](./generated/classes/data-source_repository.Repository.html).

`findOne` and `findById` throw when nothing matches, because reading one specific thing that is not
there is usually a bug rather than a result. When it is a result — checking whether a name is taken,
resolving something optional — say so and get `undefined` instead:

```ts
async function findExisting(): Promise<Test | undefined> {
    return await testRepository.findOne({ where: { value: '42' }, required: false });
}
```

The return type follows the flag, so the case has to be handled where it can happen and nowhere else.

A `findAll` that names no limit throws when more than ten thousand rows match, so that a read which
outgrows the heap says so. Say what is wanted instead:

```ts
async function readSome(): Promise<void> {
    await testRepository.findAll({ take: 100 });       // at most this many
    await testRepository.findAllPaginated(1, 100);     // a page at a time
    await testRepository.findAll({ take: 'all' });     // every row that matches
}
```

A page comes with the total that belongs to it. `findAllPaginated` reads the rows and counts them as
of one moment, so `items` and `totalAmount` describe the same table, and both narrow by the same
[scopes](#restricting-which-rows-a-caller-may-see) — "20 of 137" is 137 rows this caller may see.

Every read that takes part of a result is ordered down to the single row, by primary key after
whatever order was asked for. That is what makes a page a page: an order that leaves two rows
interchangeable leaves it to the data source which of them a position holds, and a table that is
being written to answers differently each time it is asked. Say what the order should be —
`defaultOrder` on the entity, or `order` on the call — and the primary key settles what is left. An
order can also reach through a relation: see [Reading relations](#reading-relations).

Each page is its own read, so a walk through a table sees every page as that page is asked for. A row
written before the walk reaches its position moves every page after it, which is what page numbers
cost. `findAllAfter` reads by cursor instead, and continues from the row the last page ended at:

```ts
async function remindEveryone(): Promise<void> {
    let cursor: string | undefined = undefined;
    do {
        const page: KeysetPage<Test> = await testRepository.findAllAfter(cursor, 100, { where: { value: 'new' } });
        for (const test of page.items) {
            await testRepository.updateById(test.id, { value: 'reminded' });
        }
        cursor = page.nextCursor;
    }
    while (cursor != undefined);
}
```

**Every row that exists when the walk starts is handed back exactly once**, however much is written
while it runs. Rows written during it are reached when they sort after the cursor and passed over
when they sort before it — that is what "after this row" means, so order by properties that hold
still: editing a row's ordering property mid-walk can move it across the cursor, and it is then read
twice or not at all.

`totalAmount` counts what the filter matches, so a walk reports the same total throughout rather than
counting down. `nextCursor` is absent on the last page. The cursor itself is opaque and belongs to
the read that produced it — the same order, the same filter — so hand it back as it came, and read
each walk with one filter. It is safe in a url or a json response, and `@Response.keysetPage()`
documents an endpoint that hands one out.

The order has to decide a position for every row, so `findAllAfter` refuses one that cannot: a
property that can hold null passes over every row that does, and one holding something with no order
has no "after". The primary key is appended for you, so an order of your own only has to be one worth
reading in.

Which of the three to reach for: `findAllPaginated` for a numbered page someone clicks, `findAllAfter`
for a walk that spans requests, and `stream` for one that does not — a job reading everything in one
go, holding only part of it at a time.

`take: 'all'` still hands you every row at once. When the point is that they do not fit, `stream`
reads them without holding them:

```ts
async function archiveEveryone(): Promise<void> {
    for await (const test of testRepository.stream({ where: { value: 'new' } })) {
        await testRepository.updateById(test.id, { value: 'archived' });
    }
}
```

Only a bounded part of the result is in memory at any moment, and `break` stops the reading rather
than leaving the rest to be fetched. A stream is narrowed by the same [scopes](#restricting-which-rows-a-caller-may-see)
every other read is, and each row goes through the same decryption, so what it hands you is what
`findAll` would have.

A stream takes no `take`, no `skip` and no order. The first two are what `findAll` is for. The order
is missing because not every data source can give one: ordering means comparing all of the rows, and
a data source that filters in the application would have to hold every one of them to do it — which
is the thing a stream exists not to do. Order what you keep, or use `findAll` with an order and the
bound that comes with it.

Asking how many there are, or whether there are any, is its own question and does not read them:

```ts
async function howMuchIsLeft(): Promise<void> {
    const open: number = await testRepository.count({ where: { value: 'new' } });
    const anyLeft: boolean = await testRepository.exists({ where: { value: 'new' } });
}
```

Both narrow by the same scopes a read does, so a count reports what the caller may see rather than
what is stored. `count` has no upper bound — how large something is stays answerable after it has
grown past what fits in memory. `exists` asks for a single row and discards it, so no relation is
loaded and nothing is decrypted for an answer that is a yes or a no.

`updateAll` and `deleteAll` answer with how many entities they changed. The entities themselves are
handed back only when they are asked for:

```ts
async function archive(): Promise<void> {
    const archived: number = await testRepository.updateAll({ value: 'new' }, { value: 'archived' });
    const rows: Test[] = await testRepository.updateAll({ value: 'new' }, { value: 'archived' }, { returnUpdated: true });
    const removed: number = await testRepository.deleteAll({ value: 'archived' });
}
```

The return type follows the flag the same way `required` decides it on `findOne`. Asking for the
entities carries the bound `findAll` has: more than ten thousand matching is refused, before anything
is written, so a bulk write that outgrows the heap says so instead of doing it. A count has no such
limit — it is what an unbounded update is for.

#### What a write hands back

Every write answers with the rows as they now stand — every column of them, not only the ones you
wrote, and the same as finding them would give.

Relations are the part you decide. Name them on the options the same way [a read names
them](#reading-relations), and the entity's `defaultRelations` are used when you name none:

```ts
// src/models/team.model.ts
@Entity()
export class Team extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.oneToMany({ target: () => Seat, inverseSide: 'team' })
    seats!: Seat[];
}

// src/models/seat.model.ts
@Entity()
export class Seat extends BaseEntity {
    @Property.string()
    occupant!: string;

    @Property.manyToOne({ target: () => Team, joinColumn: 'teamId', inverseSide: 'seats', required: false })
    team?: Team;

    @Property.string({ format: 'uuid', required: false })
    teamId?: string;
}

// src/services/seat.service.ts
const seatRepository: Repository<Seat> = inject(repositoryTokenFor(Seat));

async function moveSeat(seatId: string, teamId: string): Promise<Seat> {
    return await seatRepository.updateById(seatId, { teamId }, { relations: { team: true } });
}
```

A relation lives in rows beside this one, so resolving one is a read of its own, taken once the write
has landed. A write that has no relations to resolve answers on its own.

`createAll`, `updateAll` and `deleteAll` take the same option and answer the same way. Their read
covers the whole batch, so asking a bulk write for its rows costs one read however many rows come
back.

#### Reading relations

Every read takes the same option, and a relation of a relation is asked for by naming it in turn:

```ts
async function readSeats(): Promise<void> {
    await seatRepository.findAll({ take: 100, relations: ['team'] });
    await seatRepository.findAll({ take: 100, relations: { team: true } });
    await seatRepository.findAll({ take: 100, relations: { team: { seats: true } } });
}
```

It goes as deep as the relations go, and every level is one read of its own — so what a tree asks for
is what it costs. A relation nobody named comes back unset, which is not the same as empty.
`defaultRelations` on the entity says what every read of it resolves; `relations` on the call takes
the place of that rather than adding to it, and `relations: []` reads the row on its own.

An order reaches through a relation the same way:

```ts
async function readSeatsByTeam(): Promise<void> {
    await seatRepository.findAll({ take: 100, order: { team: { name: 'ASC' } } });
    await seatRepository.findAll({ take: 100, order: { team: { name: 'ASC' }, occupant: 'ASC' } });
}
```

An order reaches through a relation that holds one row: "the team's name" names one value, and "the
seats' occupants" names none in particular.

Ordering by a relation resolves it, and so does filtering on one — there is no comparing by a value
that has not been read. Neither puts it on the rows you get back: what a read answers with is what
its own `relations` asked for, so the same rows come back however they were found and sorted.

#### Two people editing the same thing

Last write wins. That is right for most properties and silent data loss for the ones two people edit
at once: both read, both save, the second one lands, and neither is told the first ever happened.

The property that must not be lost that way says so, and an update naming it then has to say what it
was:

```ts
// src/models/company.model.ts
@Entity()
export class Company extends BaseEntity {
    @Property.string({ optimisticLocking: true })
    name!: string;
}

// src/services/company.service.ts
const companyRepository: Repository<Company> = inject(repositoryTokenFor(Company));

async function rename(id: string, name: string, seen: string): Promise<void> {
    await companyRepository.updateById(id, { name }, { where: { name: seen } });
}
```

The condition is checked as part of the write, so nothing can slip in between, and the update lands
only if the value is still the one the edit was based on.

When it does not, what comes back depends on what the caller may see. A row they can read changed
under them, and they are told so — a `ConflictError`, so the client can read it again and show the
two versions. A row they were never allowed to see is a `NotFoundError`, exactly as if it did not
exist, because any other answer would confirm the id to somebody who cannot read it. The difference
is decided by reading the row again through its [scope](#scopes) rather than by which condition
failed, so a scoped entity never leaks which of its rows are real.

The unit is the property, so one person editing `name` and another editing `phone` do not collide.
Locking on a property you are *reading* rather than writing works the same way — `{ where: { price:
seenPrice } }` alongside a write to `discount` — which is what makes this worth doing over a
row-level version counter, which would clash on both.

The expected value has to come from the caller because nothing on the server has it: by the time the
update arrives, reading the property returns the value that already includes the other write. So the
declaration cannot fill the condition in, only insist there is one — writing a locked property with
no condition on it is refused. Name it with no value to overwrite regardless:

```ts
async function renameRegardless(id: string, name: string): Promise<void> {
    await companyRepository.updateById(id, { name }, { where: { name: undefined } });
}
```

Which is told apart from having forgotten by the property being named at all, so a filter you built
that came out empty is still refused.

A filter asking for a value a property cannot hold is answered with no rows, rather than with an
error. A property declares its format, so a value outside that format names nothing, and every method
answers that the way it answers any other filter that matches nothing:

```ts
async function lookUpAMistypedId(): Promise<void> {
    await testRepository.findAll({ where: { id: 'not-an-id' } });     // []
    await testRepository.findById('not-an-id', { required: false });  // undefined
    await testRepository.findById('not-an-id');                       // NotFoundError
}
```

A path or query parameter somebody mistyped is a missing row, which is what makes it safe to hand one
straight to the repository. Naming the format on the parameter as well — `@Param.path('id', { type:
'string', format: 'uuid' })` — still buys something: the request is refused as invalid input before
the handler runs, which tells the caller more than an empty result does.

Listing several values keeps the ones that are possible, so `{ oneOf: ['not-an-id', realId] }` still
finds `realId`.

### Using one entity in multiple data sources
An entity normally belongs to exactly one data source, which is why `@InjectRepository(Test)` does not
have to name one. Sometimes the same entity should live in several though, for example when a valkey
data source mirrors entities that postgres owns.

That has to be declared on the entity:

```ts
@Entity({ allowDuplicate: true })
export class Session extends BaseEntity {
    @Property.string()
    token!: string;
}
```

Adding an entity to a second data source without `allowDuplicate` fails at startup — that is almost
always a copy-paste mistake, and silently writing to the wrong store is worse than not starting.

Once an entity is duplicated, its repository can no longer be resolved by the entity alone, so the
data source has to be named:

```ts
export class SessionService {
    constructor(
        @InjectRepository(Session, DbDataSource)
        private readonly sessions: Repository<Session>,
        @InjectRepository(Session, CacheDbDataSource)
        private readonly cachedSessions: Repository<Session>
    ) {}
}
```

Injecting a duplicated entity without a data source throws an error that lists the data sources it
belongs to. The same applies to `repositoryTokenFor(Session, DbDataSource)` when you resolve
repositories dynamically.

`MigrationEntity` is the built in example of this: every data source keeps track of its own
migrations, so it is marked `allowDuplicate` and each data source resolves its own migration
repository.

### Filtering data
In most cases you probably don't want to get all entities from a data source, but a filtered selection. For that all retrieving methods have an optional where filter property:

```ts
async function findByValue(): Promise<void> {
    // returns all test entities where value is exactly '42'
    await testRepository.findAll({ where: { value: '42' } });
    // returns all test entities where value ends with '42'
    await testRepository.findAll({ where: { value: { iLike: '%42' } } });
    // returns all test entities where value ends with '42' AND is not '42'
    await testRepository.findAll({ where: { value: { iLike: '%42', not: '42' } } });
    // returns all test entities where value either:
    // - ends with '42' AND is not '42'
    // - OR is '43'
    await testRepository.findAll({ where: { value: [{ iLike: '%42', not: '42' }, '43'] } });
    // returns all test entities where value starts with 'rent' AND ends with '2026'
    await testRepository.findAll({ where: { value: { like: ['rent%', '%2026'] } } });
}
```

`like`, `iLike` and `fuzzyLike` take one value or several, and several means every one of them has to
hold. Every other operator says what
it means once: a list under `oneOf` is a list of values the property may be.

Text is ordered by the application's default locale, so `after` and `before` sort alphabetically
rather than by the bytes the text is written with, and a filter agrees with an `order` over the same
property. [Localization](./localization.md) describes that order and what an application supporting
several languages has to say about it.

An id is always a uuid the framework generates. When rows are named by something you choose — a slug,
a key, an id from another system — give that its own property and declare it `unique`, rather than
writing it into the id. A data source resolves a unique property directly, so looking a row up by one
costs what looking it up by id costs.

Everything a filter carries is data, never part of the query. A search term forwarded from a request,
an id taken out of a url, the name of a field inside a json object — each is handed to the data source
as a value, so none of them can change what the query asks for. Filters are the supported way to turn
caller input into a query, and building one out of request data needs no escaping of your own.

#### Searching for something similar

`fuzzyLike` finds the values that resemble what you searched for, rather than the ones that match it.
`minSimilarity` is a percentage between 1 and 99 and defaults to 30 — 1 matches nearly everything, 99
is close to an exact match:

```ts
@Entity()
export class Contact extends BaseEntity {
    @Property.string()
    name!: string;

    @Property.string({ fuzzySearchable: false })
    notes!: string;
}

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

`fuzzySearchable: false` takes the lookup away and refuses the search with it: nothing is kept for the
property, and a `fuzzyLike` naming it is refused rather than answered slowly. Declare it on a column
that is written far more often than it is searched.

A search is also refused where a similarity says nothing about the values — a property holding a
uuid, one of an enum, a hashed value or an encrypted one. Each of those is answered exactly by `is`
or `oneOf` instead.

#### Filtering inside an object property

`where` reaches into an object property, and the properties inside it take the same operators as the
ones on the entity itself:

```ts
class ProductMetadata {
    @Property.string({ required: false })
    color: string | undefined | null;
}

@Entity()
export class Product extends BaseEntity {
    @Property.object({ cls: () => ProductMetadata, required: false })
    metadata: ProductMetadata | undefined | null;
}

const productRepository: Repository<Product> = inject(repositoryTokenFor(Product));

async function findByColor(): Promise<void> {
    // returns all products whose metadata says the color is red
    await productRepository.findAll({ where: { metadata: { where: { color: 'red' } } } });
    // returns all products whose metadata names no color
    await productRepository.findAll({ where: { metadata: { where: { color: null } } } });
}
```

`null` there asks for a property written as null together with one that was never written, because a
value left undefined is absent once it is stored and the two are the same thing to whoever reads it
back. `{ not: null }` answers with exactly the rows `null` leaves out, so the two together account
for every row that has the object at all. A row whose object property is empty answers a question
about the properties inside it the way it answers a question about a color it has no metadata to
hold: it stays out of both halves.

An object property is also the one place where what a row holds can differ from what the entity says
it is, since the type is checked as the value is written and a declaration can change after that. A
filter that compares such a value raises `JsonValueTypeMismatchError`, naming the property, the type
it declares and the value found in its place, so the rows worth correcting are the ones you hear
about rather than the ones quietly left out of an answer.

#### Filtering a value of several shapes

A [property of several shapes](./models.md#a-value-of-several-shapes) is filtered by one filter per
shape, named `when` followed by the name of the shape. Each row is matched by the filter of the shape
it holds. Every shape has to be named: `false` matches no row of that shape, and `{}` every one.

```ts
import { OneOf } from 'zibri';

class Signup {
    @Property.string()
    email!: string;
}

class Invite {
    @Property.string()
    code!: string;
}

@Entity()
export class Lead extends BaseEntity {
    @Property.oneOf({ shapes: { Signup: { type: 'object', cls: () => Signup }, Invite: { type: 'object', cls: () => Invite } } })
    contact!: OneOf<{ Signup: Signup, Invite: Invite }>;
}

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

### Restricting which rows a caller may see
When an entity's rows are not all visible to everybody, say so on the entity. A scope is a function of the request: it returns the filter every query on that entity is narrowed by.

```ts
// src/entities/invoice.entity.ts
import { $ts, BaseEntity, Entity, Property, scopeFor, UnauthorizedError } from 'zibri';

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
export class Invoice extends BaseEntity {
    @Property.string()
    title!: string;

    @Property.boolean()
    paid!: boolean;

    @Property.string({ format: 'uuid' })
    userId!: string;
}
```

Wrap the function in `scopeFor<YourEntity>` so the filter is typed against the entity — its columns, their value types and the operators each one allows.

From then on every repository call is narrowed by it, reads and writes alike:

```ts
const invoiceRepository: Repository<Invoice> = inject(repositoryTokenFor(Invoice));

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

**A row the caller may not see is answered with a `404`.** That is deliberate: an id that exists and an id that does not are answered identically, so a route cannot be used to find out which ids are real.

**Writes are restricted too.** A row that would land outside the filter is refused with a `403`, whether it is created there or moved there by an update. Without that half a caller could create rows they are not allowed to see and then read them back entirely legitimately. An update is judged only on the columns it carries, so renaming a row you can already reach is never refused.

#### What a scope can answer
| Returns | Meaning |
|---|---|
| a filter | the caller sees the rows matching it |
| an array of filters | the caller sees the rows matching **any** of them |
| `undefined` | the caller is not restricted at all |
| `denyAll` | the caller sees no rows — an empty list, and `404` for a single row |
| *throws* | the request itself is refused, with whatever you threw |

`denyAll` and throwing answer different questions. A caller who is simply outside the data gets `denyAll`; a caller who may not ask at all gets the exception.

The array is what makes public rows and private rows in one table expressible:

```ts
// src/models/document.model.ts
@Entity({
    scope: {
        restrictedTo: scopeFor<Document>(ctx => {
            // anonymous callers see what is published
            if (!ctx.currentUser) return { published: true };
            // an administrator sees everything
            if (ctx.currentUser.roles.includes('admin')) return undefined;
            // everyone else sees what is published, plus their own
            return [{ published: true }, { userId: ctx.currentUser.id }];
        })
    }
})
export class Document extends BaseEntity {
    @Property.boolean()
    published!: boolean;

    @Property.string({ format: 'uuid' })
    userId!: string;
}
```

Whatever the handler filters by is combined with the scope rather than replacing it, in both directions: asking for `{ userId: someoneElse }` against the scope above still reaches the published rows, and only those.

The return value is an ordinary where filter and means exactly what it means anywhere else — including that a condition whose value is `undefined` is dropped rather than matching nothing. Reach for `denyAll` when a caller should see no rows, rather than building a filter out of a value that may be absent.

#### When both sides filter the same property
Both conditions have to hold, so they become the one condition that says both: two lists of allowed values become the values on both lists, two bounds become the one that allows the fewest rows, two patterns are both required, and a value of several shapes is combined shape by shape — a shape either side rules out is ruled out, and a shape whose two conditions contradict each other leaves the other shapes reachable. A pair nothing can satisfy, `{ userId: someoneElse }` against a scope of `{ userId: ctx.currentUser.id }`, is answered with no rows rather than queried.

What a property holds inside it is asked for both at once, of the same row. A scope requiring `{ payments: { where: { payerId: ctx.currentUser.id } } }` and a caller asking `{ payments: { where: { amount: { greaterThan: 100 } } } }` find the invoices with a payment of the caller's that is over 100 — not the ones with a payment of the caller's and some payment over 100.

#### Reading across the restriction
`currentUser` is undefined for an anonymous request and for anything running outside a request at all — a cron job, a migration, a startup task. The scope decides what that means, which is why the first example throws: an entity whose every row belongs to somebody has nothing to offer a caller who is nobody.

Anything that genuinely has to read across the restriction says so:

```ts
async function readAcrossTheRestriction(): Promise<void> {
    // every scope on the entity
    await invoiceRepository.findAll({ unscoped: true });
    // one of them by name
    await invoiceRepository.findAll({ unscoped: ['restrictedTo'] });
}
```

`unscoped` is accepted by every repository method. Each use is a place the restriction does not hold, so it is spelled out at the call rather than configured somewhere central — and searching for it lists every one of them.

#### Filling in who a row belongs to
A scope says which rows a caller may see; it cannot supply a value. A property default does that:

```ts
import { BaseUser, HttpRequestContext, WebsocketRequestContext, ZIBRI_REQUEST_CONTEXT_TOKENS } from 'zibri';

async function currentUser(): Promise<BaseUser<string> | undefined> {
    const ctx: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
    return await ctx?.get(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_USER);
}

@Entity()
export class Receipt extends BaseEntity {
    @Property.string({ format: 'uuid', default: async () => (await currentUser())?.id ?? '' })
    userId!: string;
}
```

Defaults are applied before the scope checks the write, so the value a default produces is the one that gets checked.

### Using transactions
A transaction can be started from a data source:

```ts
// src/services/test-batch.service.ts
import { InjectRepository, Repository, Transaction } from 'zibri';

export class TestBatchService {
    constructor(
        @InjectRepository(Test)
        private readonly testRepository: Repository<Test, TestCreateData, TestUpdateData>,
        private readonly dataSource: DbDataSource
    ) {}

    async doSomething(): Promise<void> {
        const transaction: Transaction = await this.dataSource.startTransaction();
        try {
            const test1: Test = await this.testRepository.create({ value: '42' }, { transaction });
            const test2: Test = await this.testRepository.create({ value: '43' }, { transaction });
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
    }
}
```

A transaction holds something from the moment it starts until it commits or rolls back: a connection
out of the pool, and a grant on every row it writes. The `catch` above is what hands those back when
the work fails, and it is worth writing.

A transaction that reaches neither a commit nor a rollback is rolled back once it has sat idle for
ten seconds, and everything it held is handed back. The clock runs from the last thing it did, so a
transaction that keeps working keeps its full allowance however long it runs. A transaction that
waits on something slow between two of its writes says so when it starts:

```ts
async function startPatientTransaction(): Promise<Transaction> {
    return await inject(DbDataSource).startTransaction({
        idleTimeoutInMs: 60000
    });
}
```

Set it to `0` for a transaction that may sit idle for as long as it likes.

### Handling migrations
Migrations are provided on the data source, next to its entities — the `migrations` property on
[`DbDataSource`](#defining-a-data-source) above lists them, in the order they are written.

Let's take a look at what the `RenameValuePropertyMigration` does.

For this we assume that the entity `Test` had a property before that was called `oldValue`, which has been renamend to the current property `value`. The migration handles that rename:

```ts
// src/data-sources/db/migrations/rename-value-property.migration.ts
import { Injectable, SemVerVersion } from 'zibri';

@Injectable()
class RenameValuePropertyMigration extends Migration {
    version: SemVerVersion = '0.0.1';

    constructor() {
        super(DbDataSource);
    }

    override async up(transaction: Transaction): Promise<void> {
        await this.dataSource.changePropertyOfEntity(Test, 'oldValue', { type: 'string', name: 'value' }, transaction);
    }

    override async down(transaction: Transaction): Promise<void> {
        await this.dataSource.changePropertyOfEntity(Test, 'value', { type: 'string', name: 'oldValue' }, transaction);
    }
}
```

`down` undoes what `up` did. It is worth writing even when you cannot imagine needing it: it is what [going back](#going-back) runs, and a release that has to be rolled back is exactly the release nobody planned for.

#### Versioning
As you can see, each migration needs to have a version for which it should run. That version is compared against the global one provided to zibri, which is the package.json version by default. It is the same version your routes declare themselves against, so one number says both which api a build serves and which schema it expects.

A version says which app versions a schema state belongs to, so **several migrations share one whenever a release carries more than one schema change** — the ordinary case. Which migration a record is about is its class name instead, and that is what decides whether it has run and which record a revert removes. Two migrations therefore need two distinct class names, and renaming one after it has shipped makes it look unapplied.

On boot, every migration up to and including the app's version that the database has not recorded yet is applied, in the order the data source lists them.

#### Going back
An app whose database has already been migrated **past** its own version refuses to start, and says which migrations it found:

```
This app is version 1.2.0, but its database has already been migrated to "AddInvoiceTable" (1.3.0).
Running an older instance against a newer schema is not supported, so it refuses to start rather
than reverting the schema that the newer instances are using.
```

It refuses rather than reverting because the schema is shared. An instance arriving late — a rollback, a restart, a scale event — would otherwise take the schema away from the instances already serving on it, and a `down()` that drops a column takes the data with it.

Rolling back past a migration is therefore something you do on purpose, in this order:

1. stop the instances running the newer version
2. `await dataSource.revertMigrationsAfter('1.2.0')` — runs `down()` for everything above that version, in the reverse of the order it was applied in
3. deploy the older build

Doing step 2 while a newer instance is still serving takes the schema out from under it, which is why step 1 comes first.

Note what this means for a normal rolling deploy: while it is in progress, instances of both versions are live at the same time, and the framework cannot prevent that — it does not control your orchestrator. Keep a migration backward compatible with the version before it (add a nullable column, do not rename one in place; remove the old column in a later release) and that window is safe.

#### Running more than one instance
Schema setup — creating the migration table, running migrations, and whatever `schemaManagement` asks for — happens inside a lock that every instance of your deployment competes for. The first instance to boot sets the schema up and the rest find the work already done.

Without it, three replicas starting together all read an empty migration table and all run the same migration, and all issue the same `CREATE TABLE`. That surfaces as `duplicate key value violates unique constraint "pg_type_typname_nsp_index"` — a Postgres *catalog* index, which names nothing about your application — and the instances that lose crash-loop.

Nothing to configure. `PostgresDataSource` uses `pg_advisory_lock`, `ValKeyDataSource` uses a key with a time to live. A custom data source implements `schemaLock` itself; it is on `DataSourceInterface` rather than optional, because a data source that cannot lock lets concurrent writers corrupt each other.

This is the one lock in the framework that is not a [lease](./leases.md), and it cannot be: a lease is a row in a table that schema setup has not created yet. Everything else that needs one replica to go first uses `LeaseService` — `schemaLock` is not for application code, which is why it is `protected`.

An instance that dies mid-setup would otherwise block every other instance forever, so acquisition is bounded by `ZIBRI_DI_TOKENS.SCHEMA_LOCK_TIMEOUT_IN_MS` (one minute by default) and fails loudly instead:

```ts
import { defineProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({ token: ZIBRI_DI_TOKENS.SCHEMA_LOCK_TIMEOUT_IN_MS, useFactory: () => Ms.MINUTE * 5 })
```

Raise it if your migrations legitimately take longer than that to run.

### Making your own writes safe across instances

There are two tools here and they are not interchangeable. Picking the wrong one produces something that looks safe and is not.

#### Changing a value based on what is stored — `upsert`

When the new value depends on the current one — a counter, a stock level, a running total — read-modify-write is the wrong shape no matter what you wrap it in. Use `upsert`, which leaves no window for another writer to interleave in:

```ts
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

The properties you identify the row by have to be declared together on the entity, in any order —
that is the `uniques: [['year', 'recipientId']]` on [`NumberInvoices`](#defining-entities) above.

Without that declaration the identity does not name at most one row, and the call is refused rather than quietly picking one of them. `increment` is only offered on numeric properties; every other property takes `{ set: value }`.

It is safe to pass your `transaction`, and you should: the result comes back before the transaction commits, so you can use it while the transaction is still open, and it rolls back with everything else. For invoice numbering that is the point — an abandoned invoice leaves no gap in the sequence.

A `belongsToOne` or `manyToOne` may be named in the row you insert, and is written as the foreign key it resolves to — pass the related entity or its id, whichever you have. The other three relation kinds keep their key somewhere else: on the row at the other end, or in a join table. Writing one of those means writing rows beside this one, and statements around the insert-or-update reopen the window `upsert` exists to close, so naming one is refused and says which property it means. Write that side separately, or use `create`.

What comes back has its relations resolved, the same as any other read — see [What a write hands back](#what-a-write-hands-back).

#### Changing every row that matches a filter — `updateAll`

`updateAll` carries the same guarantee without you doing anything. Claiming work by flipping a column is safe across instances: two callers cannot both come back with the same row, because the rows are held from the moment they are read until the change is committed. The loser gets the rows that are genuinely still theirs to take, which is usually none.

```ts
@Entity()
export class Job extends BaseEntity {
    @Property.string()
    status!: string;
}

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

> **Rows that start matching while it runs are not covered**, on any data source. `updateAll` changes what matched when it looked; a row inserted a moment later was never a candidate. Only a serializable isolation level covers that, and it is a limit rather than a defect — for claiming rows that already exist, which is what this is for, it does not arise.

#### Serializing work that is not a single value — a lease

When the thing you are protecting is *work* rather than a value — an import, a report, a third party call that must happen once — that is a [lease](./leases.md):

```ts
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

**Pick the narrowest key that makes the work correct.** `import:${feedId}` lets two feeds import at once; a plain `'import'` would serialize every import in the deployment. The key is a plain string and only callers using the same one wait for each other — prefix yours, the key space is shared with the framework's own.

> **A lease cannot protect a value.** A write made with `{ transaction }` only becomes visible on **commit**. Commit inside the lease body and a read-modify-write is perfectly safe — the window covers all three steps. Accept a transaction from the caller and commit it later, and it is not: the grant is handed back while the write is still invisible, so the next holder reads a value that has already been claimed. Both callers held the grant, over a window that ended too early, and nothing errors.
>
> A lease cannot close that gap by holding longer, because it does not own the caller's transaction and has no way to know when it commits. A grant and a transaction have independent lifetimes, and an invariant spanning both is only as strong as the shorter one. That is what [`upsert`](#changing-a-value-based-on-what-is-stored--upsert) above is for.
>
> Zibri warns when it catches this: if a write made while holding a lease used a transaction that is still open when the grant is released, you get a log line naming the lease. It is a runtime check on the path that actually ran, so treat it as a safety net rather than proof — a branch that never executes never warns.

#### Acquisition order

Anything holding more than one grant at a time can deadlock, and Zibri does not protect you from **inconsistent ordering**: if one caller takes `a` then `b` while another takes `b` then `a`, they wait on each other, and nothing at the point of acquisition can see that coming. Decide an order for your keys and keep to it.

This is not only about leases you take yourself. Transactions and `upsert` take grants of their own, so two transactions touching the same rows in opposite orders can reach the same place.

### ChangeSetRepository
The `ChangeSetRepository` is an extended version of a Repository, that automatically tracks who changed what & when.
It is automatically chosen with no further configuration on your end when the entity provided to `@InjectRepository` has a property called changeSets which is an array.

If you want to remove a property from tracking, you can set the `excludeFromChangeSets` flag:

```ts
// src/models/note.model.ts
import { ChangeSetEntity, Entity, Property } from 'zibri';

@Entity()
export class Note extends ChangeSetEntity {
    @Property.string({ excludeFromChangeSets: true })
    draft!: string;
}
```

#### A change and its record are one write

Every method that writes a change set takes a transaction over both, so a row and the change set
describing it arrive together or neither does. That holds for creating, updating, deleting,
resetting a change set and rolling back to one, in bulk as well as singly — and a rollback covers
every change set it walks through, so the row never stops between two of them.

Pass your own `transaction` and it is used instead, which is what puts the change sets in the same
unit as the rest of your work:

```ts
import { ChangeSetRepository } from 'zibri';

async function renameInside(noteRepository: ChangeSetRepository<Note>, id: string, transaction: Transaction): Promise<void> {
    // the note, its change set, and whatever else the transaction carries
    await noteRepository.updateById(id, { draft: 'rewritten' }, { transaction });
}
```

Who made the change is read from the request, so a write driven from a cron job, a migration or a
startup task records a change set with no user on it — the change is still tracked, and what is
absent is the person, because there was none.

### SoftDeleteRepository
The `SoftDeleteRepository` is an extended version of a `ChangeSetRepository`, which adds soft delete functionality.

### Reads and writes inside a request
A repository operation belongs to the request that asked for it. When that request runs out of the
time its route allows, the next operation is refused rather than issued, and a statement already
running is stopped where it runs when the store offers a way to do that. Both fail with the
`GatewayTimeoutError` the caller was answered with.

A statement inside a transaction is stopped the same way, and the transaction goes with it: nothing
it wrote is going to be asked for, so it rolls back and the rows it was holding are free again.

See [deadlines](./creating-endpoints.md#deadlines).

## See also
- [Models](./models.md) — the `@Property` decorators entities are declared with
- [Replication](./replication.md) — the shared data source every instance coordinates through
- [Leases](./leases.md) — the grant behind everything only one instance may do at a time
- [Cron](./cron.md) — cron jobs are persisted as entities in a data source
- [Application lifecycle](./application-lifecycle.md) — data sources are provided to the `ZibriApplication`
- [Encryption & Hashing](./encryption-and-hashing.md) — encrypting/hashing entity properties defined via `@Property`
- [Auth](./auth.md) — who the requesting user a `scope` restricts rows to is, and what a refused request answers