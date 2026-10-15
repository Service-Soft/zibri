import { execSync } from 'node:child_process';
import path from 'node:path';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

import { NewCommand } from './new.command';
import { version } from '../../../package.json';
import { emptyWorkDirectory } from '../../__testing__/empty-work-directory.function';
import { quietly } from '../../__testing__/quietly.function';
import { CPUtilities, FsUtilities } from '../../encapsulation';
import { Path } from '../../utilities';

/**
 * Whether the Dockerfile "zi new" writes produces an image that actually serves the application.
 *
 * Everything else about the scaffold is checked by reading what the generator wrote. A deployment
 * cannot be checked that way: the questions that matter are whether the install inside the image
 * resolves, whether the build stage produces the file the runtime stage starts, whether the folders
 * the application reads from beside the bundle are in the image, and whether the user it runs as can
 * write the two paths it writes to. Every one of those is a runtime answer, and the failure mode of
 * getting one wrong is a container that restarts forever rather than a file that looks wrong.
 */

const REPOSITORY_ROOT: string = path.join(__dirname, '..', '..', '..', '..', '..');

/**
 * The image the generated Dockerfile builds on, named here as well so that the lock this test hands
 * it is written by the same npm that will read it.
 */
const BASE_IMAGE: string = 'node:24-slim';

const IMAGE_TAG: string = 'zibri-scaffold-deployment-test';
const NETWORK_NAME: string = 'zibri-scaffold-deployment-test';
const DATABASE_CONTAINER: string = 'zibri-scaffold-deployment-db';
const APPLICATION_CONTAINER: string = 'zibri-scaffold-deployment-app';
const REGISTRY_CONTAINER: string = 'zibri-scaffold-deployment-registry';
const REGISTRY_IMAGE: string = 'verdaccio/verdaccio:6';
const REGISTRY_PORT: number = 4873;

/**
 * The registry as the machine running this test reaches it, which is where the three workspace
 * packages are published and where the generator installs them from.
 */
const REGISTRY_FROM_HOST: string = `http://127.0.0.1:${REGISTRY_PORT}`;

/**
 * The registry as a container on the network reaches it.
 *
 * The distinction is the whole reason the lock is written inside a container: `npm ci` fetches the
 * urls the lock resolved to, and a lock written here would send the image to its own localhost.
 */
const REGISTRY_FROM_NETWORK: string = `http://${REGISTRY_CONTAINER}:${REGISTRY_PORT}`;

/**
 * The version every workspace package carries, which is the one the generator asks the registry for.
 */
const WORKSPACE_VERSION: string = version;

/**
 * Where the container is published on the host.
 *
 * Fixed rather than picked by the operating system, because the port a container publishes has to be
 * named before it is started and nothing here can ask docker for a free one first.
 */
const HOST_PORT: number = 38_080;

/**
 * How long the image is given to build.
 *
 * It runs two npm installs and a webpack build, none of which are cached between runs, so this is
 * minutes rather than seconds even on a machine that has the base image already.
 */
const BUILD_TIMEOUT_MS: number = 1_200_000;

const PROBE_TIMEOUT_MS: number = 60_000;

/**
 * How long the application is given to answer its own health check.
 *
 * Longer than the probes above, because the first boot against an empty database builds the whole
 * schema from the entities before it listens. A container that dies rather than starting slowly is
 * noticed straight away and does not wait this out.
 */
const APPLICATION_TIMEOUT_MS: number = 180_000;

let workDir: Path;
let appDir: Path;

