import { FsUtilities } from '../../encapsulation';
import { ScaffoldAnswers, ScaffoldUtilities } from '../../scaffold';
import { exitWithError, getPath, Path } from '../../utilities';
import { BaseCommand } from '../base-command.model';
import { NewCommand } from '../new/new.command';

/**
 * What generating works on.
 */
type GenerateInput = {
    /**
     * The folder the files are written into.
     */
    folder: Path,
    /**
     * What they are generated from.
     */
    answers: ScaffoldAnswers
};

/**
 * Writes the files of a project into a folder, the way `zi new` does, and installs nothing.
 *
 * What `zi upgrade` of a later release runs with this release, to merge against what this release generated.
 */
export class GenerateCommand extends BaseCommand<GenerateInput> {
    protected override maxLength: number | undefined = 6;

    protected override async run({ folder, answers }: GenerateInput): Promise<void> {
        await FsUtilities.mkdir(folder, true, false);
        await new NewCommand(false).generateFiles(folder, answers);
    }

    // `zi generate <folder> <name> <ci> <defaultAuth> <features>`: every answer named, as a later
    // release runs this with nobody there to ask
    protected override async resolveInput(args: string[]): Promise<GenerateInput> {
        const [, folder, name, ci, defaultAuth, features]: (string | undefined)[] = args;
        if (folder == undefined || name == undefined || ci == undefined || defaultAuth == undefined || features == undefined) {
            return await exitWithError(
                'Error parsing the command: "generate <folder> <name> <ci> <defaultAuth> <features>" names every answer.'
            );
        }
        return {
            folder: getPath(folder),
            answers: {
                name,
                ci: await ScaffoldUtilities.resolveContinuousIntegration(ci),
                defaultAuth: await ScaffoldUtilities.resolveDefaultAuth(defaultAuth),
                features: await ScaffoldUtilities.resolveFeatures(features)
            }
        };
    }
}