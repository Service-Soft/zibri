import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { ScimErrorType } from './scim-error-type.enum.ts';
import { ScimFilter } from './scim-filter.model.ts';
import { ScimFilterUtilities } from './scim-filter.utilities.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';

const anna: Record<string, unknown> = {
    userName: 'Anna@Example.com',
    active: true,
    name: { givenName: 'Anna', familyName: 'Berg' },
    emails: [{ value: 'anna@example.com', type: 'work', primary: true }, { value: 'anna@home.test', type: 'home' }],
    'urn:ietf:params:scim:schemas:extension:enterprise:2.0:User': { employeeNumber: '42' }
};

/**
 * Whether anna matches a filter.
 * @param text - The filter.
 * @returns True when she does.
 */
function annaMatches(text: string): boolean {
    return ScimFilterUtilities.matches(ScimFilterUtilities.parse(text), anna);
}

describe('ScimFilterUtilities', () => {
    let server: StartedTestServer;

    // an application around the pure logic, for the translated messages of the errors it throws
    beforeAll(async () => {
        server = await startTestServer({ dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities })] });
    });

    afterAll(async () => {
        await server.shutdown();
    });

    it('reads the filters identity providers send to find a user or a group', () => {
        expect(ScimFilterUtilities.parse('userName eq "anna@example.com"')).toEqual({
            type: 'comparison',
            path: { uri: undefined, attribute: 'userName', subAttribute: undefined },
            operator: 'eq',
            value: 'anna@example.com'
        });
        const membership: ScimFilter = ScimFilterUtilities.parse('id eq "a1" and members[value eq "b2"]');
        expect(membership).toMatchObject({ type: 'and', right: { type: 'valuePath', path: { attribute: 'members' } } });
    });

    it('compares text without regard to case, and attribute names too', () => {
        expect(annaMatches('username eq "anna@example.com"')).toBe(true);
        expect(annaMatches('userName ne "anna@example.com"')).toBe(false);
        expect(annaMatches('name.givenName sw "an"')).toBe(true);
        expect(annaMatches('name.familyName co "er"')).toBe(true);
    });

    it('matches a multi-valued attribute when any item does', () => {
        expect(annaMatches('emails eq "anna@home.test"')).toBe(true);
        expect(annaMatches('emails[type eq "work" and primary eq true]')).toBe(true);
        expect(annaMatches('emails[type eq "other"]')).toBe(false);
        expect(annaMatches('emails.type eq "home"')).toBe(true);
    });

    it('reads and, or, not, grouping and presence, and binds and tighter than or', () => {
        expect(annaMatches('active eq false or userName eq "anna@example.com" and active eq true')).toBe(true);
        expect(annaMatches('(active eq false or userName eq "anna@example.com") and active eq false')).toBe(false);
        expect(annaMatches('not (active eq false)')).toBe(true);
        expect(annaMatches('title pr')).toBe(false);
        expect(annaMatches('name pr')).toBe(true);
    });

    it('reads an attribute of an extension named with its schema', () => {
        expect(annaMatches('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:employeeNumber eq "42"')).toBe(true);
        expect(annaMatches('urn:ietf:params:scim:schemas:core:2.0:User:userName eq "anna@example.com"')).toBe(true);
    });

    it('reads escapes in a string', () => {
        expect(ScimFilterUtilities.parse(String.raw`displayName eq "say \"hi\""`)).toMatchObject({ value: 'say "hi"' });
    });

    it('refuses what is not a filter, as an invalid filter', () => {
        for (const text of ['userName', 'userName eq', 'userName is "a"', '(userName eq "a"', 'userName eq "a" extra', '"a" eq "a"', 'emails[type eq "a"']) {
            expect(() => ScimFilterUtilities.parse(text)).toThrow(expect.objectContaining({ body: expect.objectContaining({ scimType: ScimErrorType.INVALID_FILTER }) }));
        }
    });
});