function run(command: string, cwd: string = REPOSITORY_ROOT): string {
    try {
        return execSync(command, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    }
    catch (error) {
        // execSync's own message is the command and its exit status, so a docker build that fails
        // reports that it failed and nothing about why. What the command wrote is the whole answer,
        // and it is captured rather than inherited precisely so it does not arrive as noise earlier
        throw new Error(`${command}\n\n${outputOf(error)}`, { cause: error });
    }
}

/**
 * What a failed command wrote, from whichever streams it wrote to.
 * @param error - What `execSync` raised.
 * @returns Its output, or an empty string when it produced none.
 */
function outputOf(error: unknown): string {
    if (typeof error !== 'object' || error == undefined) {
        return '';
    }
    const written: string[] = [];
    if ('stdout' in error && error.stdout != undefined) {
        // eslint-disable-next-line typescript/no-base-to-string
        written.push(String(error.stdout));
    }
    if ('stderr' in error && error.stderr != undefined) {
        // eslint-disable-next-line typescript/no-base-to-string
        written.push(String(error.stderr));
    }
    return written.join('');
}

/**
 * What a container has to say for itself, for a failure that has to be read rather than asserted on.
 *
 * `docker logs` writes the container's stderr to this process's stderr, and `run` hands back stdout
 * alone - so an application that died saying exactly why would be reported as one that said nothing
 * and stopped. Merging the two is the difference between a diagnosis and a guess.
 * @param container - The container to ask.
 * @returns Its state and everything it wrote, on both streams.
 */
function containerDiagnostics(container: string): string {
    const state: string = run(`docker inspect -f '{{.State.Status}} (exit code {{.State.ExitCode}})' ${container}`).trim();
    // eslint-disable-next-line sonar/no-nested-template-literals
    return `"${container}" is ${state} and wrote:\n${run(`docker logs ${container} 2>&1`)}`;
}

/**
 * Runs a command whose failure is not interesting, which is what tearing down is made of.
 * @param command - The command to run.
 */
function runQuietly(command: string): void {
    try {
        run(command);
    }
    catch {
        // a container that was never started is nothing to report
    }
}

/**
 * Where the credentials for the throwaway registry are written.
 * @returns The path to the npmrc this run publishes with.
 */
function npmrcPath(): Path {
    return path.join(workDir, 'registry.npmrc') as Path;
}

/**
 * Whether the registry is serving the version of a package that this repository just published.
 * @param packageName - The package to look up.
 * @throws When the registry does not hold it, saying which versions it does hold.
 */
async function assertPublished(packageName: string): Promise<void> {
    const response: Response = await fetch(`${REGISTRY_FROM_HOST}/${packageName}`);
    if (!response.ok) {
        throw new Error(`The registry answered ${response.status} for "${packageName}" after it was published to it.`);
    }

    const metadata: unknown = await response.json();
    const versions: string[] = typeof metadata === 'object' && metadata != undefined && 'versions' in metadata
        && typeof metadata.versions === 'object' && metadata.versions != undefined
        ? Object.keys(metadata.versions)
        : [];

    if (!versions.includes(WORKSPACE_VERSION)) {
        throw new Error(
            `The registry holds "${packageName}" at ${versions.join(', ') || 'no versions at all'},`
            + ` and this repository publishes ${WORKSPACE_VERSION}. A name that resolves to versions`
            + ' nobody here published is the public registry answering instead of the local one.'
        );
    }
}

/**
 * Builds a workspace package and publishes it to the throwaway registry.
 *
 * None of the three are on the public registry yet, and the generated Dockerfile installs before it
 * copies any sources - deliberately, so that a source change reuses the dependency layer. That
 * ordering leaves no way to reach a local file, so the packages are served the way a real consumer
 * gets them instead. It is also the more faithful test: what is exercised is the published shape.
 * @param packageDir - The workspace package to build and publish.
 */
function publishWorkspacePackage(packageDir: string): void {
    const absolutePath: string = path.join(REPOSITORY_ROOT, packageDir);
    run('npm run build', absolutePath);
    // the npmrc is named outright rather than reached through HOME. A test run under "npm" or "npx"
    // inherits npm_config_userconfig and npm_config_cache from whichever npm started it, and those
    // beat anything HOME decides - so npm read the real user's npmrc, found no token for a registry
    // it has never seen, and refused to publish. It asks for credentials whatever the registry on the
    // other end is willing to accept; the one it gets here is a word nothing checks.
    run(
        `npm publish --registry ${REGISTRY_FROM_HOST} --userconfig "${npmrcPath()}"`,
        absolutePath
    );
}

/**
 * Waits for something to become true, and says what was happening when it does not.
 * @param isReady - The condition to poll.
 * @param timeoutMs - How long to poll for.
 * @param describeFailure - What to raise when the time runs out.
 */
async function waitFor(isReady: () => Promise<boolean>, timeoutMs: number, describeFailure: () => string): Promise<void> {
    const deadline: number = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (await isReady()) {
            return;
        }
        await new Promise<void>(resolve => setTimeout(resolve, 1000));
    }
    throw new Error(describeFailure());
}

