import { testVersionsFolder } from './__testing__/constants';
import { FsUtilities } from './utilities/fs.utilities';

/**
 * The oldest Node a test run starts on: Jest loads a package that is only an es module, such as the fontkit of
 * pdfmake 0.3, through `require` from Node 24.9 on.
 */
const MIN_NODE_VERSION: [number, number] = [24, 9];

/**
 * Starts the run with an empty recorded route history, on a Node the tests can run on.
 *
 * The suites of one run share that history on purpose, and a run inherits nothing from the one
 * before it: what a suite recorded last time is checked against the routes of this time, so a route
 * that was renamed, or a version file whose shape changed, would refuse to start until someone
 * emptied the folder by hand.
 * @throws An Error on a Node older than {@link MIN_NODE_VERSION}, where the suites making pdfs with pdfmake 0.3
 * would fail with a message that doesn't name the Node.
 */
export default async function setup(): Promise<void> {
    const [major = 0, minor = 0] = process.versions.node.split('.').map(Number);
    const [minMajor, minMinor] = MIN_NODE_VERSION;
    if (major < minMajor || (major === minMajor && minor < minMinor)) {
        throw new Error(
            `The tests need Node ${minMajor}.${minMinor} or newer, but run on ${process.versions.node} (${process.execPath}).`
        );
    }
    await FsUtilities.rm(testVersionsFolder);
    await FsUtilities.mkdir(testVersionsFolder);
}