import { CONTINUOUS_INTEGRATIONS,
    ContinuousIntegration,
    DEFAULT_AUTHS,
    DefaultAuth,
    ScaffoldAnswers,
    scaffoldQuestions } from './scaffold-answers.model';
import { SCAFFOLD_DEPENDENCIES,
    SCAFFOLD_DEV_DEPENDENCIES,
    SCAFFOLD_FEATURE_DEPENDENCIES,
    ScaffoldDependencies } from './scaffold-dependencies.model';
import { SCAFFOLD_FEATURE_FILES, SCAFFOLD_FEATURE_REQUIREMENTS, SCAFFOLD_FEATURES, ScaffoldFeature } from './scaffold-feature.model';
import { SCAFFOLD_MANIFEST_FILE, ScaffoldManifest } from './scaffold-manifest.model';
import { version } from '../../package.json';
import { FsUtilities, GitUtilities, InquirerUtilities } from '../encapsulation';
import { exitWithError, getPath, Path } from '../utilities';

/**
 * The manifest of a project's package, which `zi new` writes once and npm and the project own after.
 */
const PACKAGE_JSON: string = 'package.json';

/**
 * What a project holds that the generator did not write alone: what npm writes, the secrets of this
 * one project, and the record of what was generated itself.
 */
const NOT_GENERATED: string[] = ['.git', 'node_modules', PACKAGE_JSON, 'package-lock.json', '.env', SCAFFOLD_MANIFEST_FILE];

/**
 * The parts of a package.json read here.
 */
type PackageJson = {
    /**
     * The package's name.
     */
    name: string,
    /**
     * Every package it names, as a dependency or a devDependency.
     */
    installed: Set<string>
};

/**
 * Whether a value is a record of strings.
 * @param value - The value.
 * @returns True when every value of it is a string.
 */
function isStringRecord(value: unknown): value is Record<string, string> {
    return typeof value === 'object' && value != undefined && Object.values(value).every(entry => typeof entry === 'string');
}

/**
 * A manifest as a cli before features wrote it, which records no features.
 */
type ManifestWithoutFeatures = Omit<ScaffoldManifest, 'answers'> & {
    /**
     * What it was generated from, all of it but the features.
     */
    answers: Omit<ScaffoldAnswers, 'features'>
};

/**
 * Whether a value is a feature.
 * @param value - The value.
 * @returns True when it names one of `SCAFFOLD_FEATURES`.
 */
function isScaffoldFeature(value: unknown): value is ScaffoldFeature {
    return SCAFFOLD_FEATURES.some(feature => feature === value);
}

/**
 * Whether a parsed manifest is one the cli wrote, with or without its features.
 * @param value - What the file held.
 * @returns True when it has every field, each of the right shape.
 */
function isScaffoldManifest(value: unknown): value is ScaffoldManifest | ManifestWithoutFeatures {
    if (typeof value !== 'object' || value == undefined || !('version' in value) || !('answers' in value) || !('files' in value)) {
        return false;
    }
    const answers: unknown = value.answers;
    return typeof value.version === 'string'
        && isStringRecord(value.files)
        && typeof answers === 'object' && answers != undefined
        && 'name' in answers && typeof answers.name === 'string'
        && 'ci' in answers && CONTINUOUS_INTEGRATIONS.some(ci => ci === answers.ci)
        && 'defaultAuth' in answers && DEFAULT_AUTHS.some(defaultAuth => defaultAuth === answers.defaultAuth)
        && (!('features' in answers) || (Array.isArray(answers.features) && answers.features.every(isScaffoldFeature)));
}

/**
 * What `zi new` and `zi upgrade` share: the answers a project is generated from, the files it is
 * generated into, and the manifest recording them.
 */
export abstract class ScaffoldUtilities {
    /**
     * What `zi upgrade` appends to the name of a file it writes the new version of beside the project's own.
     */
    static readonly BESIDE_SUFFIX: string = '.zibri-upgrade';

    /**
     * Reads the continuous integration named on the command line, and asks for it when nothing was.
     * @param value - What was passed, if anything.
     * @returns The continuous integration. Exits naming the valid ones when what was passed names none.
     */
    static async resolveContinuousIntegration(value: string | undefined): Promise<ContinuousIntegration> {
        return value == undefined
            ? (await InquirerUtilities.prompt<Pick<ScaffoldAnswers, 'ci'>>({ ci: scaffoldQuestions.ci })).ci
            : CONTINUOUS_INTEGRATIONS.find(ci => ci === value)
                ?? await exitWithError(`Unknown ci "${value}", expected one of: ${CONTINUOUS_INTEGRATIONS.join(', ')}`);
    }

