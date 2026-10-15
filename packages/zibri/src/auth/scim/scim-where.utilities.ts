import { ScimErrorType } from './scim-error-type.enum';
import { ScimFilterMatch } from './scim-filter-match.model';
import { ScimAttributePath, ScimComparisonOperator, ScimFilter, ScimFilterValue } from './scim-filter.model';
import { ScimFilterUtilities } from './scim-filter.utilities';
import { ScimGroup } from './scim-group.model';
import { ScimIndexedFilter } from './scim-indexed-filter.model';
import { ScimSchema } from './scim-schema.enum';
import { ScimUserValue } from './scim-user-value.model';
import { ScimUser } from './scim-user.model';
import { ScimValueSort } from './scim-value-sort.model';
import { ScimError } from './scim.error';
import { BooleanWhereFilter } from '../../data-source/models/where/boolean-where-filter.model';
import { DateWhereFilter } from '../../data-source/models/where/date-where-filter.model';
import { StringWhereFilter } from '../../data-source/models/where/string-where-filter.model';
import { WhereFilter } from '../../data-source/models/where/where-filter.model';
import { ScopedWhere, ScopeWhereUtilities } from '../../data-source/scopes/scope-where.utilities';
import { BaseEntity } from '../../entity/base-entity.model';
import { EntityOrder, OrderDirection } from '../../entity/models/entity-order.model';
import { HttpStatus } from '../../http/http-status.enum';
import { $ts } from '../../localization/translate.function';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';

/**
 * The most alternatives a filter may stand for once its `or`s are multiplied out.
 */
const MAX_FILTER_ALTERNATIVES: number = 100;

/**
 * An attribute kept in a column of its own: how a filter compares it, the condition a comparison
 * puts on the column, and the order a sort by it reads in.
 */
type ScimColumn<T extends BaseEntity> = {
    /**
     * Text compared without regard to case, which the column holds in lower case (`text`), compared
     * as it is (`caseExactText`), or the id of a resource, compared for equality alone (`id`).
     */
    kind: 'text' | 'caseExactText' | 'id',
    // eslint-disable-next-line jsdoc/require-jsdoc
    nullable: boolean,
    // eslint-disable-next-line jsdoc/require-jsdoc
    where: (condition: StringWhereFilter) => WhereFilter<T>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    order: (direction: OrderDirection) => EntityOrder<T>
} | {
    // eslint-disable-next-line jsdoc/require-jsdoc
    kind: 'boolean',
    // eslint-disable-next-line jsdoc/require-jsdoc
    where: (condition: BooleanWhereFilter) => WhereFilter<T>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    order: (direction: OrderDirection) => EntityOrder<T>
} | {
    // eslint-disable-next-line jsdoc/require-jsdoc
    kind: 'date',
    // eslint-disable-next-line jsdoc/require-jsdoc
    where: (condition: DateWhereFilter) => WhereFilter<T>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    order: (direction: OrderDirection) => EntityOrder<T>
} | {
    /**
     * A member of a group, which the groups that have it stand in for: the condition is on their ids.
     */
    kind: 'member',
    // eslint-disable-next-line jsdoc/require-jsdoc
    where: (condition: StringWhereFilter) => WhereFilter<T>
};

/**
 * The attributes of a user that are kept in columns of their own, by their path in lower case.
 */
const USER_COLUMNS: Record<string, ScimColumn<ScimUser>> = {
    id: { kind: 'id', nullable: false, where: id => ({ id }), order: id => ({ id }) },
    username: { kind: 'text', nullable: false, where: userNameKey => ({ userNameKey }), order: userNameKey => ({ userNameKey }) },
    externalid: { kind: 'caseExactText', nullable: true, where: externalId => ({ externalId }), order: externalId => ({ externalId }) },
    active: { kind: 'boolean', where: active => ({ active }), order: active => ({ active }) },
    'meta.created': { kind: 'date', where: createdAt => ({ createdAt }), order: createdAt => ({ createdAt }) },
    'meta.lastmodified': { kind: 'date', where: updatedAt => ({ updatedAt }), order: updatedAt => ({ updatedAt }) }
};

