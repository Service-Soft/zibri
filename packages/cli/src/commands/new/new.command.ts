/* eslint-disable no-console */
import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
import path from 'node:path';

import { CPUtilities, FsUtilities, InquirerUtilities } from '../../encapsulation';
import { ProjectTemplateUtilities,
    ProjectTemplateValues,
    SCAFFOLD_FEATURES,
    ScaffoldAnswers,
    ScaffoldDependencies,
    ScaffoldFeature,
    scaffoldQuestions,
    ScaffoldUtilities } from '../../scaffold';
import { exitWithError, getPath, Path } from '../../utilities';
import { BaseCommand } from '../base-command.model';

const PACKAGE_JSON: string = 'package.json';

/**
 * The single source of both dotenv files: `.env.example` renders it with every secret blank and is
 * committed, `.env` with a secret generated for each and is git ignored. One list is what keeps a
 * project from booting on a variable its own example never mentions, or being told to set one that
 * nothing reads.
 */
const ENV_EXAMPLE: string = '.env.example';

/**
 * A variable of the dotenv template whose value is a secret of the project's own.
 */
const SECRET_VARIABLE: RegExp = /^([\dA-Z_]+)={{secret}}$/gm;

/**
 * Who the generated package.json names as the author.
 * The same places npm looks when it fills the field in itself: what git commits are attributed to,
 * and the account the command runs under when git has been told nothing. It is a starting point
 * rather than an answer - a project that is published under someone else edits it - but it beats the
 * empty string a scaffold would otherwise leave behind for its author to notice.
 * @returns The name and email address to attribute the project to.
 */
function resolveAuthor(): string {
    const name: string | undefined = CPUtilities.output('git config user.name');
    const email: string | undefined = CPUtilities.output('git config user.email');
    return name != undefined && email != undefined ? `${name} <${email}>` : name ?? email ?? userInfo().username;
}

/**
 * The project files are being generated into, while they are.
 */
type GenerationTarget = {
    /**
     * The folder of the project.
     */
    appPath: Path,
    /**
     * The features it is generated with.
     */
    features: ScaffoldFeature[]
};

/**
 * Creates a new Zibri application.
 *
 * Every file it writes is a template under `packages/cli/project`, or is copied from `assets` and
 * `templates`. What is left here is the questions, which files a project gets, and the installs.
 */
export class NewCommand extends BaseCommand<ScaffoldAnswers> {
    protected override maxLength: number | undefined = 5;

    // set for the duration of generateFiles, so that every file it writes or copies is checked
    // against the features in one place, isWritten
    private target: GenerationTarget | undefined;

    /**
     * Creates the command.
     * @param logCreatedFiles - Whether every file written is named on the console, which is what the
     * person who ran `zi new` wants and noise for anything generating into a folder of its own.
     */
    constructor(private readonly logCreatedFiles: boolean = true) {
        super();
    }

    protected override async run(configuration: ScaffoldAnswers): Promise<void> {
        console.log('creates a new zibri application', configuration.name);
        const appPath: Path = getPath(configuration.name);
        if (await FsUtilities.exists(appPath)) {
            await exitWithError(`Could not create folder "${appPath}": It already exists`);
        }
        await FsUtilities.mkdir(appPath);
        // Written directly instead of via "npm init": npm walks up to the nearest ancestor
        // package.json when the cwd has none of its own, which inside the monorepo means it
        // would write into packages/cli/package.json instead of appPath/package.json.
        await this.createFile(getPath(appPath, PACKAGE_JSON), await ProjectTemplateUtilities.resolveFile(PACKAGE_JSON, {
            name: configuration.name,
            // JSON.stringify rather than quotes of the template's own: this is the one value there
            // that comes from outside, and a name with an apostrophe in it would otherwise write a
            // broken file
            author: JSON.stringify(resolveAuthor())
        }));
        const { dependencies, devDependencies }: ScaffoldDependencies = ScaffoldUtilities.resolveDependencies(configuration.features);
        // the path quoted, as one with a space in it is otherwise two arguments to `cd`
        await CPUtilities.exec(`cd "${appPath}" && npm i -D ${devDependencies.join(' ')}`);
        const zibriDependency: string = ScaffoldUtilities.resolveFrameworkDependency('zibri', 'zibri');
        await CPUtilities.exec(`cd "${appPath}" && npm i ${[zibriDependency, ...dependencies].join(' ')}`);
        // the test harness, which peer depends on zibri and is therefore installed after it. A
        // devDependency: it starts the application a test drives, and nothing a deployment runs
        // imports it.
        const zibriTestingDependency: string = ScaffoldUtilities.resolveFrameworkDependency('testing', 'zibri-testing');
        await CPUtilities.exec(`cd "${appPath}" && npm i -D ${zibriTestingDependency}`);

        await this.generateFiles(appPath, configuration);
        await ScaffoldUtilities.writeManifest(
            appPath,
            ScaffoldUtilities.resolveManifest(configuration, await ScaffoldUtilities.resolveGeneratedFiles(appPath))
        );
    }

