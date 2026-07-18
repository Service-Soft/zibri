import { ChildProcessByStdio, spawn } from 'node:child_process';
import { PassThrough, Readable, Writable } from 'node:stream';

import { EntitySchemaColumnOptions, EntitySchemaRelationOptions, ColumnType, QueryBuilder } from 'typeorm';
import { PostgresConnectionOptions } from 'typeorm/driver/postgres/PostgresConnectionOptions.js';
import { OnDeleteType } from 'typeorm/metadata/types/OnDeleteType.js';
import { OnUpdateType } from 'typeorm/metadata/types/OnUpdateType.js';

import { DataSourceInitializationError } from './data-source-initialization.error';
import { QueryOptions, SqlDataSourceInterface } from './sql-data-source.interface';
import { TypeOrmBaseDataSource, ToColumnMappableTypes } from './typeorm-base-data-source.model';
import { PostgresTypeOrmWhereFilterConverter } from './where-converter/postgres-typeorm-where-filter.converter';
import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { Inject } from '../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { BaseEntity } from '../../entity/base-entity.model';
import { PropertyMetadata, RelationMetadata } from '../../entity/decorators/property.decorator';
import { Relation } from '../../entity/models/relation.enum';
import { InternalError } from '../../error-handling/internal-error.model';
import { type LoggerInterface } from '../../logging/logger.interface';
import { ExcludeStrict } from '../../types/exclude-strict.type';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';

/**
 * Postgres-specific connection options.
 */
export type PostgresOptions = PostgresConnectionOptions;

/**
 * A base postgres data source definition.
 */