/**
 * Asks the running application something over http.
 * @param route - The route to request.
 * @returns The response.
 */
async function request(route: string): Promise<Response> {
    return await fetch(`http://127.0.0.1:${HOST_PORT}${route}`);
}

/**
 * Starts the registry the three workspace packages are served from, and waits for it to answer.
 *
 * Its storage stays inside the container, so every run starts from an empty registry and the publish
 * below cannot collide with a version it already holds.
 */
async function startRegistry(): Promise<void> {
    const configPath: Path = path.join(workDir, 'verdaccio.yaml') as Path;
    await FsUtilities.createFile(configPath, [
        'storage: /verdaccio/storage',
        'uplinks:',
        '    npmjs:',
        '        url: https://registry.npmjs.org/',
        'packages:',
        // the three that are only here. Named before the catch-all and without an uplink, so that a
        // name which also exists publicly resolves to what this run published rather than to npm
        '    \'zibri\':',
        '        access: $all',
        '        publish: $all',
        '    \'zibri-tsx\':',
        '        access: $all',
        '        publish: $all',
        '    \'zibri-testing\':',
        '        access: $all',
        '        publish: $all',
        // everything else is proxied, which is what makes this a registry the whole install can go
        // through rather than one holding three packages and nothing they depend on
        '    \'**\':',
        '        access: $all',
        '        proxy: npmjs',
        'log:',
        '    type: stdout',
        '    format: pretty',
        '    level: warn'
    ]);

    // not called ".npmrc": a file by that name beside the generated project would be picked up as
    // project config by every npm run from here, including the ones inside the image
    await FsUtilities.createFile(npmrcPath(), [
        `registry=${REGISTRY_FROM_HOST}/`,
        `//127.0.0.1:${REGISTRY_PORT}/:_authToken=anonymous`
    ]);

    run(
        `docker run -d --name ${REGISTRY_CONTAINER} --network ${NETWORK_NAME}`
        + ` -p ${REGISTRY_PORT}:${REGISTRY_PORT} -v "${configPath}":/verdaccio/conf/config.yaml`
        + ` ${REGISTRY_IMAGE}`
    );

    await waitFor(
        async () => {
            try {
                return (await fetch(`${REGISTRY_FROM_HOST}/-/ping`)).ok;
            }
            catch {
                return false;
            }
        },
        PROBE_TIMEOUT_MS,
        () => `The registry never came up.\n\n${containerDiagnostics(REGISTRY_CONTAINER)}`
    );
}