    /**
     * Reads the default auth named on the command line, and asks for it when nothing was.
     * @param value - What was passed, if anything.
     * @returns The default auth. Exits naming the valid ones when what was passed names none.
     */
    static async resolveDefaultAuth(value: string | undefined): Promise<DefaultAuth> {
        if (value == undefined) {
            return (await InquirerUtilities.prompt<Pick<ScaffoldAnswers, 'defaultAuth'>>({
                defaultAuth: scaffoldQuestions.defaultAuth
            })).defaultAuth;
        }
        return DEFAULT_AUTHS.find(defaultAuth => defaultAuth === value)
            ?? await exitWithError(`Unknown defaultAuth "${value}", expected one of: ${DEFAULT_AUTHS.join(', ')}`);
    }

    /**
     * Reads the features named on the command line, as a comma separated list or `none`, and asks for
     * them when nothing was.
     * @param value - What was passed, if anything.
     * @returns The features, in the order of `SCAFFOLD_FEATURES`. Exits when what was passed names an
     * unknown feature, or a feature without one it is built on.
     */
    static async resolveFeatures(value: string | undefined): Promise<ScaffoldFeature[]> {
        if (value == undefined) {
            const { features } = await InquirerUtilities.prompt<Pick<ScaffoldAnswers, 'features'>>({
                features: scaffoldQuestions.features
            });
            await this.validateFeatures(features);
            return this.sortFeatures(features);
        }
        const features: ScaffoldFeature[] = await this.resolveFeatureNames(value === 'none' ? [] : value.split(','));
        await this.validateFeatures(features);
        return features;
    }

    /**
     * Reads names of features.
     * @param names - The names.
     * @returns The features, in the order of `SCAFFOLD_FEATURES`. Exits when a name is none of them.
     */
    static async resolveFeatureNames(names: string[]): Promise<ScaffoldFeature[]> {
        const features: ScaffoldFeature[] = [];
        for (const name of names) {
            features.push(SCAFFOLD_FEATURES.find(feature => feature === name)
                ?? await exitWithError(`Unknown feature "${name}", expected one of: ${SCAFFOLD_FEATURES.join(', ')}`));
        }
        return this.sortFeatures(features);
    }

    /**
     * Checks that every feature comes with the features it is built on.
     * @param features - The features of a project.
     */
    static async validateFeatures(features: ScaffoldFeature[]): Promise<void> {
        for (const feature of features) {
            const missing: ScaffoldFeature[] = SCAFFOLD_FEATURE_REQUIREMENTS[feature].filter(required => !features.includes(required));
            if (missing.length) {
                const missingNames: string = missing.map(required => `"${required}"`).join(', ');
                await exitWithError(`The feature "${feature}" needs ${missingNames} as well.`);
            }
        }
    }

    /**
     * Whether a file is written into a project with these features.
     * @param relativePath - The file, relative to the project.
     * @param features - The features of the project.
     * @returns True when the project has every feature naming the file.
     */
    static isWrittenFor(relativePath: string, features: ScaffoldFeature[]): boolean {
        return SCAFFOLD_FEATURES.every(feature => features.includes(feature)
            || !SCAFFOLD_FEATURE_FILES[feature].some(
                named => named === relativePath || (named.endsWith('/') && relativePath.startsWith(named))
            ));
    }

    /**
     * What a project with these features installs.
     * @param features - The features of the project.
     * @returns What it installs whatever its features, and what each of them installs on top.
     */
    static resolveDependencies(features: ScaffoldFeature[]): ScaffoldDependencies {
        const ofFeatures: ScaffoldDependencies = this.resolveFeatureDependencies(features);
        return {
            dependencies: [...SCAFFOLD_DEPENDENCIES, ...ofFeatures.dependencies],
            devDependencies: [...SCAFFOLD_DEV_DEPENDENCIES, ...ofFeatures.devDependencies]
        };
    }

    /**
     * What these features install on top of what every project installs.
     * @param features - The features.
     * @returns What each of them installs.
     */
    static resolveFeatureDependencies(features: ScaffoldFeature[]): ScaffoldDependencies {
        return {
            dependencies: features.flatMap(feature => SCAFFOLD_FEATURE_DEPENDENCIES[feature].dependencies),
            devDependencies: features.flatMap(feature => SCAFFOLD_FEATURE_DEPENDENCIES[feature].devDependencies)
        };
    }