export abstract class PostgresDataSource extends TypeOrmBaseDataSource<PostgresOptions> implements SqlDataSourceInterface {

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected whereFilterConverter: PostgresTypeOrmWhereFilterConverter | undefined;
    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly type: 'postgres' = 'postgres';

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly defaultColumnTypeMapping: Record<ToColumnMappableTypes, ColumnType> = {
        array: 'array',
        number: 'decimal',
        string: 'varchar',
        object: 'jsonb',
        date: 'timestamptz',
        boolean: 'boolean',
        unknown: 'jsonb',
        file: 'bytea'
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly defaultOptions: OmitStrict<PostgresOptions, 'type' | 'entities' | 'synchronize'> = {
        poolSize: 100
    };

    /**
     * The optional root password.
     */
    readonly rootPw: string | undefined;
    /**
     * The optional root username.
     */
    readonly rootUsername: string | undefined;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.AUTH_SERVICE)
        authService: AuthServiceInterface
    ) {
        super(logger, authService);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async init(): Promise<void> {
        await super.init();
        if (!this.ds) {
            throw new DataSourceInitializationError();
        }
        // eslint-disable-next-line cspell/spellchecker
        await this.ds.query('CREATE EXTENSION IF NOT EXISTS pg_trgm');
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    validateBackupConfiguration(): void {
        if (!this.rootUsername || !this.rootPw) {
            throw new InternalError(
                'Invalid data source marked with @Backup: rootPw and rootUsername need to be provided'
            );
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    query<T extends BaseEntity>(entityClass: Newable<T>, options?: QueryOptions): QueryBuilder<T> {
        if (!this.ds) {
            throw new DataSourceInitializationError();
        }

        const alias: string = options?.alias ?? entityClass.name;
        if (options?.transaction) {
            return options.transaction.queryRunner.manager.createQueryBuilder(entityClass, alias);
        }
        return this.ds.createQueryBuilder(entityClass, alias);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected beforeMigrations(): void {
        if (!this.ds) {
            throw new DataSourceInitializationError();
        }
        this.whereFilterConverter = new PostgresTypeOrmWhereFilterConverter(this.ds);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    createBackupData(): Readable {
        const dumpCommand: string = 'pg_dumpall';
        const { host, port } = this.options;
        if (!this.rootUsername || !host || !port) {
            throw new InternalError('Could not create a backup, missing this.rootUsername, this.options.host or this.options.port');
        }
        const args: string[] = ['-U', this.rootUsername, '-h', host, '-p', port.toString()];

        const child: ChildProcessByStdio<null, Readable, null> = spawn(dumpCommand, args, {
            stdio: ['ignore', 'pipe', 'inherit'],
            env: { ...process.env, PGPASSWORD: this.rootPw }
        });

        const out: PassThrough = new PassThrough();
        child.stdout.pipe(out);
        child.on('error', err => {
            out.destroy(err);
        });
        child.on('exit', code => {
            if (code !== 0) {
                out.destroy(new InternalError(`${dumpCommand} exited with code ${code}`));
            }
            else {
                out.end();
            }
        });

        return out;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async restoreBackup(backupData: Readable): Promise<void> {
        const { host, port, database } = this.options;
        if (!this.rootUsername || !host || !port || !database) {
            throw new InternalError('Missing rootUsername, host, port, or database for restore');
        }

        const args: string[] = ['-U', this.rootUsername, '-h', host, '-p', port.toString(), '-d', database];
        const child: ChildProcessByStdio<Writable, null, null> = spawn('psql', args, {
            stdio: ['pipe', 'inherit', 'inherit'],
            env: { ...process.env, PGPASSWORD: this.rootPw }
        });

        return new Promise((resolve, reject) => {
            backupData.pipe(child.stdin);

            child.on('error', reject);
            child.on('close', code => {
                if (code !== 0) {
                    reject(new InternalError(`psql exited with code ${code}`));
                }
                else {
                    resolve();
                }
            });
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected async validateOptions(options: OmitStrict<PostgresOptions, 'type' | 'entities' | 'synchronize'>): Promise<void> {
        if (options.username === 'postgres' && options.password === 'password') {
            await this.logger.warn(
                `The data source "${this.constructor.name}" uses the default credentials, you probably want to change that.`
            );
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected propertyToRelationOptions<T extends BaseEntity>(
        cls: Newable<T>,
        key: string,
        metadata: RelationMetadata<T>
    ): EntitySchemaRelationOptions {
        const thisHasRemove: boolean = this.hasCascadeFlag(metadata.cascade, 'remove');
        const thisHasUpdate: boolean = this.hasCascadeFlag(metadata.cascade, 'update');
        const thisHasInsert: boolean = this.hasCascadeFlag(metadata.cascade, 'insert');

        // try to inspect inverse property's cascade (if inverseSide provided)
        const targetClass: Newable<T> = metadata.target();
        const targetProps: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(targetClass);
        const inv: RelationMetadata<BaseEntity> = targetProps[metadata.inverseSide] as RelationMetadata<BaseEntity>;
        const inverseHasRemove: boolean = this.hasCascadeFlag(inv.cascade, 'remove');
        const inverseHasUpdate: boolean = this.hasCascadeFlag(inv.cascade, 'update');
        const inverseHasInsert: boolean = this.hasCascadeFlag(inv.cascade, 'insert');

        const onDelete: OnDeleteType | undefined = thisHasRemove || inverseHasRemove ? 'CASCADE' : undefined;
        const onUpdate: OnUpdateType | undefined = thisHasUpdate || inverseHasUpdate ? 'CASCADE' : undefined;
        const persistence: boolean = 'persistence' in metadata ? metadata.persistence : thisHasInsert || inverseHasInsert;
        const nullable: boolean = typeof metadata.required === 'boolean' ? !metadata.required : true;

        // eslint-disable-next-line typescript/typedef
        const shared = {
            inverseSide: metadata.inverseSide as string,
            onDelete,
            onUpdate,
            persistence,
            nullable
        } as const satisfies Partial<EntitySchemaRelationOptions>;

        switch (metadata.type) {
            case Relation.ONE_TO_MANY: {
                return {
                    ...metadata,
                    ...shared
                };
            }
            case Relation.HAS_ONE: {
                return {
                    ...metadata,
                    ...shared,
                    type: 'one-to-one'
                };
            }
            case Relation.MANY_TO_MANY: {
                if (metadata.joinTable == undefined) {
                    throw new InternalError(
                        `The property ${cls.name}.${key} needs to have "joinTable" set inside of the @Property.manyToMany() decorator.`
                    );
                }
                return {
                    ...metadata,
                    ...shared
                };
            }
            case Relation.BELONGS_TO_ONE: {
                if (metadata.joinColumn == undefined) {
                    throw new InternalError(
                        `The property ${cls.name}.${key} needs to have "joinColumn" set inside of the @Property.belongsToOne() decorator.`
                    );
                }
                return {
                    ...metadata,
                    ...shared,
                    type: 'one-to-one',
                    joinColumn: { name: metadata.joinColumn }
                };
            }
            case Relation.MANY_TO_ONE: {
                if (metadata.joinColumn == undefined) {
                    throw new InternalError(
                        `The property ${cls.name}.${key} needs to have "joinColumn" set inside of the @Property.manyToOne() decorator.`
                    );
                }
                return {
                    ...metadata,
                    ...shared,
                    joinColumn: { name: metadata.joinColumn }
                };
            }
        }
    }

    private hasCascadeFlag(c: RelationMetadata<BaseEntity>['cascade'], flag: 'remove' | 'update' | 'insert'): boolean {
        if (c === true) {
            return true;
        }
        if (Array.isArray(c)) {
            return c.includes(flag);
        }
        return false;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected propertyToColumnOptions(
        metadata: ExcludeStrict<PropertyMetadata, RelationMetadata<BaseEntity>>
    ): EntitySchemaColumnOptions {
        const nullable: boolean = typeof metadata.required === 'boolean' ? !metadata.required : true;
        switch (metadata.type) {
            case 'file':
            case 'boolean':
            case 'object':
            case 'unknown':
            case 'date': {
                return {
                    nullable,
                    ...metadata,
                    type: this.fullColumnTypeMapping[metadata.type],
                    default: undefined
                };
            }
            case 'array': {
                if (metadata.items.type === 'object') {
                    return {
                        nullable,
                        ...metadata,
                        type: this.fullColumnTypeMapping[metadata.items.type],
                        default: undefined
                    };
                }
                return {
                    nullable,
                    ...metadata,
                    type: this.fullColumnTypeMapping[metadata.items.type],
                    array: true,
                    default: undefined
                };
            }
            case 'number': {
                return {
                    nullable,
                    generated: metadata.primary ? 'increment' : undefined,
                    ...metadata,
                    type: metadata.format ?? this.fullColumnTypeMapping[metadata.type],
                    default: undefined,
                    transformer: {
                        // eslint-disable-next-line unicorn/no-null
                        to: (v: number | bigint | null) => v != null ? String(v) : null,
                        from: (v: string | null) => {
                            if (v == undefined) {
                                return v;
                            }
                            if (metadata.format === 'bigint') {
                                return BigInt(v);
                            }
                            return Number(v);
                        }
                    }
                };
            }
            case 'string': {
                return {
                    nullable,
                    generated: metadata.primary ? 'uuid' : undefined,
                    ...metadata,
                    type: metadata.format === 'uuid' || metadata.primary ? 'uuid' : this.fullColumnTypeMapping[metadata.type],
                    length: metadata.maxLength,
                    enum: metadata.enum ? ObjectUtilities.values(metadata.enum) : undefined,
                    default: undefined
                };
            }
        }
    }
}