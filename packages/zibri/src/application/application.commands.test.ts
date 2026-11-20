import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource, TestCommandRun } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { JwtUser } from '../__testing__/mocks/entities/jwt-user.entity';
import { Roles } from '../__testing__/mocks/entities/roles.enum';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { inject } from '../di/inject.function';
import { AppCommand } from './app-command.model';
import { ZibriApplication } from './application';
import { ZibriApplicationOptions } from './application-options.model';

/**
 * What the command of this file was handed, each time it ran.
 */
type CommandCall = {
    args: string[],
    users: number
};

const calls: CommandCall[] = [];

const countUsers: AppCommand = {
    name: 'count-users',
    description: 'Logs how many users there are',
    run: async (args: string[]): Promise<void> => {
        // through the container, which is only filled once the application is initialized
        const users: JwtUser[] = await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).findAll();
        calls.push({ args, users: users.length });
    }
};

const failing: AppCommand = {
    name: 'fail',
    description: 'Fails',
    run: async (): Promise<void> => {
        await Promise.resolve();
        throw new Error('the command failed');
    }
};

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

let server: StartedTestServer | undefined;

/**
 * Hands over the started server.
 * @returns The server.
 * @throws When the server did not start.
 */
function getServer(): StartedTestServer {
    if (server == undefined) {
        throw new Error('the server did not start');
    }
    return server;
}

beforeAll(async () => {
    server = await startTestServer({ dataSources: [dataSourceClass], commands: [countUsers, failing] });
    await inject<Repository<JwtUser>>(repositoryTokenFor(JwtUser)).create({ email: 'ada@example.com', roles: [Roles.USER] });
}, TestTimeouts.inMemory.start);

afterAll(async () => {
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

// an application had no way to run code of its own from the shell, such as letting a locked out
// admin in again, other than starting a whole instance for it
describe('the commands of an application', () => {
    it('run the command the first argument names, with the arguments after it, on the initialized application', async () => {
        const run: TestCommandRun = await getServer().runCommand(['count-users', '--verbose', 'ada']);

        expect(run.ran).toBe(true);
        expect(calls.at(-1)).toEqual({ args: ['--verbose', 'ada'], users: 1 });
    }, TestTimeouts.inMemory.restart);

    it('fail with what the command threw', async () => {
        await expect(getServer().runCommand(['fail'])).rejects.toThrow('the command failed');
    }, TestTimeouts.inMemory.restart);

    it('start the application on a word that names none of them, warning with every command and what it does', async () => {
        // eslint-disable-next-line cspell/spellchecker
        const run: TestCommandRun = await getServer().runCommand(['count-usres']);

        expect(run.ran).toBe(false);
        const warned: string[] = run.warnings.filter(w => w.includes('is no command'));
        expect(warned).toHaveLength(1);
        // eslint-disable-next-line cspell/spellchecker
        expect(warned[0]).toContain('"count-usres" is no command of this application, so it starts');
        expect(warned[0]).toMatch(/count-users\s+Logs how many users there are/);
    }, TestTimeouts.inMemory.restart);

    it('leave an option to the application, which starts without a warning', async () => {
        const run: TestCommandRun = await getServer().runCommand(['--inspect']);

        expect(run.ran).toBe(false);
        expect(run.warnings.filter(w => w.includes('is no command'))).toEqual([]);
    }, TestTimeouts.inMemory.restart);

    it('leave any word to an application without commands, which starts without a warning', async () => {
        const run: TestCommandRun = await getServer().runCommand(['count-users'], { commands: [] });

        expect(run.ran).toBe(false);
        expect(run.warnings.filter(w => w.includes('is no command'))).toEqual([]);
    }, TestTimeouts.inMemory.restart);
});

describe('the names of the commands of an application', () => {
    const options: ZibriApplicationOptions = {
        name: 'commands',
        baseUrl: 'http://localhost:3000',
        version: '1.0.0',
        environment: 'development',
        controllers: [],
        websocketControllers: [],
        defaultAuth: 'public',
        twoFactorAtLogin: 'never'
    };

    /**
     * A command of the given name that does nothing.
     * @param name - The name.
     * @returns The command.
     */
    function commandNamed(name: string): AppCommand {
        return { name, description: 'Does nothing', run: async () => {} };
    }

    it('refuse a name the command could not be started with, as the application is built', () => {
        for (const name of ['migrate', 'reset admin', '-reset', '']) {
            expect(() => new ZibriApplication({ ...options, commands: [commandNamed(name)] })).toThrow(`The command "${name}" needs a name of one word`);
        }
    });

    it('refuse two commands of the same name', () => {
        expect(() => new ZibriApplication({ ...options, commands: [commandNamed('reset-admin'), commandNamed('reset-admin')] }))
            .toThrow('Two commands are named "reset-admin"');
    });
});