/**
 * The attributes of a group that are kept in columns of their own, by their path in lower case.
 */
const GROUP_COLUMNS: Record<string, ScimColumn<ScimGroup>> = {
    id: { kind: 'id', nullable: false, where: id => ({ id }), order: id => ({ id }) },
    displayname: {
        kind: 'text',
        nullable: false,
        where: displayNameKey => ({ displayNameKey }),
        order: displayNameKey => ({ displayNameKey })
    },
    externalid: { kind: 'caseExactText', nullable: true, where: externalId => ({ externalId }), order: externalId => ({ externalId }) },
    'members.value': { kind: 'member', where: id => ({ id }) },
    'meta.created': { kind: 'date', where: createdAt => ({ createdAt }), order: createdAt => ({ createdAt }) },
    'meta.lastmodified': { kind: 'date', where: updatedAt => ({ updatedAt }), order: updatedAt => ({ updatedAt }) }
};

/**
 * The attributes of the groups a user is a member of that a filter on users compares, by their path
 * in lower case, and the attribute of the group each stands for.
 */
const GROUP_ATTRIBUTES_OF_USER: Record<string, string> = { groups: 'id', 'groups.value': 'id', 'groups.display': 'displayName' };

/**
 * What a filter is read with, beside the filter itself.
 */
type FilterContext<T extends BaseEntity> = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    columns: Record<string, ScimColumn<T>>,
    // eslint-disable-next-line jsdoc/require-jsdoc
    entityClass: Newable<T>,
    /**
     * The ids of the groups each member named by the filter is a direct member of.
     */
    groupsOfMember: Map<string, string[]>,
    /**
     * The users each part of the filter found ahead of the rest holds for.
     */
    matches: Map<ScimFilter, ScimFilterMatch>,
    /**
     * The condition on the id of the resource.
     */
    idWhere: (condition: StringWhereFilter) => WhereFilter<T>
};

/**
 * Turns SCIM filters and sorts (RFC 7644, 3.4.2) into the conditions and orders of the columns that
 * keep provisioned users and groups, so that the data source answers them.
 */
export abstract class ScimWhereUtilities {
    /**
     * The alternatives a filter on users stands for, any of which a user has to match.
     * @param filter - The filter.
     * @param matches - The users every part `findIndexedFilters` names holds for.
     * @returns The alternatives, none when the filter matches nothing.
     * @throws A ScimError (invalidFilter) when the filter compares something no column answers.
     */
    static resolveUserWhere(filter: ScimFilter, matches: Map<ScimFilter, ScimFilterMatch>): WhereFilter<ScimUser>[] {
        return this.resolveBranches(filter, false, '', {
            columns: USER_COLUMNS,
            entityClass: ScimUser,
            groupsOfMember: new Map(),
            matches,
            idWhere: id => ({ id })
        });
    }

    /**
     * The alternatives a filter on groups stands for, any of which a group has to match.
     * @param filter - The filter.
     * @param groupsOfMember - The ids of the groups every member the filter names is a direct member
     * of, see `findMemberIds`.
     * @returns The alternatives, none when the filter matches nothing.
     * @throws A ScimError (invalidFilter) when the filter compares something no column answers.
     */
    static resolveGroupWhere(filter: ScimFilter, groupsOfMember: Map<string, string[]>): WhereFilter<ScimGroup>[] {
        return this.resolveBranches(filter, false, '', {
            columns: GROUP_COLUMNS,
            entityClass: ScimGroup,
            groupsOfMember,
            matches: new Map(),
            idWhere: id => ({ id })
        });
    }

