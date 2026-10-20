/* eslint-disable no-console */
import { ChalkUtilities, FsUtilities } from '../../encapsulation/index.ts';
import { getPath, exitWithError, Path } from '../../utilities/index.ts';
import { BaseCommand } from '../base-command.model.ts';

/**
 * Prints out the currently used version of Zibri.
 */
export class VersionCommand extends BaseCommand {
    protected override async run(): Promise<void> {
        const packageJsonPath: Path = getPath(import.meta.dirname, '..', '..', '..', 'package.json');
        const packageJsonContent: string = await FsUtilities.readFile(packageJsonPath);
        // eslint-disable-next-line typescript/no-unsafe-assignment, jsdoc-js/require-jsdoc
        const pkg: { version: string } = JSON.parse(packageJsonContent);
        if (!pkg.version) {
            return await exitWithError('Could not determine the currently running version of zibri-cli');
        }
        console.log(ChalkUtilities.boldUnderline('Version:'));
        console.log(ChalkUtilities.secondary(pkg.version));
    }
}