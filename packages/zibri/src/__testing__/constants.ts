import { FsUtilities, FsPath } from '../utilities/fs.utilities.ts';

export const testFileFolder: FsPath = FsUtilities.getPath(import.meta.dirname, 'file-output');

export const testAssetsFolder: FsPath = FsUtilities.getPath(import.meta.dirname, 'mocks', 'assets');

/**
 * The recorded route history this repository's own test servers share.
 *
 * Created by the global test setup rather than by the application that reads it: the folder is
 * something a project checks in, so an application refuses to start when it is missing instead of
 * taking the version it is on for the first one that ever existed.
 */
export const testVersionsFolder: FsPath = FsUtilities.getPath(testFileFolder, 'versions-default');

// TODO: every suite repeats the same test timeouts by hand - 15000 wherever a server or a container
// is started or stopped, the runner's own 5000 everywhere else. They belong here as named constants, so
// that a timeout above the default reads as a deliberate decision about that one test rather than
// disappearing among 200 copies of the same number.

export const noOp: () => void = () => {};

export const noOpAsync: () => Promise<void> = async () => {};

export async function flushMicrotasks(): Promise<void> {
    await Promise.resolve();
}