    /**
     * The parts of a filter on users that compare an attribute without a column of its own: one
     * whose values are kept apart, or the groups of the user. The users each holds for are found
     * ahead of the rest of the filter.
     * @param filter - The filter.
     * @param prefix - The attribute a value path's filter is about, followed by a dot.
     * @returns The parts, each with the attribute it is about.
     * @throws A ScimError (invalidFilter) when a part compares an attribute of meta no column keeps.
     */
    static findIndexedFilters(filter: ScimFilter, prefix: string = ''): ScimIndexedFilter[] {
        switch (filter.type) {
            case 'and':
            case 'or': {
                return [...this.findIndexedFilters(filter.left, prefix), ...this.findIndexedFilters(filter.right, prefix)];
            }
            case 'not': {
                return this.findIndexedFilters(filter.filter, prefix);
            }
            case 'valuePath': {
                const key: string = this.toPathKey(filter.path, prefix);
                // a value path over attributes in columns, eg. meta[created gt "…"], is answered by them
                if (Object.keys(USER_COLUMNS).some(column => column.startsWith(`${key}.`))) {
                    return this.findIndexedFilters(filter.filter, `${key}.`);
                }
                this.validateIndexed(key);
                return [{ filter, key }];
            }
            case 'comparison':
            case 'present': {
                const key: string = this.toPathKey(filter.path, prefix);
                if (USER_COLUMNS[key] != undefined) {
                    return [];
                }
                this.validateIndexed(key);
                return [{ filter, key }];
            }
        }
    }

    /**
     * Whether a part of a filter on users is about the groups of the user rather than their values.
     * @param key - The attribute the part is about.
     * @returns Whether it is.
     */
    static isGroupsKey(key: string): boolean {
        return key === 'groups' || key.startsWith('groups.');
    }

    /**
     * Turns a part of a filter on users that compares their groups into the filter on groups it
     * stands for: `groups.display eq "admins"` into `displayName eq "admins"`.
     * @param filter - The part.
     * @param prefix - The attribute a value path's filter is about, followed by a dot.
     * @returns The filter on groups.
     * @throws A ScimError (invalidFilter) when it compares what no attribute of a group answers.
     */
    static toGroupFilter(filter: ScimFilter, prefix: string = ''): ScimFilter {
        switch (filter.type) {
            case 'and':
            case 'or': {
                return { ...filter, left: this.toGroupFilter(filter.left, prefix), right: this.toGroupFilter(filter.right, prefix) };
            }
            case 'not': {
                return { type: 'not', filter: this.toGroupFilter(filter.filter, prefix) };
            }
            case 'valuePath': {
                return this.toGroupFilter(filter.filter, `${this.toPathKey(filter.path, prefix)}.`);
            }
            case 'comparison':
            case 'present': {
                const attribute: string | undefined = GROUP_ATTRIBUTES_OF_USER[this.toPathKey(filter.path, prefix)];
                if (attribute == undefined) {
                    throw this.unsupportedFilter();
                }
                return { ...filter, path: { uri: undefined, attribute, subAttribute: undefined } };
            }
        }
    }

    /**
     * The conditions on the kept values of users a comparison holds for: one value of the attribute
     * compares as asked. `ne` holds for exactly the users `eq` does not, so the caller negates `eq`.
     * @param paths - The paths the compared values are kept under.
     * @param operator - How they are compared, `ne` read as `eq`.
     * @param value - What they are compared with.
     * @returns The alternatives, any of which a value has to match.
     * @throws A ScimError (invalidFilter) when the operator does not compare a value of its type.
     */
    static resolveValueWhere(
        paths: string[],
        operator: ScimComparisonOperator,
        value: string | number | boolean
    ): WhereFilter<ScimUserValue>[] {
        const path: StringWhereFilter = { oneOf: paths };
        const effective: ScimComparisonOperator = operator === 'ne' ? 'eq' : operator;
        if (typeof value === 'string') {
            return this.resolveTextComparison<ScimUserValue>(text => ({ path, text }), false, effective, value.toLowerCase(), false);
        }
        if (typeof value === 'boolean') {
            if (effective !== 'eq') {
                throw this.unsupportedFilter();
            }
            return [{ path, boolean: value }];
        }
        switch (effective) {
            case 'eq': {
                return [{ path, number: value }];
            }
            case 'gt': {
                return [{ path, number: { greaterThan: value } }];
            }
            case 'ge': {
                return [{ path, number: { greaterThanEquals: value } }];
            }
            case 'lt': {
                return [{ path, number: { lesserThan: value } }];
            }
            case 'le': {
                return [{ path, number: { lesserThanEquals: value } }];
            }
            case 'co':
            case 'sw':
            case 'ew': {
                throw this.unsupportedFilter();
            }
        }
    }

