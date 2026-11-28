import { describe, expect, it } from '@jest/globals';

import { definePermissions } from '../../auth/roles/define-permissions.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { BaseEntity } from '../base-entity.model';
import { BaseTenantEntity } from '../base-tenant-entity.model';
import { Entity } from './entity.decorator';
import { Property } from './property.decorator';

/**
 * What `shareable` and `sharedThrough` have to say for the rows to be narrowed the way they declare.
 */

// eslint-disable-next-line typescript/typedef
const Permissions = definePermissions(['projects.read'] as const);

/**
 * Asserts that a declaration is refused, and that the message says enough to act on.
 * @param declare - Declares the entity, applying the decorators under test.
 * @param fragments - What the message has to name.
 */
function expectRefusal(declare: () => unknown, ...fragments: string[]): void {
    expect(declare).toThrow(InternalError);
    for (const fragment of fragments) {
        expect(declare).toThrow(fragment);
    }
}

describe('sharing declarations', () => {
    it('refuses the rows of no tenant', () => {
        expectRefusal(
            () => {
                @Entity({ tenant: 'shared', allowOrphan: true, shareable: { fullAccess: Permissions.PROJECTS_READ, roles: ['viewer'] } })
                class Board extends BaseEntity {}
                return Board;
            },
            'Board',
            'belongs to no tenant'
        );
    });

    it('refuses a parent that is no relation to one row', () => {
        expectRefusal(
            () => {
                @Entity({ allowOrphan: true, shareable: { fullAccess: Permissions.PROJECTS_READ, parent: 'parentId', roles: ['viewer'] } })
                class Board extends BaseTenantEntity() {
                    @Property.string({ format: 'uuid', required: false })
                    parentId?: string | null;
                }
                return Board;
            },
            '"parent" names "parentId"',
            'no "manyToOne" or "belongsToOne" relation'
        );
    });

    it('refuses a role named twice', () => {
        expectRefusal(
            () => {
                @Entity({ allowOrphan: true, shareable: { fullAccess: Permissions.PROJECTS_READ, roles: ['viewer', 'editor', 'viewer'] } })
                class Board extends BaseTenantEntity() {}
                return Board;
            },
            'name a role twice'
        );
    });

    it('refuses an entity shared on its own and through a relation at once', () => {
        expectRefusal(
            () => {
                @Entity({ allowOrphan: true })
                class Board extends BaseTenantEntity() {}

                @Entity({ allowOrphan: true, sharedThrough: 'board', shareable: { fullAccess: Permissions.PROJECTS_READ, roles: ['viewer'] } })
                class Card extends BaseTenantEntity() {
                    @Property.string({ format: 'uuid' })
                    boardId!: string;

                    @Property.manyToOne({ target: () => Board, joinColumn: 'boardId', inverseSide: 'id' })
                    board!: Board;
                }
                return Card;
            },
            'declares "shareable" and "sharedThrough"'
        );
    });

    it('refuses a relation to share through that is no column of the row', () => {
        expect(() => {
            @Entity({ allowOrphan: true, sharedThrough: 'cards' })
            class Board extends BaseTenantEntity() {
                @Property.oneToMany({ target: () => Board, inverseSide: 'id', required: false })
                cards?: Board[];
            }
            return Board;
        }).toThrow('"sharedThrough" names "cards"');
    });
});
