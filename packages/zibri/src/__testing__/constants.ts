import { FsUtilities, FsPath } from '../utilities/fs.utilities';
import { Ms } from '../utilities/ms';

export const testFileFolder: FsPath = FsUtilities.getPath(__dirname, 'file-output');

export const testAssetsFolder: FsPath = FsUtilities.getPath(__dirname, 'mocks', 'assets');

/**
 * The recorded route history this repository's own test servers share.
 *
 * Created by the global test setup rather than by the application that reads it: the folder is
 * something a project checks in, so an application refuses to start when it is missing instead of
 * taking the version it is on for the first one that ever existed.
 */
export const testVersionsFolder: FsPath = FsUtilities.getPath(testFileFolder, 'versions-default');

/**
 * How long jest gives a hook or a test that starts, shuts down or restarts a test server.
 */
export type TestServerTimeouts = {
    /**
     * For the hook that starts the server, containers included.
     */
    start: number,
    /**
     * For the hook that shuts the server down.
     */
    shutdown: number,
    /**
     * For a test or hook that restarts the server with `reInit`.
     */
    restart: number
};

/**
 * A kind of data source a test server starts, as {@link TestTimeouts} knows it.
 */
export type TestDataSourceKind = 'postgres' | 'inMemory' | 'valKey';

/**
 * The jest timeouts of test servers, by the data source they start. A server that starts several
 * gets their timeouts added up. A timeout above these, or one on a test that does something else,
 * is a decision about that one test and is written there.
 */
export abstract class TestTimeouts {
    /**
     * A server on Postgres.
     */
    static readonly postgres: TestServerTimeouts = { start: 40 * Ms.SECOND, shutdown: 15 * Ms.SECOND, restart: 15 * Ms.SECOND };

    /**
     * A server on the in-memory data source.
     */
    static readonly inMemory: TestServerTimeouts = { start: 30 * Ms.SECOND, shutdown: 15 * Ms.SECOND, restart: 15 * Ms.SECOND };

    /**
     * A server on Valkey.
     */
    static readonly valKey: TestServerTimeouts = { start: 30 * Ms.SECOND, shutdown: 15 * Ms.SECOND, restart: 15 * Ms.SECOND };

    /**
     * The timeouts of a server that starts several kinds of data source: each one's, added up.
     * @param kinds - The kinds of data source the server starts.
     * @returns The added up timeouts.
     */
    static resolveCombined(...kinds: TestDataSourceKind[]): TestServerTimeouts {
        return {
            start: kinds.reduce((sum, kind) => sum + TestTimeouts[kind].start, 0),
            shutdown: kinds.reduce((sum, kind) => sum + TestTimeouts[kind].shutdown, 0),
            restart: kinds.reduce((sum, kind) => sum + TestTimeouts[kind].restart, 0)
        };
    }
}

export const noOp: () => void = () => {};

export const noOpAsync: () => Promise<void> = async () => {};

export async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
}