    /**
     * The members a filter on groups names, by `members[value eq "…"]` or `members.value eq "…"`.
     * @param filter - The filter.
     * @param prefix - The attribute a value path's filter is about, followed by a dot.
     * @returns Their ids, in lower case.
     */
    static findMemberIds(filter: ScimFilter, prefix: string = ''): string[] {
        switch (filter.type) {
            case 'and':
            case 'or': {
                return [...this.findMemberIds(filter.left, prefix), ...this.findMemberIds(filter.right, prefix)];
            }
            case 'not': {
                return this.findMemberIds(filter.filter, prefix);
            }
            case 'valuePath': {
                return this.findMemberIds(filter.filter, `${filter.path.attribute}.`);
            }
            case 'comparison': {
                return this.toPathKey(filter.path, prefix) === 'members.value' && typeof filter.value === 'string'
                    ? [filter.value.toLowerCase()]
                    : [];
            }
            case 'present': {
                return [];
            }
        }
    }

    /**
     * The order a sort of users reads in, the id breaking ties, or for an attribute without a column
     * of its own the values it sorts by.
     * @param sortBy - The attribute to sort by.
     * @param sortOrder - `ascending` or `descending`, ascending when undefined.
     * @returns The order, or the sort by values.
     * @throws A ScimError (invalidValue) when the attribute is one of meta or of the groups of the
     * user that no column keeps.
     */
    static resolveUserOrder(sortBy: string, sortOrder: string | undefined): EntityOrder<ScimUser> | ScimValueSort {
        const key: string = this.toPathKey(ScimFilterUtilities.parseAttributePath(sortBy, ScimErrorType.INVALID_VALUE), '');
        const direction: OrderDirection = this.toDirection(sortOrder);
        const column: ScimColumn<ScimUser> | undefined = USER_COLUMNS[key];
        if (column == undefined) {
            if (key === 'meta' || key.startsWith('meta.') || this.isGroupsKey(key)) {
                throw this.unsupportedSort(true);
            }
            return { paths: [key, `${key}.value`], direction };
        }
        const order: EntityOrder<ScimUser> = this.resolveOrder(column, direction);
        // the id breaks ties, unless it is what the sort is by
        return column.kind === 'id' ? order : { ...order, id: 'ASC' };
    }

    /**
     * The order a sort of groups reads in, the id breaking ties.
     * @param sortBy - The attribute to sort by.
     * @param sortOrder - `ascending` or `descending`, ascending when undefined.
     * @returns The order.
     * @throws A ScimError (invalidValue) when no column keeps the attribute.
     */
    static resolveGroupOrder(sortBy: string, sortOrder: string | undefined): EntityOrder<ScimGroup> {
        const key: string = this.toPathKey(ScimFilterUtilities.parseAttributePath(sortBy, ScimErrorType.INVALID_VALUE), '');
        const direction: OrderDirection = this.toDirection(sortOrder);
        const column: ScimColumn<ScimGroup> | undefined = GROUP_COLUMNS[key];
        if (column == undefined) {
            throw this.unsupportedSort(false);
        }
        const order: EntityOrder<ScimGroup> = this.resolveOrder(column, direction);
        return column.kind === 'id' ? order : { ...order, id: 'ASC' };
    }

    /**
     * The key an attribute path is kept under, in lower case: the attribute and its sub-attribute,
     * led by the urn of its schema when it belongs to an extension. A core attribute named by its
     * schema is the attribute itself.
     * @param path - The path.
     * @param prefix - The attribute a value path's filter is about, followed by a dot.
     * @returns The key.
     */
    static toPathKey(path: ScimAttributePath, prefix: string): string {
        const attribute: string = path.subAttribute == undefined ? path.attribute : [path.attribute, path.subAttribute].join('.');
        const core: boolean = path.uri == undefined
            || [ScimSchema.USER, ScimSchema.GROUP].some(schema => schema.toLowerCase() === path.uri?.toLowerCase());
        const schema: string = core ? '' : `${path.uri}:`;
        return `${prefix}${schema}${attribute}`.toLowerCase();
    }

