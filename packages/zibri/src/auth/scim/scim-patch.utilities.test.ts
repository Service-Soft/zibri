import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { ScimErrorType } from './scim-error-type.enum';
import { ScimPatchOperation } from './scim-patch-operation.model';
import { ScimPatchUtilities } from './scim-patch.utilities';
import { ScimSchema } from './scim-schema.enum';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';

/**
 * Applies a patch request body to a resource.
 * @param resource - The resource.
 * @param operations - The operations, as a request body holds them.
 * @returns The patched resource.
 */
function patch(resource: Record<string, unknown>, operations: unknown[]): Record<string, unknown> {
    return ScimPatchUtilities.apply(resource, ScimPatchUtilities.resolveOperations({ schemas: [ScimSchema.PATCH_OP], Operations: operations }));
}

describe('ScimPatchUtilities', () => {
    let server: StartedTestServer;

    // an application around the pure logic, for the translated messages of the errors it throws
    beforeAll(async () => {
        server = await startTestServer({ dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities })] });
    });

    afterAll(async () => {
        await server.shutdown();
    });

    it('deactivates a user the way Entra ID does, leaving the resource it was given as it is', () => {
        const user: Record<string, unknown> = { userName: 'anna@example.com', active: true };

        const patched: Record<string, unknown> = patch(user, [{ op: 'Replace', path: 'active', value: false }]);

        expect(patched).toEqual({ userName: 'anna@example.com', active: false });
        expect(user['active']).toBe(true);
    });

    it('replaces attributes named by the value when no path is given, extensions included', () => {
        const operation: Record<string, unknown> = {
            op: 'replace',
            value: {
                displayName: 'Anna',
                'name.givenName': 'Anne',
                [ScimSchema.ENTERPRISE_USER]: { department: 'Sales' }
            }
        };
        const patched: Record<string, unknown> = patch({ userName: 'a', name: { givenName: 'A', familyName: 'B' } }, [operation]);

        expect(patched).toEqual({
            userName: 'a',
            displayName: 'Anna',
            name: { givenName: 'Anne', familyName: 'B' },
            [ScimSchema.ENTERPRISE_USER]: { department: 'Sales' }
        });
    });

    it('changes the item of a multi-valued attribute a filter names, and adds it when there is none', () => {
        const user: Record<string, unknown> = { emails: [{ type: 'work', value: 'old@example.com' }] };

        const replaced: Record<string, unknown> = patch(user, [{ op: 'replace', path: 'emails[type eq "work"].value', value: 'new@example.com' }]);
        const added: Record<string, unknown> = patch(user, [{ op: 'add', path: 'phoneNumbers[type eq "mobile"].value', value: '+49 1' }]);

        expect(replaced['emails']).toEqual([{ type: 'work', value: 'new@example.com' }]);
        expect(added['phoneNumbers']).toEqual([{ type: 'mobile', value: '+49 1' }]);
    });

    it('adds and removes members, by a filter or by a list of values, without adding one twice', () => {
        const group: Record<string, unknown> = { displayName: 'staff', members: [{ value: 'a' }] };

        const added: Record<string, unknown> = patch(group, [{ op: 'Add', path: 'members', value: [{ value: 'a' }, { value: 'b' }, { value: 'c' }] }]);
        const byFilter: Record<string, unknown> = patch(added, [{ op: 'remove', path: 'members[value eq "b"]' }]);
        const byList: Record<string, unknown> = patch(added, [{ op: 'Remove', path: 'members', value: [{ value: 'a' }, { value: 'c' }] }]);

        expect(added['members']).toEqual([{ value: 'a' }, { value: 'b' }, { value: 'c' }]);
        expect(byFilter['members']).toEqual([{ value: 'a' }, { value: 'c' }]);
        expect(byList['members']).toEqual([{ value: 'b' }]);
    });

    it('removes an attribute, and an attribute of an extension', () => {
        const patched: Record<string, unknown> = patch(
            { title: 'Boss', [ScimSchema.ENTERPRISE_USER]: { manager: { value: 'x' }, department: 'Sales' } },
            [
                { op: 'remove', path: 'title' },
                { op: 'remove', path: `${ScimSchema.ENTERPRISE_USER}:manager` }
            ]
        );

        expect(patched).toEqual({ [ScimSchema.ENTERPRISE_USER]: { department: 'Sales' } });
    });

    it('refuses what it cannot apply, with the type of error SCIM names', () => {
        const refusals: [unknown[], ScimErrorType][] = [
            [[{ op: 'remove' }], ScimErrorType.NO_TARGET],
            [[{ op: 'replace', path: 'id', value: 'x' }], ScimErrorType.MUTABILITY],
            [[{ op: 'replace', path: 'emails[type eq "work"', value: 'x' }], ScimErrorType.INVALID_PATH],
            [[{ op: 'replace', path: 'emails[type ne "work"].value', value: 'x' }], ScimErrorType.NO_TARGET],
            [[{ op: 'move', path: 'title' }], ScimErrorType.INVALID_SYNTAX]
        ];
        for (const [operations, scimType] of refusals) {
            expect(() => patch({}, operations)).toThrow(expect.objectContaining({ body: expect.objectContaining({ scimType }) }));
        }
    });

    it('refuses a body that is not a patch request', () => {
        expect(() => ScimPatchUtilities.resolveOperations({ Operations: [] })).toThrow(expect.objectContaining({ status: 400 }));
        const operations: ScimPatchOperation[] = ScimPatchUtilities.resolveOperations({ schemas: [ScimSchema.PATCH_OP], Operations: [] });
        expect(operations).toEqual([]);
    });
});