import { PostgresSchemaManager } from './postgres-schema-manager.model';
import { PostgresStatement } from './postgres-sql.utilities';
import { BaseEntity } from '../../../entity/base-entity.model';
import { KeyWhere } from '../../../entity/models/unique-declaration.model';
import { Newable } from '../../../types/newable.type';
import { CheckConstraintViolationError } from '../../check-constraint-violation.error';
import { QueryFailedError } from '../../query-failed.error';
import { MistypedStoredValue, StoredValueTypeMismatchError } from '../../stored-value-type-mismatch.error';
import { TransactionDeadlockError } from '../../transaction/transaction-deadlock.error';
import { TransactionSerializationError } from '../../transaction/transaction-serialization.error';
import { UniqueConstraintViolationError } from '../../unique-constraint-violation.error';

/**
 * The sql state postgres reports a unique violation under.
 */
const UNIQUE_VIOLATION_SQL_STATE: string = '23505';

/**
 * The sql state postgres fails the statement of the transaction it ends to break a deadlock with.
 */
const DEADLOCK_DETECTED_SQL_STATE: string = '40P01';

/**
 * The sql state postgres ends a transaction with that read rows another one changed in a way its
 * isolation level does not allow.
 */
const SERIALIZATION_FAILURE_SQL_STATE: string = '40001';

/**
 * The sql state postgres answers a write breaking a check constraint with.
 */
const CHECK_VIOLATION_SQL_STATE: string = '23514';

/**
 * The sql states postgres reports a value it could not read as the requested type under.
 *
 * Three of them because the datetime types answer separately from everything else, and separately
 * again for a value that parses but names no moment - "2020-13-45" is a different complaint than
 * "not a date" and the same problem to whoever wrote the row.
 */
const UNREADABLE_VALUE_SQL_STATES: string[] = ['22P02', '22007', '22008'];

/**
 * Finds the marker the where converter writes beside a cast, and what it says.
 */
const CAST_MARKER_PATTERN: RegExp = /\/\* zibri-json:(?<path>.+?):(?<type>number|date|boolean) \*\//g;

/**
 * Reads the value out of the complaint postgres made about it.
 *
 * Every shape it uses quotes the value last, which is the only part of the message worth repeating:
 * the type it failed to read as is already known from the marker, and said better there. In the
 * quotes of whichever language the server writes its messages in.
 */
const UNREADABLE_VALUE_PATTERN: RegExp = /["«»‹›“”„「」]\s?(?<value>[^"«»‹›“”„「」]*?)\s?["«»‹›“”„「」]\s*$/u;

/**
 * The declared type behind the function postgres names as the one that could not read a value.
 *
 * Only used to choose between markers when a statement carries more than one cast. The function
 * rather than the message, which is written in the server's language, while the function is named
 * the same on every server.
 */
const DECLARED_TYPE_BY_ROUTINE: ReadonlyMap<string, string> = new Map([
    ['numeric_in', 'number'],
    // the same complaint, raised one call further down before postgres 16
    ['set_var_from_str', 'number'],
    ['boolin', 'boolean'],
    ['DateTimeParseError', 'date']
]);

/**
 * What a statement the driver failed means to the caller who sent it.
 */
export abstract class PostgresStatementErrorUtilities {

    /**
     * Resolves what a failed statement means: a conflict that ended its transaction, a unique or a check
     * an entity declares, a json value its property does not describe, or the failed statement itself.
     * The same declaration refusing the same write has to be the same error whichever store it was made
     * in, because it is declared on the entity.
     * @param error - What the driver failed the statement with.
     * @param statement - The statement and what it bound.
     * @param statement.sql - The sql of the statement.
     * @param statement.values - What its placeholders bound, in order.
     * @param entityClass - The entity it reads or writes.
     * @param manager - Gets the schema manager, which knows the names the entity's uniques and checks
     * are stored by.
     * @returns The error to throw.
     */
    static resolveError(
        error: unknown,
        { sql, values }: PostgresStatement,
        entityClass: Newable<BaseEntity> | undefined,
        manager: () => PostgresSchemaManager
    ): unknown {
        const code: string | undefined = this.findField(error, 'code');
        if (!(error instanceof Error) || code == undefined) {
            return error;
        }
        const failed: QueryFailedError = new QueryFailedError(
            { message: error.message, detail: this.findField(error, 'detail'), query: sql, parameters: values },
            { cause: error }
        );
        if (code === DEADLOCK_DETECTED_SQL_STATE) {
            return new TransactionDeadlockError({ cause: failed });
        }
        if (code === SERIALIZATION_FAILURE_SQL_STATE) {
            return new TransactionSerializationError({ cause: failed });
        }
        if (entityClass == undefined) {
            return failed;
        }
        const constraint: string | undefined = this.findField(error, 'constraint');
        if (code === UNIQUE_VIOLATION_SQL_STATE) {
            // by the name of the constraint rather than by the detail describing it: the detail is
            // written in the server's language, while the name is the one this data source gave it
            const name: string = constraint ?? 'unknown';
            return new UniqueConstraintViolationError(
                entityClass.name,
                manager().findDeclaredUnique(entityClass, name) ?? [name],
                { cause: failed }
            );
        }
        if (code === CHECK_VIOLATION_SQL_STATE && constraint != undefined) {
            const check: KeyWhere | undefined = manager().findDeclaredCheck(entityClass, constraint);
            if (check != undefined) {
                return new CheckConstraintViolationError(entityClass, check, { cause: failed });
            }
        }
        const mistyped: MistypedStoredValue | undefined = UNREADABLE_VALUE_SQL_STATES.includes(code)
            ? this.findMistypedJsonValue(error, sql, entityClass.name)
            : undefined;
        return mistyped == undefined ? failed : new StoredValueTypeMismatchError(mistyped, { cause: failed });
    }

    /**
     * Finds a field of what the driver failed a statement with.
     * @param error - The error.
     * @param field - The field.
     * @returns It, when it is text.
     */
    static findField(error: unknown, field: 'code' | 'constraint' | 'detail' | 'routine'): string | undefined {
        if (typeof error !== 'object' || error == undefined || !(field in error)) {
            return undefined;
        }
        const value: unknown = Reflect.get(error, field);
        return typeof value === 'string' ? value : undefined;
    }

    /**
     * Finds what a failed statement found in a json column that the model does not describe: the same
     * sql states answer for a malformed uuid or a bad literal anywhere else in the statement, so the
     * marker the converter wrote beside the cast is what makes this a json question.
     * @param error - What the statement failed with.
     * @param sql - The statement.
     * @param entityName - The entity, which the path starts at.
     * @returns What was found, or undefined when the statement failed for another reason.
     */
    private static findMistypedJsonValue(error: Error, sql: string, entityName: string): MistypedStoredValue | undefined {
        const routine: string | undefined = this.findField(error, 'routine');
        const markers: RegExpExecArray[] = [...sql.matchAll(CAST_MARKER_PATTERN)];
        const marker: RegExpExecArray | undefined = markers.find(m => m.groups?.['type'] === DECLARED_TYPE_BY_ROUTINE.get(routine ?? ''))
            ?? markers.at(0);
        const path: string | undefined = marker?.groups?.['path'];
        const declaredType: string | undefined = marker?.groups?.['type'];
        if (path == undefined || declaredType == undefined) {
            return undefined;
        }
        // the path starts at the column, which names the property holding the object
        return {
            path: [entityName, ...path.split('.')].join('.'),
            declaredType,
            value: UNREADABLE_VALUE_PATTERN.exec(error.message)?.groups?.['value'] ?? error.message
        };
    }
}