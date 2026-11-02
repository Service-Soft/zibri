import { ScimBody } from './scim-body.model';
import { ScimListQuery } from './scim-list-query.model';
import { ScimSchema } from './scim-schema.enum';
import { ScimUserPages } from './scim-user-pages.model';
import { ScimUserValue } from './scim-user-value.model';
import { ScimUser } from './scim-user.model';
import { ScimValueSort } from './scim-value-sort.model';
import { WhereFilter } from '../../data-source/models/where/where-filter.model';
import { ScopedWhere, ScopeWhereUtilities } from '../../data-source/scopes/scope-where.utilities';
import { EntityOrder } from '../../entity/models/entity-order.model';
import { MetadataUtilities } from '../../utilities/metadata.utilities';

/**
 * Reads the pages of the lists SCIM answers (RFC 7644, 3.4.2): where a page starts, how long it is,
 * and the users on it, sorted by a column or by the value of an attribute.
 */
export abstract class ScimPagingUtilities {
    /**
     * Resolves where the page a list asks for starts, counting from 1.
     * @param query - What the list asks for.
     * @returns The index of its first resource.
     */
    static resolveStartIndex(query: ScimListQuery): number {
        return Math.max(1, Math.trunc(query.startIndex ?? 1));
    }

    /**
     * Resolves how many resources the page a list asks for holds.
     * @param query - What the list asks for.
     * @param maxResults - The most resources a list answers.
     * @returns As many as it asks for, at most `maxResults`, and as many when it does not say.
     */
    static resolveCount(query: ScimListQuery, maxResults: number): number {
        return Math.min(maxResults, Math.max(0, Math.trunc(query.count ?? maxResults)));
    }

    /**
     * Builds the response of a list.
     * @param resources - The resources of the page.
     * @param totalResults - How many resources the whole list holds.
     * @param startIndex - Where the page starts.
     * @returns The list response.
     */
    static toListBody(resources: ScimBody[], totalResults: number, startIndex: number): ScimBody {
        return { schemas: [ScimSchema.LIST_RESPONSE], totalResults, startIndex, itemsPerPage: resources.length, Resources: resources };
    }

    /**
     * Reads users for a list, removing a resource whose user is gone as it is found and reading the
     * page again without it.
     * @param pages - What reading users needs.
     * @param query - What the list asks for.
     * @param maxResults - The most resources a list answers.
     * @param where - The alternatives of its filter.
     * @param order - The order it reads in.
     * @returns The list response.
     */
    static async resolveUserPage(
        pages: ScimUserPages,
        query: ScimListQuery,
        maxResults: number,
        where: WhereFilter<ScimUser>[] | undefined,
        order: EntityOrder<ScimUser>
    ): Promise<ScimBody> {
        const startIndex: number = this.resolveStartIndex(query);
        const count: number = this.resolveCount(query, maxResults);
        const totalResults: number = await pages.users.count({ where });
        const found: ScimUser[] = count === 0 ? [] : await pages.users.findAll({ where, order, offset: startIndex - 1, limit: count });
        const orphans: ScimUser[] = await pages.findOrphans(found);
        if (orphans.length) {
            await pages.removeOrphans(orphans);
            return await this.resolveUserPage(pages, query, maxResults, where, order);
        }
        return this.toListBody(await pages.resolveBodies(found), totalResults, startIndex);
    }

    /**
     * Reads users for a list sorted by an attribute without a column of its own: those with a value
     * of it in its order, and those without one by id, last when ascending and first when descending
     * as a column without a value reads.
     * @param pages - What reading users needs.
     * @param query - What the list asks for.
     * @param maxResults - The most resources a list answers.
     * @param where - The alternatives of its filter.
     * @param sort - The attribute it sorts by.
     * @returns The list response.
     */
    static async resolveValueSortedPage(
        pages: ScimUserPages,
        query: ScimListQuery,
        maxResults: number,
        where: WhereFilter<ScimUser>[] | undefined,
        sort: ScimValueSort
    ): Promise<ScimBody> {
        const startIndex: number = this.resolveStartIndex(query);
        const count: number = this.resolveCount(query, maxResults);
        const totalResults: number = await pages.users.count({ where });
        // the values are narrowed to the users the filter finds, which reads every one of them: a
        // sort by a value with a filter is rare enough to pay that rather than keep the two together
        const filteredIds: string[] | undefined = where == undefined
            ? undefined
            : (await pages.users.findAll({ where, limit: 'all' })).map(user => user.id);
        const valueWhere: WhereFilter<ScimUserValue> = {
            path: { oneOf: sort.paths },
            sortValue: true,
            ...filteredIds == undefined ? {} : { scimUserId: { oneOf: filteredIds } }
        };
        const withValue: number = await pages.values.count({ where: valueWhere });
        const withoutFirst: boolean = sort.direction === 'DESC';
        const firstSize: number = withoutFirst ? totalResults - withValue : withValue;
        const offset: number = startIndex - 1;
        const firstLimit: number = Math.max(0, Math.min(count, firstSize - offset));
        const first: [number, number] = [Math.min(offset, firstSize), firstLimit];
        const second: [number, number] = [Math.max(0, offset - firstSize), count - firstLimit];
        const found: ScimUser[] = withoutFirst
            ? [
                ...await this.findUsersWithoutValue(pages, where, valueWhere, ...first),
                ...await this.findUsersWithValue(pages, valueWhere, sort, ...second)
            ]
            : [
                ...await this.findUsersWithValue(pages, valueWhere, sort, ...first),
                ...await this.findUsersWithoutValue(pages, where, valueWhere, ...second)
            ];
        const orphans: ScimUser[] = await pages.findOrphans(found);
        if (orphans.length) {
            await pages.removeOrphans(orphans);
            return await this.resolveValueSortedPage(pages, query, maxResults, where, sort);
        }
        return this.toListBody(await pages.resolveBodies(found), totalResults, startIndex);
    }

    private static async findUsersWithValue(
        pages: ScimUserPages,
        valueWhere: WhereFilter<ScimUserValue>,
        sort: ScimValueSort,
        offset: number,
        limit: number
    ): Promise<ScimUser[]> {
        if (limit <= 0) {
            return [];
        }
        const values: ScimUserValue[] = await pages.values.findAll({
            where: valueWhere,
            order: { text: sort.direction, number: sort.direction, boolean: sort.direction, scimUserId: 'ASC' },
            offset,
            limit
        });
        const ids: string[] = values.map(value => value.scimUserId);
        const users: ScimUser[] = await pages.users.findAll({ where: { id: { oneOf: ids } }, limit: 'all' });
        const byId: Map<string, ScimUser> = new Map(users.map(user => [user.id, user]));
        return values.map(value => byId.get(value.scimUserId)).filter(user => user != undefined);
    }

    private static async findUsersWithoutValue(
        pages: ScimUserPages,
        where: WhereFilter<ScimUser>[] | undefined,
        valueWhere: WhereFilter<ScimUserValue>,
        offset: number,
        limit: number
    ): Promise<ScimUser[]> {
        if (limit <= 0) {
            return [];
        }
        const holders: string[] = await pages.findValueHolders(valueWhere);
        const without: ScopedWhere<ScimUser> = ScopeWhereUtilities.applyToWhere(
            where,
            holders.length ? { id: { notOneOf: holders } } : undefined,
            MetadataUtilities.getModelProperties(ScimUser)
        );
        return without.matchesNothing ? [] : await pages.users.findAll({ where: without.where, order: { id: 'ASC' }, offset, limit });
    }
}