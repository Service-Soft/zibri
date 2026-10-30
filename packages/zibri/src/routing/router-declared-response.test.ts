import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { Controller } from './decorators/controller.decorator';
import { Get } from './decorators/get.decorator';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { type PaginationResult } from '../data-source/models/pagination-result.model';
import { Property } from '../entity/decorators/property.decorator';
import { type OneOf } from '../entity/models/one-of.model';
import { Response } from '../open-api/decorators/response.decorator';

class Address {
    @Property.string()
    city!: string;
}

class Preferences {
    @Property.string()
    theme!: string;
}

class Cat {
    @Property.string()
    meows!: string;
}

class Dog {
    @Property.string()
    barks!: string;
}

class UserDto {
    @Property.string()
    id!: string;

    @Property.string()
    email!: string;

    @Property.date()
    createdAt!: Date;

    @Property.object({ cls: () => Address })
    address!: Address;

    @Property.object({ cls: () => Preferences, allowAdditionalProperties: true })
    preferences!: Preferences;

    @Property.unknown()
    settings!: unknown;

    @Property.oneOf({ shapes: { Cat: { type: 'object', cls: () => Cat }, Dog: { type: 'object', cls: () => Dog } } })
    pet!: OneOf<{ Cat: Cat, Dog: Dog }>;
}

/**
 * A body of whatever attributes a protocol gives it, such as a SCIM resource: a class declaring no
 * property.
 */
class AnyAttributes {
    [attribute: string]: unknown
}

/**
 * What the handlers hold: the user as stored, with what the response does not declare.
 */
type StoredUser = UserDto & {
    passwordHash: string,
    address: Address & { street: string },
    pet: { shape: 'Cat', value: Cat & { chipId: string } }
};

const createdAt: Date = new Date('2026-10-25T08:00:00.000Z');

/**
 * A user as the application holds it.
 * @param id - The id of the user.
 * @returns The stored user.
 */
function storedUser(id: string): StoredUser {
    return {
        id,
        email: `${id}@example.com`,
        createdAt,
        passwordHash: 'scrypt$secret',
        address: { city: 'Berlin', street: 'Hidden street 1' },
        preferences: Object.assign(new Preferences(), { theme: 'dark', fontSize: 14 }),
        settings: { anything: { goes: true } },
        pet: { shape: 'Cat', value: { meows: 'loud', chipId: 'chip-1' } }
    };
}

const expected: Record<string, unknown> = {
    id: 'ada',
    email: 'ada@example.com',
    createdAt: createdAt.toISOString(),
    address: { city: 'Berlin' },
    preferences: { theme: 'dark', fontSize: 14 },
    settings: { anything: { goes: true } },
    pet: { shape: 'Cat', value: { meows: 'loud' } }
};

@Controller('/declared-users')
class DeclaredUserController {
    @Response.object(UserDto)
    @Get('/one')
    findOne(): UserDto {
        return storedUser('ada');
    }

    @Response.array(UserDto)
    @Get('/all')
    findAll(): UserDto[] {
        return [storedUser('ada')];
    }

    @Response.paginated(UserDto)
    @Get('/page')
    findPage(): PaginationResult<UserDto> {
        return { items: [storedUser('ada')], totalAmount: 1 };
    }

    @Get('/undeclared')
    findUndeclared(): StoredUser {
        return storedUser('ada');
    }

    @Response.object(AnyAttributes)
    @Get('/any')
    findAny(): AnyAttributes {
        const attributes: AnyAttributes = { ...storedUser('ada') };
        return attributes;
    }
}

/**
 * A response declares the class it answers with, and is written with what that class declares: a
 * handler returning the stored user under a declaration of what may leave the server sent every
 * column it held, the password hash included (08 §X22).
 */
describe('Router - answering with what the response declares', () => {
    let server: StartedTestServer;
    let baseUrl: string;

    beforeAll(async () => {
        server = await startTestServer({
            controllers: [DeclaredUserController],
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })]
        });
        baseUrl = await server.start();
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    /**
     * Reads a route of the controller.
     * @param route - The route below the controller.
     * @returns The parsed body.
     */
    async function read(route: string): Promise<unknown> {
        const response: globalThis.Response = await fetch(`${baseUrl}/declared-users/${route}`);
        expect(response.status).toBe(200);
        return await response.json();
    }

    it('writes an object with the properties its class declares, nested ones included', async () => {
        expect(await read('one')).toEqual(expected);
    });

    it('writes every item of an array the same way', async () => {
        expect(await read('all')).toEqual([expected]);
    });

    it('writes the items of a page the same way, and the page around them', async () => {
        expect(await read('page')).toEqual({ items: [expected], totalAmount: 1 });
    });

    it('writes a route that declares no response, or a class declaring no property, as it was returned', async () => {
        const returned: Record<string, unknown> = {
            ...expected,
            passwordHash: 'scrypt$secret',
            address: { city: 'Berlin', street: 'Hidden street 1' },
            pet: { shape: 'Cat', value: { meows: 'loud', chipId: 'chip-1' } }
        };

        expect(await read('undeclared')).toEqual(returned);
        expect(await read('any')).toEqual(returned);
    });
});