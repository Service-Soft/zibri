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
| `BaseEntity` | class | Base class entities must extend, defines an id property |
| `Entity` | decorator | Registers a class as an entity |
| `Property` | decorator | Maps a class property to a data source column, also used for validation |
| `Newable` | type | Helper type for referencing a class (constructor) |
| `InjectRepository` | decorator | Injects a `Repository` for a given entity into a constructor parameter |
| `Repository` | class | Generic repository exposing `findAll`, `findAllPaginated`, `findOne`, `findById`, `createAll`, `create`, `updateAll`, `updateById`, `deleteAll`, `deleteById` |
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
import { PostgresDataSource, PostgresOptions, BaseEntity, DataSource, Newable } from 'zibri';

import { Test } from '../../models';

@DataSource()
export class DbDataSource extends PostgresDataSource {
    options: OmitStrict<PostgresOptions, 'type' | 'entities'> = {
        host: 'localhost',
        port: 5432,
        username: 'postgres',
        password: 'password',
        database: 'db',
        synchronize: true
    };

    entities: Newable<BaseEntity>[] = [Test];
}
```

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

In order for the data source to map the properties, you need to decorate them with the `@Property` decorator. This is also used for validation.

### Accessing the data source
To access data from the data source, you use repositories for specific entities. They can simply be injected without needing you to define them:

```ts
// src/services/test.service.ts
import { InjectRepository, Repository } from 'zibri';

import { Test } from '../models';

export class TestService {
    constructor(
        @InjectRepository(Test)                    // The last 2 generics are not required
        private readonly testRepository: Repository<Test, TestCreateData, TestUpdateData>,
    ) {}
}
```
A repository always exposes the methods:
- findAll
- findAllPaginated
- findOne
- findById
- createAll
- create
- updateAll
- updateById
- deleteAll
- deleteById

The full, detailed definition can be found under the [repository typedoc](./generated/classes/data-source_repository.Repository.html).

### Filtering data
In most cases you probably don't want to get all entities from a data source, but a filtered selection. For that all retrieving methods have an optional where filter property:

```ts
// returns all test entities where value is exactly '42'
await this.testRepository.findAll({ where: { value: '42' } });
// returns all test entities where value ends with '42'
await this.testRepository.findAll({ where: { value: { iLike: '%42' } } });
// returns all test entities where value ends with '42' AND is not '42'
await this.testRepository.findAll({ where: { value: { iLike: '%42', not: '42' } } });
// returns all test entities where value either:
// - ends with '42' AND is not '42'
// - OR is '43' 
await this.testRepository.findAll({ where: { value: [{ iLike: '%42', not: '42' }, '43'] } });
```

### Using transactions
A transaction can be started from a data source:

```ts
// src/services/test.service.ts
import { InjectRepository, Repository } from 'zibri';

import { Test } from '../models';

export class TestService {
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

### Handling migrations
Migrations need to be provided on the data source:

```ts
// src/data-sources/db/db.data-source.ts
import { PostgresDataSource, PostgresOptions, BaseEntity, DataSource, Newable } from 'zibri';

import { Test } from '../../models';
import { RenameValuePropertyMigration } from './migrations';

@DataSource()
export class DbDataSource extends PostgresDataSource {
    options: PostgresOptions = {
        host: 'localhost',
        port: 5432,
        username: 'postgres',
        password: 'password',
        database: 'db',
        synchronize: true
    };

    entities: Newable<BaseEntity>[] = [Test];
    migrations: Newable<Migration>[] = [RenameValuePropertyMigration];
}
```

Let's take a look at what the `RenameValuePropertyMigration` does.

For this we assume that the entity `Test` had a property before that was called `oldValue`, which has been renamend to the current property `value`. The migration handles that rename:

```ts
// src/data-sources/db/migrations/rename-value-property.migration.ts
import { Injectable, Migration, Transaction, SemVerVersion } from 'zibri';

import { Test } from '../../../models';
import { DbDataSource } from '../db.data-source.ts';

@Injectable()
class RenameValuePropertyMigration extends Migration {
    version: SemVerVersion = '0.0.1';

    constructor() {
        super(DbDataSource);
    }

    override async up(transaction: Transaction): Promise<void> {
        await this.dataSource.changePropertyOfEntity(Test, 'oldValue', { type: 'string', name: 'value' }, transaction);
    }

    // eslint-disable-next-line typescript/require-await
    override async down(): Promise<void> {
        throw new Error('Not implemented yet.');
    }
}
```

#### Versioning
As you can see, each migration needs to have a version for which it should run. That version is compared against the global one provided to zibri, which is the package.json version by default.

### ChangeSetRepository
The `ChangeSetRepository` is an extended version of a Repository, that automatically tracks who changed what & when.
It is automatically chosen with no further configuration on your end when the entity provided to `@InjectRepository` has a property called changeSets which is an array.

If you want to remove a property from tracking, you can set the `excludeFromChangeSets` flag:

```ts
// src/models/test.model.ts
import { BaseEntity, Entity, Property } from 'zibri';

@Entity()
export class Test extends BaseEntity {
    @Property.string({ excludeFromChangeSets: true })
    value!: string;
}
```

### SoftDeleteRepository
The `SoftDeleteRepository` is an extended version of a `ChangeSetRepository`, which adds soft delete functionality.

## See also
- [Cron](./cron.md) — cron jobs are persisted as entities in a data source
- [Application lifecycle](./application-lifecycle.md) — data sources are provided to the `ZibriApplication`
- [Encryption & Hashing](./encryption-and-hashing.md) — encrypting/hashing entity properties defined via `@Property`