    private static sortFeatures(features: ScaffoldFeature[]): ScaffoldFeature[] {
        return SCAFFOLD_FEATURES.filter(feature => features.includes(feature));
    }

    /**
     * What to install one of the framework's own packages from: the release matching this cli.
     * @param folder - Where the package lives in this repository.
     * @param name - Its name on npm.
     * @returns The argument to give "npm i".
     */
    static resolveFrameworkDependency(folder: 'zibri' | 'testing', name: string): string {
        // ZIBRI_CLI_LOCAL_DEV is only set by this package's own "start"/"clear" scripts, so a
        // published install always resolves the real packages from npm
        return process.env['ZIBRI_CLI_LOCAL_DEV']
            ? `file:${getPath(__dirname, '..', '..', '..', folder)}`
            : `${name}@${version}`;
    }

    /**
     * Reads what was generated into a directory.
     * @param appPath - The directory.
     * @returns Every generated file's content, by its path relative to the directory.
     */
    static async resolveGeneratedFiles(appPath: Path): Promise<Map<string, Buffer>> {
        const files: Map<string, Buffer> = new Map();
        for (const relativePath of await FsUtilities.findFiles(appPath, NOT_GENERATED)) {
            files.set(relativePath, await FsUtilities.readFileBuffer(getPath(appPath, relativePath)));
        }
        return files;
    }

    /**
     * The manifest of generated files.
     * @param answers - What they were generated from.
     * @param files - Their contents, by their paths.
     * @returns The manifest, with the files in a stable order.
     */
    static resolveManifest(answers: ScaffoldAnswers, files: Map<string, Buffer>): ScaffoldManifest {
        const hashes: [string, string][] = [...files]
            .map(([relativePath, content]) => [relativePath, GitUtilities.resolveBlobHash(content)]);
        hashes.sort(([a], [b]) => a.localeCompare(b, 'en'));
        return { version, answers, files: Object.fromEntries(hashes) };
    }

    /**
     * Reads a project's manifest.
     * @param projectPath - The project.
     * @returns The manifest, or undefined when the project has none. Exits when it has one the cli did not write.
     */
    static async findManifest(projectPath: Path): Promise<ScaffoldManifest | undefined> {
        const manifestPath: Path = getPath(projectPath, SCAFFOLD_MANIFEST_FILE);
        if (!await FsUtilities.exists(manifestPath)) {
            return undefined;
        }
        const manifest: unknown = JSON.parse(await FsUtilities.readFile(manifestPath));
        if (!isScaffoldManifest(manifest)) {
            return await exitWithError(`"${manifestPath}" is not a manifest "zi new" wrote. Restore it from the project's history.`);
        }
        return {
            ...manifest,
            answers: {
                ...manifest.answers,
                // a cli from before the features generated every one of them
                features: 'features' in manifest.answers ? manifest.answers.features : [...SCAFFOLD_FEATURES]
            }
        };
    }

    /**
     * Writes a project's manifest.
     * @param projectPath - The project.
     * @param manifest - What it records.
     */
    static async writeManifest(projectPath: Path, manifest: ScaffoldManifest): Promise<void> {
        await FsUtilities.writeFileBuffer(
            getPath(projectPath, SCAFFOLD_MANIFEST_FILE),
            Buffer.from(`${JSON.stringify(manifest, undefined, 4)}\n`)
        );
    }

    /**
     * Reads what a project's package.json says about it.
     * @param projectPath - The project.
     * @returns Its name, and every package it installs.
     */
    static async resolvePackageJson(projectPath: Path): Promise<PackageJson> {
        const packageJsonPath: Path = getPath(projectPath, PACKAGE_JSON);
        const packageJson: unknown = JSON.parse(await FsUtilities.readFile(packageJsonPath));
        if (typeof packageJson !== 'object' || packageJson == undefined || !('name' in packageJson)
            || typeof packageJson.name !== 'string') {
            return await exitWithError(`"${packageJsonPath}" names no package. Run this in a project "zi new" generated.`);
        }
        const dependencies: unknown = 'dependencies' in packageJson ? packageJson.dependencies : {};
        const devDependencies: unknown = 'devDependencies' in packageJson ? packageJson.devDependencies : {};
        return {
            name: packageJson.name,
            installed: new Set([
                ...isStringRecord(dependencies) ? Object.keys(dependencies) : [],
                ...isStringRecord(devDependencies) ? Object.keys(devDependencies) : []
            ])
        };
    }
}