import { ScaffoldFeature, ScaffoldManifest, ScaffoldUtilities } from '../../scaffold';
import { exitWithError, getPath, Path } from '../../utilities';
import { FeatureChange } from '../feature-change.model';
import { RegeneratingCommand } from '../regenerating-command.model';

/**
 * Adds features to the project `zi new` generated in this folder.
 *
 * Installs what they need, writes their files, and merges their lines into the files the project
 * shares with them, such as its application options.
 */
export class AddCommand extends RegeneratingCommand<FeatureChange> {
    protected override maxLength: number | undefined = 2;

    protected override async run(input: FeatureChange): Promise<void> {
        const { projectPath, manifest, features, changed } = input;
        await this.installDependencies(projectPath, ScaffoldUtilities.resolveFeatureDependencies(changed), false);
        await this.regenerate(projectPath, manifest, { ...manifest.answers, features }, `zi add ${changed.join(',')}`);
    }

    // `zi add <feature>[,<feature>…]`
    protected override async resolveInput(args: string[]): Promise<FeatureChange> {
        const [, names]: (string | undefined)[] = args;
        if (names == undefined) {
            return await exitWithError('Name the features to add, as "zi add <feature>[,<feature>...]".');
        }
        const projectPath: Path = getPath('.');
        const manifest: ScaffoldManifest = await this.resolveCurrentManifest(projectPath);
        const changed: ScaffoldFeature[] = (await ScaffoldUtilities.resolveFeatureNames(names.split(',')))
            .filter(feature => !manifest.answers.features.includes(feature));
        if (!changed.length) {
            return await exitWithError(`This project has ${names} already.`);
        }
        const features: ScaffoldFeature[] = await ScaffoldUtilities.resolveFeatureNames([...manifest.answers.features, ...changed]);
        await ScaffoldUtilities.validateFeatures(features);
        return { projectPath, manifest, features, changed };
    }
}