    /**
     * Writes every file of a project but its package.json, which is written once and then owned by
     * npm and the project.
     *
     * What `zi upgrade` generates again, into a folder of its own, to merge into a project.
     * @param appPath - The folder to write into.
     * @param configuration - What the project is generated from.
     */
    async generateFiles(appPath: Path, configuration: ScaffoldAnswers): Promise<void> {
        this.target = { appPath, features: configuration.features };
        try {
            await this.generateFilesFor(appPath, configuration);
        }
        finally {
            this.target = undefined;
        }
    }

    private async generateFilesFor(appPath: Path, configuration: ScaffoldAnswers): Promise<void> {
        const values: ProjectTemplateValues = await this.resolveTemplateValues(configuration);
        for (const relativePath of await ProjectTemplateUtilities.findFilePaths()) {
            if (this.isRendered(relativePath, configuration)) {
                await this.createFile(getPath(appPath, relativePath), await ProjectTemplateUtilities.resolveFile(relativePath, values));
            }
        }
        await this.createFile(getPath(appPath, '.env'), await ProjectTemplateUtilities.resolveFile(ENV_EXAMPLE, {
            ...values,
            example: false,
            // 32 bytes, base64url so that nothing in it has to be escaped by whatever reads the file
            secret: () => randomBytes(32).toString('base64url')
        }));

        const isIncluded: (destination: Path) => boolean = destination => this.isWritten(destination);
        await FsUtilities.copyDirectoryContent(
            getPath(__dirname, '..', '..', '..', 'assets'),
            getPath(appPath, 'assets'),
            isIncluded
        );
        await FsUtilities.copyDirectoryContent(
            getPath(__dirname, '..', '..', '..', 'templates'),
            getPath(appPath, 'src', 'templates'),
            isIncluded
        );
    }

    /**
     * What the templates of a project are rendered with.
     * @param configuration - What the project is generated from.
     * @returns The answers, a flag for each feature, and what `.env.example` and the workflow need.
     */
    private async resolveTemplateValues(configuration: ScaffoldAnswers): Promise<ProjectTemplateValues> {
        // the workflow fills each secret `.env.example` leaves blank, so it names them all
        const secrets: string[] = [...(await ProjectTemplateUtilities.readTemplate(ENV_EXAMPLE)).matchAll(SECRET_VARIABLE)]
            .map(match => match[1]);
        return {
            ...Object.fromEntries(SCAFFOLD_FEATURES.map(feature => [feature, configuration.features.includes(feature)])),
            name: configuration.name,
            defaultAuth: configuration.defaultAuth,
            publicByDefault: configuration.defaultAuth === 'public',
            example: true,
            secret: '',
            secrets: secrets.join(' ')
        };
    }

    /**
     * Whether a file is rendered into the project by generateFiles.
     * @param relativePath - The file, relative to the project.
     * @param configuration - What the project is generated from.
     * @returns False for the package.json, which run writes once and npm and the project own after,
     * and for the workflow of a continuous integration the project did not choose.
     */
    private isRendered(relativePath: string, configuration: ScaffoldAnswers): boolean {
        return relativePath !== PACKAGE_JSON && (!relativePath.startsWith('.github/') || configuration.ci === 'github');
    }

    private async createFile(filePath: Path, data: string): Promise<void> {
        if (!this.isWritten(filePath)) {
            return;
        }
        await FsUtilities.createFile(filePath, data, true, this.logCreatedFiles);
    }

    // whether the features being generated with include every one the file belongs to
    private isWritten(filePath: Path): boolean {
        if (this.target == undefined) {
            return true;
        }
        const relativePath: string = path.relative(this.target.appPath, filePath).split(path.sep)
            .join('/');
        return ScaffoldUtilities.isWrittenFor(relativePath, this.target.features);
    }

    // `zi new [name] [ci] [defaultAuth] [features]`: what the command line leaves out is asked for, in that order
    protected override async resolveInput(args: string[]): Promise<ScaffoldAnswers> {
        const [, name, ci, defaultAuth, features]: (string | undefined)[] = args;
        return {
            name: name
                ?? (await InquirerUtilities.prompt<Pick<ScaffoldAnswers, 'name'>>({ name: scaffoldQuestions.name })).name,
            ci: await ScaffoldUtilities.resolveContinuousIntegration(ci),
            defaultAuth: await ScaffoldUtilities.resolveDefaultAuth(defaultAuth),
            features: await ScaffoldUtilities.resolveFeatures(features)
        };
    }
}