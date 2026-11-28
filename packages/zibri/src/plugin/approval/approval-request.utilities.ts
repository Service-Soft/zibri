import { createHash } from 'node:crypto';

import { getDiTokenName } from '../../di/get-di-token-name.function';
import { getRegisteredProvidersOfVariant } from '../../di/get-registered-providers-of-variant.function';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { type PropertyMetadata } from '../../entity/decorators/property.decorator';
import { isRelationMetadata } from '../../entity/models/is-relation-metadata.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { APPROVAL_ACTION_DI_VARIANT } from './approval.tokens';
import { type ApprovalAction } from './models/approval-action.model';
import { type ApprovalPrecondition } from './models/approval-precondition.model';
import { type ApprovalRequestChange } from './models/approval-request-change.model';
import { type ApprovalRowChange } from './models/approval-row-change.model';
import { type ApprovalValueChange } from './models/approval-value-change.model';

/**
 * Reads the registered approval actions, and turns the rows an action describes into what an approval request stores
 * of them: the values it changes, and the rows it was proposed against.
 */
export abstract class ApprovalRequestUtilities {
    /**
     * Resolves the actions registered with `provideApprovalAction`, by their names.
     * @returns The actions.
     * @throws When a provider of the variant holds no action, or two actions share a name.
     */
    static resolveRegisteredActions(): Map<string, ApprovalAction> {
        const actions: Map<string, ApprovalAction> = new Map();
        for (const provider of getRegisteredProvidersOfVariant(APPROVAL_ACTION_DI_VARIANT)) {
            const action: unknown = inject(provider.token);
            if (!this.isApprovalAction(action)) {
                throw new InternalError(`${getDiTokenName(provider.token)} is provided as an approval action, and needs to be one.`);
            }
            if (actions.has(action.name)) {
                throw new InternalError(`Two approval actions are named "${action.name}", which needs to be unique.`);
            }
            actions.set(action.name, action);
        }
        return actions;
    }

    /**
     * Resolves what an action changes on a row: every value it writes that differs from the stored one, every value
     * of a row it creates, and every stored value of a row it deletes.
     * @param row - The row, as the action describes it.
     * @returns The row and its changed values.
     */
    static resolveChange(row: ApprovalRowChange): ApprovalRequestChange {
        const stored: Record<string, unknown> = row.stored == undefined ? {} : this.toRecord(row.stored);
        const changes: ApprovalValueChange[] = row.values == undefined
            ? this.resolveColumns(row.entity)
                .filter(column => column !== 'id' && stored[column] != undefined)
                .map(column => ({ key: column, previousValue: stored[column], newValue: null }))
            : Object.entries(this.toRecord(row.values))
                .filter(([key, value]) => value !== undefined && this.resolveText(value) !== this.resolveText(stored[key]))
                .map(([key, value]) => ({ key, previousValue: stored[key] ?? null, newValue: value }));
        return { entity: this.getTableName(row.entity), id: row.stored?.id ?? null, changes };
    }

    /**
     * Resolves the preconditions of the rows an action describes: one for each row that is stored.
     * @param rows - The rows, as the action describes them.
     * @returns A precondition per stored row.
     */
    static resolvePreconditions(rows: ApprovalRowChange[]): ApprovalPrecondition[] {
        return rows.flatMap(row => row.stored == undefined
            ? []
            : [{ entity: this.getTableName(row.entity), id: row.stored.id, hash: this.resolveRowHash(row.entity, row.stored) }]);
    }

    /**
     * Finds the first precondition the rows an action describes now do not hold: a row that changed, or one that is
     * no longer described as stored.
     * @param preconditions - What the request was proposed against.
     * @param rows - The rows, as the action describes them now.
     * @returns The precondition, or undefined when every one holds.
     */
    static findBrokenPrecondition(preconditions: ApprovalPrecondition[], rows: ApprovalRowChange[]): ApprovalPrecondition | undefined {
        const current: Map<string, string> = new Map(this.resolvePreconditions(rows).map(p => [`${p.entity}:${p.id}`, p.hash]));
        return preconditions.find(p => current.get(`${p.entity}:${p.id}`) !== p.hash);
    }

    /**
     * The table of an entity, which the request names a row by.
     * @param entity - The entity.
     * @returns Its table.
     * @throws When the class is no entity.
     */
    private static getTableName(entity: Newable<BaseEntity>): string {
        const tableName: string | undefined = MetadataUtilities.getEntityMetadata(entity)?.tableName;
        if (tableName == undefined) {
            throw new InternalError(`"${entity.name}" is no entity, which an approval action names a row of.`);
        }
        return tableName;
    }

    /**
     * Resolves a hash of what a row holds: its columns in the order of their names, without its relations, which
     * are rows of their own.
     * @param entity - The entity of the row.
     * @param row - The row.
     * @returns The hash.
     */
    private static resolveRowHash(entity: Newable<BaseEntity>, row: BaseEntity): string {
        const stored: Record<string, unknown> = this.toRecord(row);
        const columns: unknown[] = this.resolveColumns(entity).map(column => [column, this.normalize(stored[column])]);
        const content: string = JsonUtilities.stringify(columns);
        return createHash('sha256').update(content)
            .digest('base64url');
    }

    /**
     * The columns of an entity, in the order of their names.
     * @param entity - The entity.
     * @returns Its properties that are no relation.
     */
    private static resolveColumns(entity: Newable<BaseEntity>): string[] {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entity);
        return Object.keys(properties).filter(key => !isRelationMetadata(properties[key]))
            .sort();
    }

    private static isApprovalAction(value: unknown): value is ApprovalAction {
        return typeof value === 'object'
            && value != undefined
            && 'name' in value
            && typeof value.name === 'string'
            && 'describe' in value
            && typeof value.describe === 'function'
            && 'run' in value
            && typeof value.run === 'function';
    }

    private static toRecord(row: object): Record<string, unknown> {
        return Object.fromEntries(Object.entries(row));
    }

    /**
     * A value as one text, which two values that are the same as stored share.
     * @param value - The value.
     * @returns The text.
     */
    private static resolveText(value: unknown): string {
        return JsonUtilities.stringify(this.normalize(value));
    }

    /**
     * A value as a row holds it, the same however the store hands it back.
     * @param value - The value.
     * @returns The value, with no value as null, a date as its ISO form and an object's keys in order.
     */
    // the rules of ChainUtilities, which hashes a row as well: a store hands back a date as a Date or a text, and the
    // keys of an object in any order
    private static normalize(value: unknown): unknown {
        if (value == undefined) {
            return null;
        }
        if (value instanceof Date) {
            return value.toISOString();
        }
        if (Array.isArray(value)) {
            return value.map(item => this.normalize(item));
        }
        return typeof value === 'object' && value.constructor === Object
            ? Object.keys(value).sort()
                .map(key => [key, this.normalize(Reflect.get(value, key))])
            : value;
    }
}