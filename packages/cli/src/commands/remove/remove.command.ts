import { CPUtilities } from '../../encapsulation';
import { ScaffoldDependencies, ScaffoldFeature, ScaffoldManifest, ScaffoldUtilities } from '../../scaffold';
import { exitWithError, getPath, Path } from '../../utilities';
import { FeatureChange } from '../feature-change.model';
import { RegeneratingCommand } from '../regenerating-command.model';

/**
 * Removes features from the project `zi new` generated in this folder.
 *
 * Deletes their files the project never changed and keeps the ones it did, merges their lines out of
 * the files the project shares with them, and uninstalls what only they need.
 */
export class RemoveCommand extends RegeneratingCommand<FeatureChange> {
    protected override maxLength: number | undefined = 2;

    protected override async run(input: FeatureChange): Promise<void> {
        const { projectPath, manifest, features, changed } = input;
        await this.regenerate(projectPath, manifest, { ...manifest.answers, features }, `zi remove ${changed.join(',')}`);
        const { dependencies, devDependencies }: ScaffoldDependencies = ScaffoldUtilities.resolveFeatureDependencies(changed);
        const packages: string[] = [...dependencies, ...devDependencies].map(spec => this.resolvePackageName(spec));
        if (packages.length) {
            await CPUtilities.exec(`cd ${projectPath} && npm uninstall ${packages.join(' ')}`);
        }
    }

    // `zi remove <feature>[,<feature>…]`
    protected override async resolveInput(args: string[]): Promise<FeatureChange> {
        const [, names]: (string | undefined)[] = args;
        if (names == undefined) {
            return await exitWithError('Name the features to remove, as "zi remove <feature>[,<feature>...]".');
        }
        const projectPath: Path = getPath('.');
        const manifest: ScaffoldManifest = await this.resolveCurrentManifest(projectPath);
        const changed: ScaffoldFeature[] = (await ScaffoldUtilities.resolveFeatureNames(names.split(',')))
            .filter(feature => manifest.answers.features.includes(feature));
        if (!changed.length) {
            return await exitWithError(`This project does not have ${names}.`);
        }
        const features: ScaffoldFeature[] = manifest.answers.features.filter(feature => !changed.includes(feature));
        await ScaffoldUtilities.validateFeatures(features);
        return { projectPath, manifest, features, changed };
    }
}