    /**
     * The error for a filter that compares what nothing kept answers.
     * @returns A ScimError (invalidFilter).
     */
    static unsupportedFilter(): ScimError {
        return new ScimError(
            HttpStatus.BAD_REQUEST,
            $ts`The filter compares an attribute resources cannot be found by, or compares it in a way its values cannot be.`,
            ScimErrorType.INVALID_FILTER
        );
    }

    /**
     * Multiplies a filter out into the alternatives it stands for, with a `not` pushed down to the
     * comparisons it negates.
     * @param filter - The filter.
     * @param negated - Whether the filter is negated.
     * @param prefix - The attribute a value path's filter is about, followed by a dot.
     * @param context - What the filter is read with.
     * @returns The alternatives.
     */
    private static resolveBranches<T extends BaseEntity>(
        filter: ScimFilter,
        negated: boolean,
        prefix: string,
        context: FilterContext<T>
    ): WhereFilter<T>[] {
        const match: ScimFilterMatch | undefined = context.matches.get(filter);
        if (match != undefined) {
            return this.resolveMatch(match, negated, context);
        }
        switch (filter.type) {
            case 'and':
            case 'or': {
                const left: WhereFilter<T>[] = this.resolveBranches(filter.left, negated, prefix, context);
                const right: WhereFilter<T>[] = this.resolveBranches(filter.right, negated, prefix, context);
                // not (a and b) is (not a) or (not b), and the other way around
                const either: boolean = (filter.type === 'or') !== negated;
                return this.validateFilterSize(either ? [...left, ...right] : this.resolveBoth(left, right, context.entityClass));
            }
            case 'not': {
                return this.resolveBranches(filter.filter, !negated, prefix, context);
            }
            case 'valuePath': {
                return this.resolveBranches(filter.filter, negated, `${this.toPathKey(filter.path, prefix)}.`, context);
            }
            case 'present': {
                return this.resolvePresent(this.findColumn(context.columns, this.toPathKey(filter.path, prefix)), negated);
            }
            case 'comparison': {
                const column: ScimColumn<T> = this.findColumn(context.columns, this.toPathKey(filter.path, prefix));
                return this.resolveComparison(column, filter.operator, filter.value, negated, context.groupsOfMember);
            }
        }
    }

    /**
     * The alternatives two filters that both have to hold stand for: every pairing of theirs, without
     * the ones that contradict themselves.
     * @param left - The alternatives of one.
     * @param right - The alternatives of the other.
     * @param entityClass - The entity they filter.
     * @returns The alternatives.
     */
    private static resolveBoth<T extends BaseEntity>(
        left: WhereFilter<T>[],
        right: WhereFilter<T>[],
        entityClass: Newable<T>
    ): WhereFilter<T>[] {
        if (!left.length || !right.length) {
            return [];
        }
        const both: ScopedWhere<T> = ScopeWhereUtilities.applyToWhere(left, right, MetadataUtilities.getModelProperties(entityClass));
        return both.matchesNothing ? [] : ScopeWhereUtilities.branchesOf(both.where);
    }

    /**
     * The alternatives a part of the filter found ahead of the rest stands for.
     * @param match - The users it holds for.
     * @param negated - Whether it is negated.
     * @param context - What the filter is read with.
     * @returns The alternatives.
     */
    private static resolveMatch<T extends BaseEntity>(
        match: ScimFilterMatch,
        negated: boolean,
        context: FilterContext<T>
    ): WhereFilter<T>[] {
        const excluded: boolean = match.negated !== negated;
        if (!match.ids.length) {
            return excluded ? [{}] : [];
        }
        return [context.idWhere(excluded ? { notOneOf: match.ids } : { oneOf: match.ids })];
    }

    private static resolvePresent<T extends BaseEntity>(column: ScimColumn<T>, negated: boolean): WhereFilter<T>[] {
        switch (column.kind) {
            case 'text':
            case 'caseExactText':
            case 'id': {
                if (column.nullable) {
                    // eslint-disable-next-line unicorn/no-null
                    return [column.where(negated ? null : { not: null })];
                }
                // a column every resource holds a value in
                return negated ? [] : [{}];
            }
            case 'boolean':
            case 'date': {
                return negated ? [] : [{}];
            }
            case 'member': {
                throw this.unsupportedFilter();
            }
        }
    }

