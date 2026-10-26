# Encryption and hashing
An encrypted property is stored encrypted and read back as plaintext. A hashed property is stored as
a one-way hash, for values you only ever compare, such as passwords. You mark both on the
`@Property.string` decorator. Encryption is [envelope encryption](./glossary.md#envelope-encryption): each value is encrypted with a data
key, and the data keys are encrypted with a [master key](./glossary.md#master-key) you provide.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `Property.string` | decorator | Marks a string property for encryption/hashing (among other things) |
| `HashString` | type | Type of a hashed property's value |
| `ScryptHashStrategy` | class | The default hash, for passwords and everything else guessable |
| `ScryptCost` | type | What a scrypt hash costs, via `ZIBRI_DI_TOKENS.SCRYPT_COST`. Defaults to `{ n: 131072, r: 8, p: 1 }` |
| `defaultScryptCost` | constant | The cost a scrypt hash has when you provide no `ZIBRI_DI_TOKENS.SCRYPT_COST`: `{ n: 131072, r: 8, p: 1 }` |
| `ScryptHashOptions` | type | What a scrypt hash is made with: the salt length, 16 bytes by default, and the cost |
| `Sha256HashStrategy` | class | Unsalted hash for values that must stay findable. Never for passwords |
| `BcryptHashStrategy` | class | Deprecated. Verifies bcrypt hashes, such as the password hashes of Zibri 2, see [verifying bcrypt hashes](#verifying-bcrypt-hashes) |
| `BcryptHashOptions` | type | How many salt rounds a bcrypt hash uses |
| `HashStrategyInterface` | interface | What a hash algorithm implements |
| `AesGcmEncryptionStrategy` | class | The default encryption, AES-256-GCM, for values and for the master key |
| `AesGcmEncryptOptions`, `AesGcmDecryptOptions` | type, type | What AES-256-GCM encrypts and decrypts with: the options every strategy is handed, and additional authenticated data the value is bound to |
| `ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS` | DI token | The key that encrypts the encryption keys. Required |
| `EncryptionMasterOptions`, `EncryptionMasterKey` | type, type | What `ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS` takes: the current master key and strategy and the old ones, and a master key: its id and what its strategy needs to use it |
| `MasterKeyReference` | class | Names a master key and its strategy without holding either, as a backup records the keys it needs |
| `EncryptionStrategyInterface` | interface | What an encryption algorithm implements, including a KMS or HSM backed one |
| `BaseEncryptOptions`, `BaseDecryptOptions` | type | What a strategy's `encrypt` and `decrypt` are handed: the key, its id, and the row the value is bound to |
| `EncryptionPropertyValue`, `EncryptAndDecryptOptions`, `EncryptPropertyValue`, `DecryptPropertyValue` | type, type, type, type | What the `encryption` option of `@Property.string` takes: `true`, or how the value is encrypted and decrypted |
| `HashPropertyValue` | type | What the `hash` option of `@Property.string` takes |
| `EncryptionBinding` | type | The row an encrypted value belongs to, so the value copied into another row is refused |
| `EncryptionString` | type | An encrypted value as it is stored, inside its envelope |
| `EncryptionContent`, `EncryptionUtilities` | type, class | What an encrypted value holds, its strategy, version, key id and the encrypted value, and turns an `EncryptionString` into it and back |
| `EncryptionServiceInterface`, `ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE` | interface, DI token | Encrypts and decrypts values, and creates, deprecates and counts the data keys |
| `EncryptionService` | class | Encrypts and decrypts values, and keeps the data keys. Replaceable through `ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE` |
| `EncryptOptions`, `DeleteEncryptionKeyOptions` | type, type | Which strategy encrypts a value and with what options, and whether deleting keys may delete the default one |
| `KeysInUse` | type | The keys the encrypted values depend on: the current master key, every master key a [data key](./glossary.md#data-key) is encrypted under, the data keys, and the data source storing them |
| `HashServiceInterface`, `ZIBRI_DI_TOKENS.HASH_SERVICE` | interface, DI token | Hashes values, compares a value with a hash, and says when a hash needs to be made again |
| `HashService` | class | Hashes values and compares them with hashes. Replaceable through `ZIBRI_DI_TOKENS.HASH_SERVICE` |
| `HashOptions` | type | Which strategy hashes a value, and with what options |
| `HashContent`, `HashUtilities` | type, class | What a hashed value holds, its strategy, version and the hash, and turns a `HashString` into it and back |
| `ZIBRI_DI_TOKENS.ENCRYPTION_STRATEGIES` | DI token | Overrides the available encryption algorithms |
| `ZIBRI_DI_TOKENS.HASH_STRATEGIES` | DI token | Overrides the available hash algorithms |
| `EncryptionKey`, `EncryptionKeyStatus` | entity, enum | A data key of a strategy, and whether it is the default, active or deprecated |
| `EncryptionKeyCreateData` | type | What a data key is created with |
| `EncryptionStrategyEntity`, `EncryptionStrategyStatus` | entity, enum | An encryption strategy as stored, with its keys, and whether it is the default, active or deprecated |
| `HashStrategyEntity`, `HashStrategyStatus` | entity, enum | A hash strategy as stored, and whether it is the default, active or deprecated |
| `EncryptionRotationCronJob` | cron job | Rewrites the values encrypted under deprecated keys and strategies, a bounded number of rows per run. Registered for you |
| `EncryptionRotationProgress` | entity | How far the rotation job is through the stored values |
| `EncryptionRotationFailure` | entity | A row the rotation job could not rewrite, and when it tries again |
| `RetiredKeyUsage` | type | What is still encrypted under the keys being retired, see [telling when a rotation is done](#telling-when-a-rotation-is-done) |
| `RetiredDataKeyUsage`, `RetiredMasterUsage`, `RetiredMasterKeyUsage`, `RetiredMasterStrategyUsage` | type, type, type, type | The parts of `RetiredKeyUsage`: a deprecated data key and how many values it encrypts, and the data keys and backups an old master key or strategy is needed for |

## Setting the master key
`ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS` is required, whether or not anything is encrypted:

```ts
// src/providers.ts
import { AesGcmEncryptionStrategy, defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS,
    useValue: {
        currentMasterStrategy: new AesGcmEncryptionStrategy(),
        currentMasterKey: { id: 'k1', value: process.env['MASTER_KEY'] }
    }
})
```

The master key encrypts the data keys, not your values. Data keys are generated per strategy and
stored in the key table. A copy of the database holds no master key, and rotating the master key
rewrites only the key rows. The keys of [encrypted backups](./backup.md#encrypting-backups) are
encrypted with it as well.

Old master keys and strategies go in `oldMasterKeys` and `oldMasterStrategies`. Key rows written under
an old key still decrypt, and are rewritten under the current one. A backup taken under an old key is
restored with it, so keep an old key listed for as long as you keep backups taken under it.
[`resolveRetiredKeyUsage()`](#telling-when-a-rotation-is-done) counts both.

## Defining encrypted/hashed properties
```ts
// src/models/integration.model.ts
import { BaseTenantEntity, Entity, HashString, Property } from 'zibri';

@Entity()
export class Integration extends BaseTenantEntity() {
    @Property.string({ encryption: true })
    accessToken!: string;

    @Property.string({ hash: true })
    inboundToken!: HashString;
}
```

`accessToken` is what your application calls the other service with, so it is encrypted and read
back. `inboundToken` is what the other service calls your application with, which is only compared,
so it is hashed. `encryption` and `hash` also take an options object in place of `true`.

Every value stored through a repository is encrypted or hashed. The same flags work on the string items of an array and on a string shape of `@Property.oneOf`, and each shape can name a strategy of its own.

A property holding an encrypted or hashed value stays out of [change sets](./glossary.md#change-set) unless it declares `excludeFromChangeSets: false`.

## Typing the create data
A hashed property is typed as `HashString` on the entity (a branded type), but you pass a plain `string` when you create one. The value only becomes a `HashString` once it is hashed.

An encrypted property is typed `string` in both.

Declare a separate create-data class that types the hashed property as `string`:

```ts
// src/models/credentials.model.ts
import { BaseEntity, Entity, HashString, OmitClass, Property } from 'zibri';

@Entity({ tenant: 'shared' })
export class Credentials extends BaseEntity {
    @Property.string({ hash: true })
    password!: HashString;
}

export class CredentialsCreateData extends OmitClass(Credentials, ['id', 'password']) {
    @Property.string({ hash: true })
    password!: string;
}
```

The exports `PasswordCredentials` and `PasswordCredentialsCreateData` are split the same way.

## Binding a value to its row
An encrypted value is bound to the row it was written to. A value copied into another row does not
decrypt. Someone who can write to the database, through an SQL injection, an admin screen that allows
too much or an import that trusts its input, cannot move a secret into a row they can read. The
binding is on by default.

A bound value is encrypted for the row it lands in, so `updateAll` on a bound property cannot write
one value to many rows at once. It reads the rows it matched, encrypts the value once per row, and
writes them in a single call. Above a hundred rows it logs a warning saying so. The cost is one
extra read, plus work for each row that matched.

A row inserted while such an update runs is not included. To run the read and the write as one unit,
pass a [transaction](./data-source.md#using-transactions) with the isolation level you need. Both
halves run inside it.

Turn the binding off with `bindToRow: false`, for a property you update in bulk:

```ts
// src/models/project.model.ts
import { BaseTenantEntity, Entity, Property } from 'zibri';

@Entity()
export class Project extends BaseTenantEntity() {
    @Property.string({ encryption: { bindToRow: false } })
    webhookSigningKey!: string;
}
```

Such a value can be written in bulk and can move between rows. It is still bound to the envelope it
was written with, so its key id and strategy cannot be edited underneath it.

The binding names the row only, so renaming a table or a column keeps every value readable. A value
moved into another encrypted column of the same row decrypts as well.

A data migration that rewrites rows under **new ids** has to decrypt and re-encrypt each value as it
goes.

A value stored without a binding decrypts as it stands, and gains one the next time its row is
written.

## Rotating a key
To rotate a key, make a new one the default and deprecate the old one. The values written under the
old key are rewritten in the background:

```ts
// src/services/rotate-key.function.ts
import { AesGcmEncryptionStrategy, EncryptionKey, EncryptionKeyStatus, EncryptionServiceInterface } from 'zibri';

export async function rotateKey(encryptionService: EncryptionServiceInterface, oldKeyId: string): Promise<void> {
    const replacement: EncryptionKey = await encryptionService.createKey(AesGcmEncryptionStrategy, {
        status: EncryptionKeyStatus.ACTIVE
    });
    await encryptionService.markKeyAsDefaultForStrategy(replacement.id, AesGcmEncryptionStrategy);
    await encryptionService.deprecateKey(oldKeyId);
}
```

`EncryptionRotationCronJob` is registered for you and does the rewriting: hourly, on one instance,
at most 500 rows per run. Each value is re-encrypted under the current key through its repository.

It also binds every value stored without a [binding](#binding-a-value-to-its-row), so
the binding covers the values already in the database too.

The job reads the stored values in passes. A pass starts when a key or strategy is retired that the
last finished pass did not look for, and once on every instance after it started. Each run continues
the pass where the last one stopped, and `EncryptionRotationProgress` holds how far it got. With
nothing retired, a run reads no stored values at all.

A row it cannot rewrite is recorded as an `EncryptionRotationFailure`, with the error, and logged once.
The job tries it again an hour later, then after a wait that doubles with every failure, up to a day.
The record is removed once the row is rewritten or deleted.

Register both entities in the data source that holds `EncryptionKey`.

Once the job has nothing left to do, delete the old key. Deprecating the *default* key throws: make
another key the default first.

## Telling when a rotation is done
`resolveRetiredKeyUsage()` counts what is still encrypted under every key being retired: the stored
values under each deprecated data key, and the data keys and recorded backups that need each entry of
`oldMasterKeys` and `oldMasterStrategies`:

```ts
// src/services/retired-keys.function.ts
import { EncryptionServiceInterface, RetiredKeyUsage } from 'zibri';

export async function findUnusedRetiredKeyIds(encryptionService: EncryptionServiceInterface): Promise<string[]> {
    const usage: RetiredKeyUsage = await encryptionService.resolveRetiredKeyUsage();
    return usage.dataKeys.filter(k => k.values === 0).map(k => k.keyId);
}
```

Each retired data key also names its `stuckRows`: the rows the rotation job could not rewrite, with
the error and when it tries again. A key with stuck rows still encrypts their values.

It counts what the framework stores: the values of the encrypted properties your models declare, the
data keys, and the backups recorded in the database. A value you encrypt yourself with `encrypt`, or
one in a column no model declares, is not counted, and the rotation job does not rewrite it either.
Rotate those yourself.

A backup that holds the data source the data keys are stored in brings its data keys back when it is
restored, so it counts towards the master keys they were encrypted under, whether or not the backup
itself is encrypted. A backup that does not hold that data source needs its data keys to still exist,
so it counts towards every data key there was when it was taken. Each backup records which keys it
needs when it is taken, in `masterKeys` and `dataKeyIds`.

The count reads every row of every entity holding an encrypted property, as one full pass of the
rotation job does, so call it when you mean to retire something.

## Reading a value as it is stored
Every read decrypts by default. Pass `autoDecrypt: false` to get the values exactly as they sit in the
data source instead:

```ts
// src/services/read-as-stored.function.ts
import { Repository } from 'zibri';

import { Integration } from '../models/integration.model';

export async function readAsStored(integrationRepository: Repository<Integration>): Promise<Integration[]> {
    return await integrationRepository.findAll({ autoDecrypt: false });
}
```

The stored value shows its envelope, such as `aes-256-gcm.v1.<keyId>.b.<iv>.<tag>.<ciphertext>`:
which strategy and key it was written with, and whether it is bound to its row. Use it to check how a
value is stored.

The properties come back as encryption strings. Writing one back through a repository encrypts it
again, ciphertext and all. Excluded properties are still removed.

## Deciding who reads the plaintext
An encrypted value is decrypted when it is read from the data source. With the options object instead of the boolean flag, `decrypt` decides this, and a callback receives the entity and the request context. For example, admins get the plaintext and other users do not.

The [exclude functionality](./excluding-properties.md) can be used for this as well, or in addition.

## Hashing a value you still need to find
A salted hash of the same input differs every time, so `where: { token: hash(presented) }` matches
nothing. A password is checked against a row you found by email. A token that *is* the lookup key,
such as a refresh token or a password reset token, arrives on its own, with nothing else in the
request to find its row by.

`Sha256HashStrategy` is unsalted, so the same value always produces the same hash and the column
stays searchable:

```ts
// src/models/api-token.model.ts
import { BaseTenantEntity, Entity, HashString, Property, Sha256HashStrategy } from 'zibri';

@Entity()
export class ApiToken extends BaseTenantEntity() {
    @Property.string({ unique: true, hash: { strategy: Sha256HashStrategy } })
    value!: HashString;
}
```

To find one, hash what the caller presented, exactly as it is stored:

```ts
// src/services/find-token.function.ts
import { HashServiceInterface, HashString, Repository, Sha256HashStrategy } from 'zibri';

import { ApiToken } from '../models/api-token.model';

export async function findToken(
    hashService: HashServiceInterface,
    tokenRepository: Repository<ApiToken>,
    presented: string
): Promise<ApiToken | undefined> {
    const value: HashString = await hashService.hash(presented, { strategy: Sha256HashStrategy });
    return await tokenRepository.findOne({ where: { value }, required: false });
}
```

> [!WARNING]
> Never use `Sha256HashStrategy` for a password, or anything else short enough to guess. Use it for
> random values such as `randomBytes(16)`. The strategy declares `deterministic: true`, and the hash
> service never uses a deterministic strategy as the default, but any property can name it.

The built-in password reset tokens and JWT refresh tokens are stored this way. A leaked copy of the
database holds no token that can be replayed against the API.

`unique` on a hashed property needs a deterministic strategy, named on the property. `unique` on an
encrypted property is refused, since one value is stored differently under each key it is encrypted
with.

## Writing to a hashed property
A hashed property takes **plaintext only**. Writing a value that is already a hash throws, such as
the `password` of a loaded entity handed back:

```ts
// src/services/rewrite-password.function.ts
import { Repository } from 'zibri';

import { Credentials } from '../models/credentials.model';

export async function rewritePassword(credentialsRepository: Repository<Credentials>, id: string): Promise<void> {
    const stored: Credentials = await credentialsRepository.findById(id);
    await credentialsRepository.updateById(id, { password: stored.password });
}
```

A read-modify-write that hands a loaded entity back does exactly this. A hash of the hash would lock
the user out for good. Leave the property off the update, or set it to a new plaintext.

## Encrypting or hashing a value yourself
To encrypt or hash a value yourself, inject `ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE` or `ZIBRI_DI_TOKENS.HASH_SERVICE`.

## Choosing the algorithms
By default scrypt and aes-256-gcm are used, with `Sha256HashStrategy` also registered so a property can ask for it by name. For a different algorithm, override `ZIBRI_DI_TOKENS.HASH_STRATEGIES` and/or `ZIBRI_DI_TOKENS.ENCRYPTION_STRATEGIES`.

One of the hash strategies you register is non-deterministic: an unqualified `hash: true` uses it,
and so does every stored password.

## Keeping the key material off the host
The strategy decides what `currentMasterKey.value` is: `EncryptionStrategyInterface<TKey>` takes the
key type as `TKey`, and every method that touches the key may be async. A strategy whose `TKey` is a
key handle, and whose `encrypt` and `decrypt` call out to a KMS, an HSM or Vault, fits in. Its
`options.key` is the handle: the plaintext goes to the KMS, and the key stays there:

```ts
// src/services/kms.encryption-strategy.ts
import { BaseDecryptOptions, BaseEncryptOptions, EncryptionStrategyInterface, EncryptionString } from 'zibri';

import { callKms, createKeyInKms } from './kms-client';

type KmsKeyHandle = { arn: string };

class KmsEncryptionStrategy implements EncryptionStrategyInterface<KmsKeyHandle> {
    readonly name: string = 'kms';
    readonly version: string = 'v1';
    readonly usableInMigrations: boolean = true;

    async encrypt(value: string, options: BaseEncryptOptions<KmsKeyHandle>): Promise<EncryptionString> {
        return await callKms('encrypt', options.key, value);
    }

    async decrypt(value: EncryptionString, options: BaseDecryptOptions<KmsKeyHandle>): Promise<string> {
        return await callKms('decrypt', options.key, value);
    }

    isBoundToRow(value: EncryptionString): boolean {
        return value.split('.')[3] === 'b';
    }

    async generateRandomKey(): Promise<KmsKeyHandle> {
        return { arn: await createKeyInKms() };
    }

    serializeKey(key: KmsKeyHandle): Buffer {
        return Buffer.from(key.arn, 'utf8');
    }

    deserializeKey(raw: Buffer): KmsKeyHandle {
        return { arn: raw.toString('utf8') };
    }
}
```

`usableInMigrations` says whether a strategy works while [migrations](./data-source.md#handling-migrations) run, which is before the application is initialized. Set it to `false` when what it calls is set up by a provider during initialization. A migration that encrypts or decrypts with such a strategy is refused, and the error names the strategy.

Use such a strategy as the **master** strategy. The data keys are then generated locally and wrapped
by the service, one network call per key and not one per value. As a *data* strategy, every read and
write becomes a network call.

> [!WARNING]
> Nothing checks a strategy of your own. Its `encrypt` has to put `options.keyId` in the envelope it
> returns, and it has to honor `options.binding`. A strategy that ignores `options.binding` writes
> values that are not bound to their row, and the
> [row binding](#binding-a-value-to-its-row) silently stops applying to them.

Zibri ships no KMS, HSM or Vault strategy.

## Setting the cost of a password hash
`ZIBRI_DI_TOKENS.SCRYPT_COST` sets the cost of a password hash. It defaults to
`{ n: 131072, r: 8, p: 1 }`, which takes about **128 MB of memory and a few hundred milliseconds per
hash**. Both grow with `n`. Size for the memory: it is taken per concurrent hash, so a burst of
logins is a burst of allocations.

```ts
// src/providers.ts
import { defineProvider, ScryptCost, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.SCRYPT_COST,
    useFactory: (): ScryptCost => ({ n: 65536, r: 8, p: 1 })
})
```

Raising or lowering the cost keeps stored hashes valid. Each hash records the cost it was made at and
is verified with that, so a change applies to hashes written afterwards.

Existing accounts upgrade as they log in. A successful login checks `needsRehash` and replaces the
stored hash. A user who never logs in keeps their old hash.

The same applies to retiring a whole strategy: marking one `DEPRECATED` in the hash strategy table
makes `needsRehash` return true for every hash it produced, and those accounts move to the current
default strategy on their next login.

## Verifying bcrypt hashes
`BcryptHashStrategy` verifies bcrypt hashes, such as the password hashes of Zibri 2, and is
deprecated. It needs the `bcryptjs` package, which you install. It hashes with 10 rounds, and each
bcrypt check holds up the requests running beside it. Keep it registered while stored hashes need it,
with bcrypt marked `DEPRECATED` in the hash strategy table: each of its hashes is replaced with a
scrypt hash the next time its user logs in. The [upgrade migration](./upgrading-to-3.md#the-migration)
does both.

## Requirements
| Package | Used for |
|---|---|
| `bcryptjs` | Verifying bcrypt hashes with `BcryptHashStrategy`. You install it |

Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `HashStrategyEntity` | Every application |
| `EncryptionStrategyEntity`, `EncryptionKey`, `EncryptionRotationProgress`, `EncryptionRotationFailure` | Every application |

How large each table grows, and what deletes its rows, is in [framework tables](./framework-tables.md).

## See also
- [Excluding properties](./excluding-properties.md) — an alternative/addition to decryption for controlling who can read a value
- [Dependency injection](./di.md) — overriding the strategy tokens via the providers array
- [Backup](./backup.md#encrypting-backups) — backups encrypted under the master key
