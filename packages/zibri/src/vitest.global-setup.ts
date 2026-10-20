import { testVersionsFolder } from './__testing__/constants.ts';
import { FsUtilities } from './utilities/fs.utilities.ts';

/**
 * Starts the run with an empty recorded route history.
 *
 * The suites of one run share that history on purpose, and a run inherits nothing from the one
 * before it: what a suite recorded last time is checked against the routes of this time, so a route
 * that was renamed, or a version file whose shape changed, would refuse to start until someone
 * emptied the folder by hand.
 */
export default async function setup(): Promise<void> {
    await FsUtilities.rm(testVersionsFolder);
    await FsUtilities.mkdir(testVersionsFolder);
}