    private static resolveComparison<T extends BaseEntity>(
        column: ScimColumn<T>,
        operator: ScimComparisonOperator,
        value: ScimFilterValue,
        negated: boolean,
        groupsOfMember: Map<string, string[]>
    ): WhereFilter<T>[] {
        if (value === null) {
            // a comparison with null asks whether there is a value at all
            if (operator !== 'eq' && operator !== 'ne') {
                throw this.unsupportedFilter();
            }
            return this.resolvePresent(column, (operator === 'eq') !== negated);
        }
        switch (column.kind) {
            case 'boolean': {
                if (typeof value !== 'boolean' || (operator !== 'eq' && operator !== 'ne')) {
                    throw this.unsupportedFilter();
                }
                return [column.where((operator === 'eq') === negated ? { not: value } : value)];
            }
            case 'id': {
                return this.resolveIdComparison(column.where, operator, value, negated);
            }
            case 'member': {
                return this.resolveMemberComparison(column.where, operator, value, negated, groupsOfMember);
            }
            case 'date': {
                return this.resolveDateComparison(column.where, operator, value, negated);
            }
            case 'text':
            case 'caseExactText': {
                if (typeof value !== 'string') {
                    throw this.unsupportedFilter();
                }
                const text: string = column.kind === 'text' ? value.toLowerCase() : value;
                return this.resolveTextComparison(column.where, column.nullable, operator, text, negated);
            }
        }
    }

    private static resolveIdComparison<T extends BaseEntity>(
        where: (condition: StringWhereFilter) => WhereFilter<T>,
        operator: ScimComparisonOperator,
        value: string | number | boolean,
        negated: boolean
    ): WhereFilter<T>[] {
        if (typeof value !== 'string' || (operator !== 'eq' && operator !== 'ne')) {
            throw this.unsupportedFilter();
        }
        const equal: boolean = (operator === 'eq') !== negated;
        // an id that is no uuid is no resource's, which is no reason to ask the data source
        if (!UUIDUtilities.isUuid(value)) {
            return equal ? [] : [{}];
        }
        return [where(equal ? value.toLowerCase() : { not: value.toLowerCase() })];
    }

    private static resolveMemberComparison<T extends BaseEntity>(
        where: (condition: StringWhereFilter) => WhereFilter<T>,
        operator: ScimComparisonOperator,
        value: string | number | boolean,
        negated: boolean,
        groupsOfMember: Map<string, string[]>
    ): WhereFilter<T>[] {
        // only equality: `ne` on a list of members is true of a group with any other member, which no
        // condition on the group answers
        if (typeof value !== 'string' || operator !== 'eq') {
            throw this.unsupportedFilter();
        }
        const groupIds: string[] = groupsOfMember.get(value.toLowerCase()) ?? [];
        if (!groupIds.length) {
            return negated ? [{}] : [];
        }
        return [where(negated ? { notOneOf: groupIds } : { oneOf: groupIds })];
    }

    private static resolveTextComparison<T extends BaseEntity>(
        where: (condition: StringWhereFilter) => WhereFilter<T>,
        nullable: boolean,
        operator: ScimComparisonOperator,
        value: string,
        negated: boolean
    ): WhereFilter<T>[] {
        // a resource without a value matches no comparison, so it matches every negated one
        // eslint-disable-next-line unicorn/no-null
        const orAbsent: WhereFilter<T>[] = negated && nullable ? [where(null)] : [];
        const escaped: string = value.replaceAll(/[%\\_]/g, String.raw`\$&`);
        switch (operator) {
            case 'eq':
            case 'ne': {
                return [where((operator === 'eq') === negated ? { not: value } : value)];
            }
            case 'co':
            case 'sw':
            case 'ew': {
                const pattern: string = `${operator === 'sw' ? '' : '%'}${escaped}${operator === 'ew' ? '' : '%'}`;
                return [where(negated ? { notLike: pattern } : { like: pattern })];
            }
            case 'gt':
            case 'le': {
                const after: boolean = (operator === 'gt') !== negated;
                return after ? [where({ after: value })] : [where(value), where({ before: value }), ...orAbsent];
            }
            case 'ge':
            case 'lt': {
                const before: boolean = (operator === 'lt') !== negated;
                return before ? [where({ before: value }), ...orAbsent] : [where(value), where({ after: value })];
            }
        }
    }