describe('NewCommand (the generated Dockerfile, built and run)', () => {

    beforeAll(async () => {
        workDir = await emptyWorkDirectory('new-command-docker');
        CPUtilities['cwd'] = workDir;

        // the installs the generator runs, still run and no longer narrated. `exec` inherits the
        // parent's streams, which is npm's whole progress output ahead of anything this test has to
        // say - and it ends a failure by exiting the process, which would take the runner with it.
        //
        // The registry is named on the command rather than left to npm_config_registry, because a
        // suite started through "npm" or "npx" inherits that npm's own config in the environment and
        // there is no arranging to win from outside. A flag is the one place nothing else outranks.
        // eslint-disable-next-line typescript/require-await
        jest.spyOn(CPUtilities, 'exec').mockImplementation(async (command: string) => {
            const pointedAtTheRegistry: string = command.replace(
                /\bnpm i\b/,
                `npm i --registry ${REGISTRY_FROM_HOST} --userconfig "${npmrcPath()}"`
            );
            run(pointedAtTheRegistry, CPUtilities['cwd'] ?? REPOSITORY_ROOT);
        });

        // whatever a run that was interrupted left behind. Docker refuses to start a container under
        // a name that is already taken, so without this one killed run makes every later one fail.
        runQuietly(`docker rm -f ${APPLICATION_CONTAINER}`);
        runQuietly(`docker rm -f ${DATABASE_CONTAINER}`);
        runQuietly(`docker rm -f ${REGISTRY_CONTAINER}`);
        runQuietly(`docker network create ${NETWORK_NAME}`);
        await startRegistry();

        publishWorkspacePackage(path.join('packages', 'zibri'));
        publishWorkspacePackage(path.join('packages', 'tsx'));
        publishWorkspacePackage(path.join('packages', 'testing'));

        // asked of the registry rather than assumed from the publish exiting zero. The install below
        // reports a version it cannot find as "no matching version", which reads identically whether
        // the registry never received the package or whether the request went somewhere else
        // entirely - and those want opposite fixes.
        await assertPublished('zibri');
        await assertPublished('zibri-tsx');
        await assertPublished('zibri-testing');

        // ZIBRI_CLI_LOCAL_DEV is deliberately not set: the generator is asked for the same project it
        // writes for anybody else, one that depends on the framework by name. What makes that
        // resolvable is the registry above rather than a path back into this repository.
        await quietly(async () => new NewCommand().start(['n', 'api', 'none']));
        appDir = path.join(workDir, 'api') as Path;

        // the lock the generator just wrote resolves to "127.0.0.1", which inside the image is the
        // image. It is thrown away and written again from within the network, where the registry has
        // a name - "npm ci" fetches the urls a lock resolved to, so those urls decide whether the
        // build can reach anything at all. node_modules goes with it: npm reuses what is already
        // there, and none of it was fetched from where the image will look.
        await FsUtilities.rm(path.join(appDir, 'package-lock.json') as Path);
        await FsUtilities.rm(path.join(appDir, 'node_modules') as Path);
        run(
            `docker run --rm --user ${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`
            + ` --network ${NETWORK_NAME} -e HOME=/tmp -e npm_config_registry=${REGISTRY_FROM_NETWORK}`
            + ` -v "${appDir}":/app -w /app ${BASE_IMAGE} npm install`
        );

        // on the same network, so that the "npm ci" inside the build reaches the registry the lock
        // points at. Nothing else in the build talks to it.
        run(`docker build --network ${NETWORK_NAME} -t ${IMAGE_TAG} .`, appDir);

        run(
            `docker run -d --name ${DATABASE_CONTAINER} --network ${NETWORK_NAME}`
            + ' -e POSTGRES_PASSWORD=postgres -e POSTGRES_USER=postgres -e POSTGRES_DB=db postgres:17.6'
        );
        await waitFor(
            // eslint-disable-next-line typescript/require-await
            async () => {
                try {
                    run(`docker exec ${DATABASE_CONTAINER} pg_isready -U postgres -d db`);
                    return true;
                }
                catch {
                    return false;
                }
            },
            PROBE_TIMEOUT_MS,
            () => 'The database container never became ready.'
        );

        // the environment the generator wrote for this project, with the two values that are about
        // where it runs pointed at the container network instead of at localhost. Everything else is
        // what "zi new" already decided, which is the point: a deployment sets these and nothing else.
        const generatedEnv: string = await FsUtilities.readFile(path.join(appDir, '.env') as Path);
        const containerEnvPath: Path = path.join(workDir, 'container.env') as Path;
        await FsUtilities.createFile(
            containerEnvPath,
            generatedEnv
                .replace(/^DB_HOST=.*$/m, `DB_HOST=${DATABASE_CONTAINER}`)
                .replace(/^BASE_URL=.*$/m, `BASE_URL=http://127.0.0.1:${HOST_PORT}`)
        );

        run(
            `docker run -d --name ${APPLICATION_CONTAINER} --network ${NETWORK_NAME}`
            + ` --env-file "${containerEnvPath}" -p ${HOST_PORT}:3000 ${IMAGE_TAG}`
        );

        await waitFor(
            async () => {
                // a container that has stopped is never going to answer, and waiting out the timeout
                // to say so turns a crash into three minutes of nothing followed by the same report
                const status: string = run(`docker inspect -f '{{.State.Status}}' ${APPLICATION_CONTAINER}`).trim();
                if (status !== 'running') {
                    throw new Error(
                        `The application stopped before it answered.\n\n${containerDiagnostics(APPLICATION_CONTAINER)}`
                    );
                }
                try {
                    return (await request('/health/live')).ok;
                }
                catch {
                    return false;
                }
            },
            APPLICATION_TIMEOUT_MS,
            () => 'The application never answered its own health check.\n\n'
                + `${containerDiagnostics(APPLICATION_CONTAINER)}\n\n`
                // the application connects to the database before it listens, so a database that
                // never became usable looks from the outside exactly like an application that hung
                + containerDiagnostics(DATABASE_CONTAINER)
        );
    }, BUILD_TIMEOUT_MS);

    afterAll(() => {
        CPUtilities['cwd'] = undefined;
        delete process.env['npm_config_registry'];
        jest.restoreAllMocks();

        runQuietly(`docker rm -f ${APPLICATION_CONTAINER}`);
        runQuietly(`docker rm -f ${DATABASE_CONTAINER}`);
        runQuietly(`docker rm -f ${REGISTRY_CONTAINER}`);
        runQuietly(`docker network rm ${NETWORK_NAME}`);
        runQuietly(`docker rmi ${IMAGE_TAG}`);

        // the generated project is deliberately left where it is. Everything this test asks about is
        // a question you answer by reading what was built - the manifest, the lock, the image - and a
        // run that removed all of it on the way out is one whose failure can only be guessed at. The
        // next run clears the directory before it starts, so nothing accumulates.
    }, BUILD_TIMEOUT_MS);

    it('serves the application it was built from', async () => {
        const response: Response = await request('/');

        expect(response.status).toBe(200);
        // the home page the generator writes, rendered by the templates the build copied into the
        // bundle. A 200 here is the whole read path: the asset folder, the compiled tsx and the
        // translations are all read from inside "dist", and all three would be missing together
        expect(await response.text()).toContain('<html');
    });

    it('answers both halves of its own health check', async () => {
        const live: Response = await request('/health/live');
        const ready: Response = await request('/health/ready');

        expect(live.status).toBe(200);
        expect(ready.status).toBe(200);
        // the same two routes the Dockerfile's HEALTHCHECK and an orchestrator poll. A generated
        // project that renamed one of them and left the Dockerfile alone would restart forever
        expect(await ready.json()).toEqual({ status: 'ok' });
    });

    it('brought the version history the application refuses to start without', () => {
        const listed: string = run(`docker exec ${APPLICATION_CONTAINER} ls /app`);

        // the application boots only when this folder is there, so reaching this test at all is most
        // of the assertion. It is named anyway, because the failure it guards against is somebody
        // dropping the COPY line and reading the green suite as permission
        expect(listed).toContain('versions');
        expect(run(`docker exec ${APPLICATION_CONTAINER} ls /app/versions`)).toContain('.json');
    });

    it('runs as a user that owns only what it writes', () => {
        // the two paths written while the application runs. Everything else under /app stays owned by
        // root, so an image that is compromised cannot rewrite the bundle it is running
        expect(run(`docker exec ${APPLICATION_CONTAINER} id -un`).trim()).toBe('node');
        expect(run(`docker exec ${APPLICATION_CONTAINER} stat -c %U /app/versions`).trim()).toBe('node');
        expect(run(`docker exec ${APPLICATION_CONTAINER} stat -c %U /app/.zibri`).trim()).toBe('node');
        expect(run(`docker exec ${APPLICATION_CONTAINER} stat -c %U /app/dist`).trim()).toBe('node');
    });

    it('leaves the secrets it was generated with out of the image', () => {
        // ".env" holds the secrets this project runs on and ".dockerignore" keeps it out of the build
        // context. An image carrying one is a set of credentials handed to everyone it is pushed to.
        expect(run(`docker exec ${APPLICATION_CONTAINER} ls -a /app`)).not.toContain('.env');
    });
});