    private static resolveDateComparison<T extends BaseEntity>(
        where: (condition: DateWhereFilter) => WhereFilter<T>,
        operator: ScimComparisonOperator,
        value: string | number | boolean,
        negated: boolean
    ): WhereFilter<T>[] {
        const date: Date = new Date(typeof value === 'string' ? value : Number.NaN);
        if (Number.isNaN(date.getTime())) {
            throw this.unsupportedFilter();
        }
        // what each comparison is, and what it is once negated
        const negations: Record<ScimComparisonOperator, ScimComparisonOperator | undefined> = {
            eq: 'ne', ne: 'eq', gt: 'le', le: 'gt', ge: 'lt', lt: 'ge', co: undefined, sw: undefined, ew: undefined
        };
        const effective: ScimComparisonOperator | undefined = negated ? negations[operator] : operator;
        switch (effective) {
            case 'eq': {
                return [where(date)];
            }
            case 'ne': {
                return [where({ not: date })];
            }
            case 'gt': {
                return [where({ after: date })];
            }
            case 'ge': {
                return [where({ afterOrOn: date })];
            }
            case 'lt': {
                return [where({ before: date })];
            }
            case 'le': {
                return [where({ beforeOrOn: date })];
            }
            case 'co':
            case 'sw':
            case 'ew':
            case undefined: {
                throw this.unsupportedFilter();
            }
        }
    }

    private static findColumn<T extends BaseEntity>(columns: Record<string, ScimColumn<T>>, key: string): ScimColumn<T> {
        const column: ScimColumn<T> | undefined = columns[key];
        if (column == undefined) {
            throw this.unsupportedFilter();
        }
        return column;
    }

    /**
     * Refuses a part of a filter on users the kept values do not answer: the attributes of meta are
     * kept in columns, and the groups of a user only by their id and name.
     * @param key - The attribute it is about.
     * @throws A ScimError (invalidFilter) when it is one of them.
     */
    private static validateIndexed(key: string): void {
        if (key === 'meta' || key.startsWith('meta.') || (this.isGroupsKey(key) && GROUP_ATTRIBUTES_OF_USER[key] == undefined)) {
            throw this.unsupportedFilter();
        }
    }

    /**
     * The order a sort by a column reads in.
     * @param column - The column.
     * @param direction - Which way it reads.
     * @returns The order.
     * @throws A ScimError (invalidValue) when the column is the members of a group.
     */
    private static resolveOrder<T extends BaseEntity>(column: ScimColumn<T>, direction: OrderDirection): EntityOrder<T> {
        if (column.kind === 'member') {
            throw this.unsupportedSort(false);
        }
        return column.order(direction);
    }

    private static unsupportedSort(users: boolean): ScimError {
        return new ScimError(
            HttpStatus.BAD_REQUEST,
            users
                ? $ts`Users are not sorted by groups, meta.version or meta.location.`
                : $ts`Groups sort by id, displayName, externalId, meta.created or meta.lastModified.`,
            ScimErrorType.INVALID_VALUE
        );
    }

    private static toDirection(sortOrder: string | undefined): OrderDirection {
        if (sortOrder == undefined || sortOrder.toLowerCase() === 'ascending') {
            return 'ASC';
        }
        if (sortOrder.toLowerCase() === 'descending') {
            return 'DESC';
        }
        throw new ScimError(HttpStatus.BAD_REQUEST, $ts`The sortOrder is ascending or descending.`, ScimErrorType.INVALID_VALUE);
    }

    private static validateFilterSize<T extends BaseEntity>(alternatives: WhereFilter<T>[]): WhereFilter<T>[] {
        if (alternatives.length > MAX_FILTER_ALTERNATIVES) {
            throw new ScimError(HttpStatus.BAD_REQUEST, $ts`The filter stands for too many alternatives.`, ScimErrorType.INVALID_FILTER);
        }
        return alternatives;
    }
}