/* eslint-disable no-console */
import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';
import path from 'node:path';

import { CPUtilities, FsUtilities, InquirerUtilities } from '../../encapsulation';
import { ScaffoldAnswers, ScaffoldDependencies, ScaffoldFeature, scaffoldQuestions, ScaffoldUtilities } from '../../scaffold';
import { exitWithError, getPath, Path } from '../../utilities';
import { BaseCommand } from '../base-command.model';

/**
 * One line of a generated dotenv file: either a variable or a comment introducing the next few.
 */
type EnvironmentVariable = {
    /**
     * The name of the variable, which is what the application reads it by.
     */
    key: string,
    /**
     * What a fresh project starts on. Left out for a secret, which is generated per project instead.
     */
    value?: string,
    /**
     * Whether this is a secret: generated for `.env`, and blank in the committed `.env.example`.
     */
    secret?: boolean,
    /**
     * Never set on a variable. Present so a comment can sit in the same list as what it describes.
     */
    comment?: undefined
} | {
    /**
     * The text of the comment, written above the variables that follow it.
     */
    comment: string,
    /**
     * Never set on a comment.
     */
    key?: undefined,
    /**
     * Never set on a comment.
     */
    value?: undefined,
    /**
     * Never set on a comment.
     */
    secret?: undefined
};

const DATA_SOURCES_DIR: string = 'data-sources';

const TESTING_DIR: string = '__testing__';

const IMPORT_REQUIRE_ENV: string = 'import { requireEnv } from \'./env\';';

/**
 * Every variable the generated application reads, with the value a fresh project starts on.
 *
 * The single source of both dotenv files: `.env.example` is this list with every secret blanked and
 * is committed, `.env` is this list with a secret generated for each and is git ignored. Writing
 * them from one place is what keeps a project from booting on a variable its own example never
 * mentions - or being told to set one that nothing reads.
 */
const ENVIRONMENT_VARIABLES: EnvironmentVariable[] = [
    { comment: 'Where the application listens, and the url it hands out in links it generates.' },
    { key: 'PORT', value: '3000' },
    { key: 'BASE_URL', value: 'http://localhost:3000' },
    { comment: 'The database this application stores everything in.' },
    { key: 'DB_HOST', value: 'localhost' },
    { key: 'DB_PORT', value: '5432' },
    { key: 'DB_USERNAME', value: 'postgres' },
    { key: 'DB_PASSWORD', value: 'postgres' },
    { key: 'DB_DATABASE', value: 'db' },
    { comment: 'Whether the connection to the database is encrypted. "true" anywhere the database is reached over a network.' },
    { key: 'DB_SSL', value: 'false' },
    {
        comment: 'Signs and verifies access and refresh tokens. Anyone holding these can mint a token'
            + '\n# for any user of this application, so they belong in a secret store rather than in a repository.'
    },
    { key: 'JWT_ACCESS_SECRET', secret: true },
    { key: 'JWT_REFRESH_SECRET', secret: true },
    {
        comment: 'Encrypts every encrypted column. Losing it loses that data, and leaking it reveals'
            + '\n# all of it - so rotating this one is a migration rather than an edit.'
    },
    { key: 'MASTER_KEY', secret: true },
    { comment: 'The first user, created on startup while the database holds none.' },
    { key: 'DEFAULT_ADMIN_EMAIL', value: 'admin@example.com' },
    { key: 'DEFAULT_ADMIN_PASSWORD', secret: true },
    { comment: 'Where a password reset link points, which is a page of your frontend rather than of this api.' },
    { key: 'CONFIRM_PASSWORD_RESET_URL', value: 'http://localhost:4200/confirm-password-reset' },
    { comment: 'The mail server outgoing email is sent through. Blank until there is one to name.' },
    { key: 'SMTP_HOST', value: '' },
    { key: 'SMTP_PORT', value: '0' },
    { key: 'SMTP_USER', value: '' },
    { key: 'SMTP_PASSWORD', value: '' },
    { key: 'EMAIL_DEFAULT_SENDER', value: '' }
];

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
    if (name != undefined && email != undefined) {
        return `${name} <${email}>`;
    }
    return name ?? email ?? userInfo().username;
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
 */
export class NewCommand extends BaseCommand<ScaffoldAnswers> {
    protected override maxLength: number | undefined = 5;

    // set for the duration of generateFiles, so that every file it writes is checked against the
    // features in one place, createFile, rather than at each of its forty calls
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
        await this.createFile(getPath(appPath, 'package.json'), [
            '{',
            `    "name": "${configuration.name}",`,
            '    "version": "1.0.0",',
            '    "main": "./dist/index.js",',
            '    "scripts": {',
            '        "start": "webpack --watch",',
            '        "build": "webpack",',
            '        "test": "jest"',
            '    },',
            // the rest of what "npm init" writes, in the order it writes it. npm warns about every
            // one of these a package.json leaves out, and "description" is read by anything that
            // lists the project - so they belong in the file even while they are still empty.
            '    "keywords": ["zibri"],',
            // JSON.stringify rather than quotes of its own: this is the one value here that comes
            // from outside, and a name with an apostrophe in it would otherwise write a broken file.
            `    "author": ${JSON.stringify(resolveAuthor())},`,
            '    "license": "MIT",',
            '    "description": ""',
            '}'
        ]);
        const { dependencies, devDependencies }: ScaffoldDependencies = ScaffoldUtilities.resolveDependencies(configuration.features);
        await CPUtilities.exec(`cd ${appPath} && npm i -D ${devDependencies.join(' ')}`);
        const zibriDependency: string = ScaffoldUtilities.resolveFrameworkDependency('zibri', 'zibri');
        await CPUtilities.exec(`cd ${appPath} && npm i ${[zibriDependency, ...dependencies].join(' ')}`);
        // the test harness, which peer depends on zibri and is therefore installed after it. A
        // devDependency: it starts the application a test drives, and nothing a deployment runs
        // imports it.
        const zibriTestingDependency: string = ScaffoldUtilities.resolveFrameworkDependency('testing', 'zibri-testing');
        await CPUtilities.exec(`cd ${appPath} && npm i -D ${zibriTestingDependency}`);

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
        const { features } = configuration;
        // where each of the two things a build needs goes: the routes each released version served,
        // and the extracted translation source. Both carry a ".gitkeep", because git records files
        // rather than folders - without one the first commit of a new project drops them again, and
        // the clone after it has a build that fails on a folder its own config names and an
        // application that refuses to start because its version history is not there.
        await this.createFile(getPath(appPath, 'versions', '.gitkeep'), '');
        await this.createFile(getPath(appPath, 'translations', '.gitkeep'), '');

        await this.createGitignore(appPath);
        await this.createDockerfile(appPath);
        if (configuration.ci === 'github') {
            await this.createGithubWorkflow(appPath);
        }
        await this.createEnvironmentFiles(appPath);
        await this.createTsConfig(appPath);
        await this.createPostCssConfig(appPath);
        await this.createTailwindConfig(appPath);
        await this.createWebpackConfig(appPath);
        await this.createTsxDts(appPath);
        await this.createJestConfig(appPath);
        await this.createEnvTs(appPath);
        await this.createIndexTs(appPath);
        await this.createApplicationOptions(appPath, configuration);
        await this.createTestingFiles(appPath);
        await this.createProvidersTs(appPath, features);
        await this.createCreateDefaultDataFunction(appPath);
        await this.createDataSource(appPath, features);
        await this.createRepositories(appPath);
        await this.createControllers(appPath);
        await this.createModels(appPath);

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

        await this.createFile(getPath(appPath, 'src', 'controllers', 'index.ts'), [
            'export * from \'./auth.controller\';',
            'export * from \'./health.controller\';',
            ...features.includes('pages') ? ['export * from \'./page.controller\';'] : []
        ]);
        await this.createFile(getPath(appPath, 'src', 'cron', 'index.ts'), '');
        await this.createFile(getPath(appPath, 'src', 'services', 'index.ts'), '');
    }

    private async createFile(filePath: Path, data: string | string[]): Promise<void> {
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
        const relativePath: string = path.relative(this.target.appPath, filePath).split(path.sep).join('/');
        return ScaffoldUtilities.isWrittenFor(relativePath, this.target.features);
    }

    private async createControllers(appPath: Path): Promise<void> {
        await this.createFile(
            getPath(appPath, 'src', 'controllers', 'auth.controller.ts'),
            [
                'import { AuthController, Controller, JwtAuthStrategy, OtpTwoFactorMethod, PasswordAuthenticator } from \'zibri\';',
                '',
                '/**',
                ' * The auth routes: logging in with a password, refreshing a login and logging out, resetting a',
                ' * password, and enrolling a second factor. The options name what the application registers.',
                ' */',
                '@Controller(\'/auth\', { versions: \'all\' })',
                'export class AppAuthController extends AuthController({',
                '    strategies: [JwtAuthStrategy],',
                '    authenticators: [PasswordAuthenticator],',
                '    twoFactorMethods: [OtpTwoFactorMethod]',
                '}) {}'
            ]
        );
        await this.createFile(
            getPath(appPath, 'src', 'controllers', 'page.controller.ts'),
            [
                // eslint-disable-next-line stylistic/max-len
                'import { AssetServiceInterface, Auth, Cache, Cached, CacheServiceInterface, Controller, Get, GlobalRegistry, HtmlResponse, HttpRequestContext, Inject, inject, InMemoryCacheStore, LocaleCode, LoggerInterface, MetricsServiceInterface, Response, TreeNode, TsxUtilities, WebsocketRequestContext, WriteThroughReadThroughCache, ZIBRI_DI_TOKENS } from \'zibri\';',
                '',
                'import { AssetsPage } from \'../templates/pages/assets\';',
                'import { HomePage } from \'../templates/pages/home\';',
                '',
                '@Cache()',
                'export class StaticPagesCache extends WriteThroughReadThroughCache<string, HtmlResponse, \'StaticPagesCache\'> {',
                // eslint-disable-next-line sonar/no-duplicate-string
                '    constructor(',
                '        @Inject(ZIBRI_DI_TOKENS.LOGGER)',
                '        protected readonly logger: LoggerInterface,',
                '        @Inject(ZIBRI_DI_TOKENS.CACHE_SERVICE)',
                '        protected readonly cacheService: CacheServiceInterface,',
                '        @Inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)',
                '        protected readonly metricsService: MetricsServiceInterface',
                '    ) {',
                '        super(\'StaticPagesCache\', new InMemoryCacheStore(), []);',
                '    }',
                '',
                '    static getPageKey(page: string): string {',
                // eslint-disable-next-line stylistic/max-len
                '        const ctx: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);',
                '        const locale: LocaleCode = inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).resolveSupportedLocale(ctx);',
                '        return locale + page;',
                '    }',
                '}',
                '',
                // public whichever defaultAuth the project chose, as its pages are its front door
                '@Auth.skip({ allowRedundant: true })',
                '@Controller(\'/\', { versions: \'all\' })',
                'export class PageController {',
                '',
                '    @Cached(StaticPagesCache, () => StaticPagesCache.getPageKey(\'index\'))',
                '    @Response.html()',
                '    @Get()',
                '    async index(): Promise<HtmlResponse> {',
                '        const html: string = TsxUtilities.renderPage(HomePage, { appName: GlobalRegistry.getAppData(\'name\') ?? \'\' });',
                '        return HtmlResponse.fromString(html);',
                '    }',
                '',
                '    @Cached(StaticPagesCache, () => StaticPagesCache.getPageKey(\'assets\'))',
                '    @Response.html()',
                '    @Get(\'/assets\')',
                '    async assets(): Promise<HtmlResponse> {',
                '        const assetService: AssetServiceInterface = inject(ZIBRI_DI_TOKENS.ASSET_SERVICE);',
                '        const nodes: TreeNode[] = await assetService.buildFileTree();',
                '        const html: string = TsxUtilities.renderPage(AssetsPage, { nodes });',
                '        return HtmlResponse.fromString(html);',
                '    }',
                '}'
            ]
        );
        await this.createFile(
            getPath(appPath, 'src', 'controllers', 'health.controller.ts'),
            [
                'import { $ts, Auth, Controller, Get, GlobalRegistry, ServiceUnavailableError } from \'zibri\';',
                '',
                // a probe must answer the same way whatever posture the application takes, and this one is
                // shipped into a project that is invited to switch its default to "requireLogin"
                '@Auth.skip({ allowRedundant: true })',
                '@Controller(\'/health\', { versions: \'all\' })',
                'export class HealthController {',
                '',
                '    @Get(\'/live\')',
                '    live(): { status: string } {',
                '        return { status: \'ok\' };',
                '    }',
                '',
                '    @Get(\'/ready\')',
                '    ready(): { status: string } {',
                '        if (!GlobalRegistry.isAppStarted()) {',
                '            throw new ServiceUnavailableError($ts`This instance is shutting down.`);',
                '        }',
                '        return { status: \'ok\' };',
                '    }',
                '}'
            ]
        );
    }

    private async createProvidersTs(appPath: Path, features: ScaffoldFeature[]): Promise<void> {
        const pages: boolean = features.includes('pages');
        const mailingList: boolean = features.includes('mailingList');
        const zibriImports: string[] = [
            'AesGcmEncryptionStrategy',
            'defineProvider',
            'DiProvider',
            'EmailConfigInput',
            'JwtAuthOptionsInput',
            'Ms',
            'SmtpEmailTransport',
            'ZIBRI_DI_TOKENS',
            ...mailingList ? ['ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS'] : []
        ];
        await this.createFile(
            getPath(appPath, 'src', 'providers.ts'),
            [
                `import { ${zibriImports.join(', ')} } from 'zibri';`,
                '',
                'import { optionalEnv, requireEnv } from \'./env\';',
                'import { permissions } from \'./models\';',
                ...mailingList
                    ? [
                        'import { MailingListBaseEmail } from \'./templates/email-components/mailing-list-base-email\';',
                        'import { MailingListSubscribeConfirmationEmail } from \'./templates/emails/mailing-list-subscribe-confirmation\';'
                    ]
                    : [],
                'import { PasswordResetEmail } from \'./templates/emails/password-reset\';',
                ...pages ? ['import { ErrorPage } from \'./templates/pages/error\';'] : [],
                ...mailingList
                    ? [
                        'import { MailingListPreferencesPage } from \'./templates/pages/mailing-list-preferences\';',
                        'import { MailingListUnsubscribeConfirmationPage } from \'./templates/pages/mailing-list-unsubscribe-confirmation\';',
                        'import { SubscribeSuccessPage } from \'./templates/pages/subscribe-success\';'
                    ]
                    : [],
                '',
                'export const providers: DiProvider<unknown>[] = [',
                ...pages
                    ? [
                        // eslint-disable-next-line sonar/no-duplicate-string
                        '    defineProvider({',
                        '        token: ZIBRI_DI_TOKENS.ERROR_PAGE_TEMPLATE,',
                        '        useFactory: () => ErrorPage',
                        '    }),'
                    ]
                    : [],
                '    defineProvider({',
                '        token: ZIBRI_DI_TOKENS.ENCRYPTION_MASTER_OPTIONS,',
                '        useValue: {',
                '            currentMasterStrategy: new AesGcmEncryptionStrategy(),',
                '            currentMasterKey: {',
                '                id: \'k1\',',
                '                value: requireEnv(\'MASTER_KEY\')',
                '            }',
                '        }',
                '    }),',
                '    defineProvider({',
                '        token: ZIBRI_DI_TOKENS.PASSWORD_RESET_EMAIL_TEMPLATE,',
                '        useFactory: () => PasswordResetEmail',
                '    }),',
                '    defineProvider({',
                '        token: ZIBRI_DI_TOKENS.JWT_AUTH_OPTIONS_INPUT,',
                '        useFactory: (): JwtAuthOptionsInput => ({',
                '            accessTokenKey: requireEnv(\'JWT_ACCESS_SECRET\'),',
                '            refreshTokenSecret: requireEnv(\'JWT_REFRESH_SECRET\')',
                '        })',
                '    }),',
                '    defineProvider({',
                '        token: ZIBRI_DI_TOKENS.PERMISSIONS,',
                '        useValue: permissions',
                '    }),',
                '    defineProvider({',
                '        token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,',
                '        useFactory: (): EmailConfigInput => {',
                '            return {',
                '                maxEmailsPerHour: 3600,',
                '                defaultSender: optionalEnv(\'EMAIL_DEFAULT_SENDER\'),',
                '                failedRetentionInMs: \'forever\'',
                '            };',
                '        }',
                '    }),',
                '    defineProvider({',
                '        token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT,',
                '        useFactory: () => new SmtpEmailTransport({',
                '            host: optionalEnv(\'SMTP_HOST\'),',
                '            port: Number(optionalEnv(\'SMTP_PORT\')),',
                '            auth: {',
                '                user: optionalEnv(\'SMTP_USER\'),',
                '                pass: optionalEnv(\'SMTP_PASSWORD\')',
                '            }',
                '        })',
                '    }),',
                '    defineProvider({',
                '        token: ZIBRI_DI_TOKENS.EVENT_FAILED_RETENTION_IN_MS,',
                '        useValue: \'forever\'',
                '    }),',
                '    defineProvider({',
                '        token: ZIBRI_DI_TOKENS.THREAD_JOB_RETENTION_IN_MS,',
                '        useValue: \'forever\'',
                '    }),',
                '    defineProvider({',
                '        token: ZIBRI_DI_TOKENS.AUDIT_RETENTION_IN_MS,',
                '        useValue: Ms.DAY * 365',
                '    }),',
                '    defineProvider({',
                '        token: ZIBRI_DI_TOKENS.CONFIRM_PASSWORD_RESET_URL,',
                '        useFactory: () => requireEnv(\'CONFIRM_PASSWORD_RESET_URL\')',
                '    }),',
                ...mailingList
                    ? [
                        '    defineProvider({',
                        '        token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.PREFERENCES_PAGE_TEMPLATE,',
                        '        useFactory: () => MailingListPreferencesPage',
                        '    }),',
                        '    defineProvider({',
                        '        token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.UNSUBSCRIBE_CONFIRMATION_PAGE_TEMPLATE,',
                        '        useFactory: () => MailingListUnsubscribeConfirmationPage',
                        '    }),',
                        '    defineProvider({',
                        '        token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.SUBSCRIBE_CONFIRMATION_EMAIL_TEMPLATE,',
                        '        useFactory: () => MailingListSubscribeConfirmationEmail',
                        '    }),',
                        '    defineProvider({',
                        '        token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.BASE_EMAIL_TEMPLATE,',
                        '        useFactory: () => MailingListBaseEmail',
                        '    }),',
                        '    defineProvider({',
                        '        token: ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS.SUBSCRIBE_SUCCESS_PAGE_TEMPLATE,',
                        '        useFactory: () => SubscribeSuccessPage',
                        '    }),'
                    ]
                    : [],
                '];'
            ]
        );
    }

    private async createCreateDefaultDataFunction(appPath: Path): Promise<void> {
        await this.createFile(getPath(appPath, 'src', 'create-default-data.function.ts'), [
            // eslint-disable-next-line stylistic/max-len
            'import { DataSourceInterface, inject, Newable, PasswordCredentials, PasswordCredentialsCreateData, Repository, repositoryTokenFor, RoleCreateData, TenantServiceInterface, Transaction, ZIBRI_DI_TOKENS } from \'zibri\';',
            '',
            'import { logger } from \'.\';',
            IMPORT_REQUIRE_ENV,
            'import { Permissions, PlatformPermissions, PlatformRoles, Role, Roles, Tenant, User } from \'./models\';',
            'import { MembershipRepository, RoleRepository, UserRepository } from \'./repositories\';',
            '',
            '// the roles the application starts with. Administrators create more, and change these, at runtime',
            'const defaultRoles: RoleCreateData<Role>[] = [',
            '    { name: PlatformRoles.USER, level: \'platform\', permissions: [], description: \'Everybody with an account\' },',
            '    {',
            '        name: PlatformRoles.ADMIN,',
            '        level: \'platform\',',
            '        permissions: Object.values(PlatformPermissions),',
            '        description: \'Administers the application\'',
            '    },',
            '    { name: Roles.USER, level: \'tenant\', permissions: [], description: \'Everybody in a tenant\' },',
            '    { name: Roles.ADMIN, level: \'tenant\', permissions: Object.values(Permissions), description: \'Administers a tenant\' }',
            '];',
            '',
            'export async function createDefaultData(dataSourceClass: Newable<DataSourceInterface>): Promise<void> {',
            '    const dataSource: DataSourceInterface = inject(dataSourceClass);',
            '    logger.info(\'Creates default data if missing\');',
            '',
            '    // one transaction, so that a start failing halfway leaves nothing behind for the next one to trip over',
            '    const transaction: Transaction = await dataSource.startTransaction();',
            '    try {',
            '        await createDefaultRoles(transaction);',
            '        await createDefaultAdmin(transaction);',
            '        await transaction.commit();',
            '    }',
            '    catch (error) {',
            '        await transaction.rollback();',
            '        throw error;',
            '    }',
            '    logger.info(\'Finished creating default data\');',
            '}',
            '',
            'async function createDefaultRoles(transaction: Transaction): Promise<void> {',
            '    const roleRepository: RoleRepository = inject(RoleRepository);',
            // eslint-disable-next-line stylistic/max-len
            '    const existing: Set<string> = new Set((await roleRepository.findAll({ take: \'all\', transaction })).map(role => role.name));',
            '    const missing: RoleCreateData<Role>[] = defaultRoles.filter(role => !existing.has(role.name));',
            '    if (!missing.length) {',
            '        return;',
            '    }',
            '    logger.info(\'  - default roles\');',
            '    await roleRepository.createAll(missing, { transaction });',
            '}',
            '',
            'async function createDefaultAdmin(transaction: Transaction): Promise<void> {',
            '    const userRepository: UserRepository = inject(UserRepository);',
            '    const credentialsRepository: Repository<PasswordCredentials, PasswordCredentialsCreateData>',
            '        = inject(repositoryTokenFor(PasswordCredentials));',
            '',
            '    const email: string = requireEnv(\'DEFAULT_ADMIN_EMAIL\');',
            '',
            '    const defaultUser: User | undefined = await userRepository.findOne({ where: { email }, required: false, transaction });',
            '    if (defaultUser) {',
            '        return;',
            '    }',
            '',
            '    logger.info(\'  - default admin\');',
            // eslint-disable-next-line stylistic/max-len
            '    const user: User = await userRepository.create({ name: \'root\', email, roles: [PlatformRoles.ADMIN] }, { transaction });',
            '    await credentialsRepository.create(',
            '        { password: requireEnv(\'DEFAULT_ADMIN_PASSWORD\'), userId: user.id },',
            '        { transaction }',
            '    );',
            '    await createDefaultTenant(user, transaction);',
            '}',
            '',
            '// the tenant the default admin administers, so that a request naming its id in the x-tenant-id',
            '// header reaches what the default admin may do there',
            'async function createDefaultTenant(admin: User, transaction: Transaction): Promise<void> {',
            '    const tenantRepository: Repository<Tenant> = inject(repositoryTokenFor(Tenant));',
            '    const tenant: Tenant = await tenantRepository.create({ name: \'Default\' }, { transaction });',
            '    const tenantService: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);',
            '    await tenantService.runAs(tenant.id, async () => {',
            '        await inject(MembershipRepository).create({ userId: admin.id, roles: [Roles.ADMIN] }, { transaction });',
            '    });',
            '    logger.info(`  - default tenant ${tenant.id}, administered by the default admin`);',
            '}'
        ]);
    }

    private async createIndexTs(appPath: Path): Promise<void> {
        await this.createFile(getPath(appPath, 'src', 'index.ts'), [
            'import { inject, LoggerInterface, ZIBRI_DI_TOKENS, ZibriApplication } from \'zibri\';',
            '',
            'import { applicationOptions } from \'./application-options\';',
            'import { createDefaultData } from \'./create-default-data.function\';',
            `import { DbDataSource } from './${DATA_SOURCES_DIR}';`,
            IMPORT_REQUIRE_ENV,
            '',
            'export let logger: LoggerInterface;',
            '',
            'async function start(): Promise<void> {',
            '    const app: ZibriApplication = new ZibriApplication(applicationOptions);',
            '    await app.init();',
            '',
            '    logger = inject(ZIBRI_DI_TOKENS.LOGGER);',
            '',
            '    await createDefaultData(DbDataSource);',
            '',
            '    await app.start(Number(requireEnv(\'PORT\')));',
            '}',
            '',
            '// eslint-disable-next-line promise/prefer-await-to-callbacks',
            'void start().catch((error: unknown) => {',
            '    // eslint-disable-next-line no-console',
            '    console.error(error);',
            '    process.exit(1);',
            '});'
        ]);
    }

    private async createApplicationOptions(appPath: Path, configuration: ScaffoldAnswers): Promise<void> {
        const pages: boolean = configuration.features.includes('pages');
        const mailingList: boolean = configuration.features.includes('mailingList');
        const controllers: string[] = [
            'HealthController',
            ...pages ? ['PageController'] : [],
            ...mailingList ? ['MailingListController'] : [],
            'AppAuthController'
        ];
        await this.createFile(getPath(appPath, 'src', 'application-options.base.ts'), [
            mailingList
                ? 'import { MailingListController, OmitStrict, SemVerUtilities, ZibriApplicationOptions, ZibriMailingListPlugin } from \'zibri\';'
                : 'import { OmitStrict, SemVerUtilities, ZibriApplicationOptions } from \'zibri\';',
            '',
            `import { AppAuthController, HealthController${pages ? ', PageController' : ''} } from './controllers';`,
            IMPORT_REQUIRE_ENV,
            'import { version } from \'../package.json\';',
            'import { providers } from \'./providers\';',
            '',
            'if (!SemVerUtilities.isSemVerVersion(version)) {',
            '    throw new Error(\'The version of the package.json is not valid.\');',
            '}',
            '',
            '/**',
            ' * Everything this application is, apart from where it keeps its data.',
            ' *',
            ' * Split from the data source so that a test can build the same application on a different one:',
            ' * importing a module registers whatever it declares, and a data source that is registered without',
            ' * being deployed is refused at boot. A test therefore has to reach the controllers, plugins and',
            ' * providers without reaching the production data source.',
            ' */',
            'export const baseApplicationOptions: OmitStrict<ZibriApplicationOptions, \'dataSources\'> = {',
            `    name: '${configuration.name}',`,
            '    baseUrl: requireEnv(\'BASE_URL\'),',
            `    plugins: [${mailingList ? 'new ZibriMailingListPlugin()' : ''}],`,
            `    controllers: [${controllers.join(', ')}],`,
            '    websocketControllers: [],',
            '    cronJobs: [],',
            '    version,',
            ...configuration.defaultAuth === 'public'
                ? [
                    '    // what an endpoint with no @Auth decorator requires. Switch to \'requireLogin\' to have',
                    '    // a forgotten decorator answer 401 instead of serving anyone, and mark the endpoints',
                    '    // that really are public with @Auth.skip(). See the auth docs.'
                ]
                : [
                    '    // what an endpoint with no @Auth decorator requires: a forgotten decorator answers 401',
                    '    // instead of serving anyone. Mark the endpoints that really are public with @Auth.skip().',
                    '    // See the auth docs.'
                ],
            `    defaultAuth: '${configuration.defaultAuth}',`,
            '    // whether a login asks for a second factor once the password was right: a user who enrolled',
            '    // one presents it to log in. See the two factor docs.',
            '    twoFactorAtLogin: \'ifEnrolled\',',
            '    providers',
            '};'
        ]);
        await this.createFile(getPath(appPath, 'src', 'application-options.ts'), [
            'import { ZibriApplicationOptions } from \'zibri\';',
            '',
            'import { baseApplicationOptions } from \'./application-options.base\';',
            `import { DbDataSource } from './${DATA_SOURCES_DIR}';`,
            '',
            '/**',
            ' * What this application is, as the entry point starts it.',
            ' *',
            ' * Exported rather than written inline so that a test builds the application from the same thing the',
            ' * deployment does, and names only what it changes.',
            ' */',
            'export const applicationOptions: ZibriApplicationOptions = {',
            '    ...baseApplicationOptions,',
            '    dataSources: [DbDataSource]',
            '};'
        ]);
    }

    private async createTestingFiles(appPath: Path): Promise<void> {
        await this.createFile(getPath(appPath, 'src', TESTING_DIR, 'test-application-options.ts'), [
            'import { ZibriApplicationOptions } from \'zibri\';',
            'import { createInMemoryDataSource, defaultTestProviders } from \'zibri-testing\';',
            '',
            'import { baseApplicationOptions } from \'../application-options.base\';',
            `import { entities } from '../${DATA_SOURCES_DIR}/db/entities';`,
            `import { repositories } from '../${DATA_SOURCES_DIR}/db/repositories';`,
            '',
            '/**',
            ' * What this application is when a test starts it.',
            ' *',
            ' * The same application, storing its rows in this process rather than in a database, and with the',
            ' * harness\'s defaults on top of its own providers: work factors sized for a test rather than for an',
            ' * attacker, a scheduler that fires when a test tells it to, and a mail transport that refuses to',
            ' * send. A test that is about one of those registers its own provider for that token and gets the',
            ' * shipped behavior back.',
            ' */',
            'export const testApplicationOptions: ZibriApplicationOptions = {',
            '    ...baseApplicationOptions,',
            '    dataSources: [createInMemoryDataSource({ entities, repositories })],',
            '    providers: [...baseApplicationOptions.providers ?? [], ...defaultTestProviders]',
            '};'
        ]);
        await this.createFile(getPath(appPath, 'src', TESTING_DIR, 'health.test.ts'), [
            'import { afterAll, beforeAll, describe, expect, it } from \'@jest/globals\';',
            'import { StartedTestServer, startTestServer } from \'zibri-testing\';',
            '',
            'import { testApplicationOptions } from \'./test-application-options\';',
            '',
            '/**',
            ' * An example of what testing a Zibri application looks like.',
            ' *',
            ' * The server this drives is the application itself - the same controllers, the same auth, the same',
            ' * lifecycle - so what it answers is what a caller gets.',
            ' */',
            '',
            'let server: StartedTestServer;',
            'let baseUrl: string;',
            '',
            'beforeAll(async () => {',
            '    server = await startTestServer({ application: testApplicationOptions });',
            '    baseUrl = await server.start();',
            '}, 30000);',
            '',
            'afterAll(async () => {',
            '    await server.shutdown();',
            '}, 30000);',
            '',
            'describe(\'the health endpoints\', () => {',
            '',
            '    it(\'answer that the application is ready\', async () => {',
            '        const response: Response = await fetch(`${baseUrl}/health/ready`);',
            '',
            '        expect(response.status).toBe(200);',
            '    });',
            '});'
        ]);
        await this.createFile(getPath(appPath, 'src', TESTING_DIR, 'home-page.test.ts'), [
            'import { afterAll, beforeAll, describe, expect, it } from \'@jest/globals\';',
            'import { StartedTestServer, startTestServer } from \'zibri-testing\';',
            '',
            'import { testApplicationOptions } from \'./test-application-options\';',
            '',
            '/**',
            ' * An example of what testing a Zibri application looks like.',
            ' *',
            ' * The server this drives is the application itself - the same controllers, the same auth, the same',
            ' * lifecycle - so what it answers is what a caller gets.',
            ' */',
            '',
            'let server: StartedTestServer;',
            'let baseUrl: string;',
            '',
            'beforeAll(async () => {',
            '    server = await startTestServer({ application: testApplicationOptions });',
            '    baseUrl = await server.start();',
            '}, 30000);',
            '',
            'afterAll(async () => {',
            '    await server.shutdown();',
            '}, 30000);',
            '',
            'describe(\'the home page\', () => {',
            '',
            '    it(\'is served to anyone\', async () => {',
            '        const response: Response = await fetch(baseUrl);',
            '',
            '        expect(response.status).toBe(200);',
            '    });',
            '});'
        ]);
    }

    private async createGitignore(appPath: Path): Promise<void> {
        await this.createFile(getPath(appPath, '.gitignore'), [
            'node_modules',
            'dist',
            'coverage',
            '# what an upload is written to while a request is handled',
            '.zibri/',
            '# the secrets this application runs on. ".env.example" is the committed list of them',
            '.env',
            '# the types generated for the handlebars templates beside them',
            '*.hbs.ts'
        ]);
    }

    private async createDockerfile(appPath: Path): Promise<void> {
        await this.createFile(getPath(appPath, '.dockerignore'), [
            '# what the build produces or the host happens to have lying around. "node_modules" in',
            '# particular is installed inside the image for the platform it runs on, rather than copied',
            '# from whichever machine ran "docker build"',
            'node_modules',
            'dist',
            'coverage',
            '.git',
            '.zibri',
            '*.hbs.ts',
            '# the secrets this project runs on locally. A deployment sets its own, and a copy baked into',
            '# an image is one that travels to everyone the image is pushed to',
            '.env'
        ]);
        await this.createFile(getPath(appPath, 'Dockerfile'), [
            '# The build needs the dev dependencies, the sources and the toolchain. What runs needs none',
            '# of them, so they stay in a stage that is thrown away and only the second one is shipped.',
            'FROM node:24-slim AS build',
            'WORKDIR /app',
            '',
            '# the manifests first, so that the install layer is reused for every build that does not',
            '# change a dependency',
            'COPY package.json package-lock.json ./',
            'RUN npm ci',
            '',
            'COPY . .',
            'RUN npm run build',
            '',
            '# what running needs, out of what building needed. Pruning here rather than installing a',
            '# second time in the stage below keeps one resolution of the dependency tree, so what the',
            '# application runs against is what its bundle was built against.',
            'RUN npm prune --omit=dev',
            '',
            'FROM node:24-slim AS runtime',
            'WORKDIR /app',
            '',
            '# read by the framework and by anything it depends on. It is what turns off the machinery a',
            '# development machine wants and a deployment pays for',
            'ENV NODE_ENV=production',
            '',
            'COPY --from=build /app/package.json ./package.json',
            'COPY --from=build /app/node_modules ./node_modules',
            '',
            '# the bundle carries everything read from inside it: the assets, the compiled templates and',
            '# the translations. "versions" is the one thing read from beside it, because the application',
            '# writes to it and the next release is checked against what this one recorded. An image',
            '# without it does not start, which is the point: an application that quietly treated the',
            '# version it is on as the first one that ever existed would drop every guarantee it gives.',
            'COPY --from=build /app/dist ./dist',
            'COPY --chown=node:node versions ./versions',
            '',
            '# the two paths written while the application runs, owned by the user that runs it. Nothing',
            '# else under /app is, so the rest of the image stays read only to the process using it.',
            'RUN mkdir -p /app/.zibri && chown -R node:node /app/.zibri',
            '',
            'USER node',
            '',
            '# what the application listens on by default. It reads PORT, so a deployment that publishes',
            '# a different one sets that too',
            'EXPOSE 3000',
            '',
            '# the liveness half of the health controller: whether the process is up, which is what a',
            '# restart should depend on. Readiness is the orchestrator\'s to poll, at /health/ready.',
            'HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD \\',
            // node 24 has fetch, so this needs nothing installed into the image to ask a question of it
            '    node -e "fetch(\'http://127.0.0.1:\'+(process.env.PORT||3000)+\'/health/live\')'
            + '.then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"',
            '',
            '# the exec form rather than a shell, so that the signal a stop sends arrives at node itself',
            '# and the application shuts down in the orderly way it knows how to',
            'CMD ["node", "dist/bundle.js"]'
        ]);
    }

    private async createGithubWorkflow(appPath: Path): Promise<void> {
        const secrets: string[] = ENVIRONMENT_VARIABLES.flatMap(entry => entry.secret === true ? [entry.key] : []);
        await this.createFile(getPath(appPath, '.github', 'workflows', 'ci.yml'), [
            '# Installs, builds and tests this project on every pull request and every push to main.',
            'name: CI',
            'on:',
            '    push:',
            '        branches: [main]',
            '    pull_request:',
            '',
            'jobs:',
            '    test:',
            '        runs-on: ubuntu-latest',
            '        steps:',
            '            - uses: actions/checkout@v4',
            '            - uses: actions/setup-node@v4',
            '              with:',
            // the runtime the Dockerfile ships, so what is tested here is what is deployed
            '                node-version: \'24\'',
            '                cache: npm',
            '            - run: npm ci',
            '            # ".env" is git ignored, so a checkout has none. This does what ".env.example" asks of',
            '            # anyone on a new machine: copy it and fill each blank secret, here with values made for',
            '            # this run alone',
            '            - name: write the environment the tests run on',
            '              run: |',
            '                cp .env.example .env',
            `                for key in ${secrets.join(' ')}; do`,
            '                  sed -i "s/^$key=$/$key=$(openssl rand -hex 32)/" .env',
            '                done',
            '            - run: npm run build',
            '            - run: npm test'
        ]);
    }

    private async createEnvironmentFiles(appPath: Path): Promise<void> {
        const example: string[] = [
            '# Every variable this application reads. Copy it to ".env" to run the app somewhere new.',
            '#',
            '# "zi new" already wrote a ".env" with a secret generated for each blank below, so this',
            '# project runs as it stands. What is missing here is deliberate: a value published with',
            '# the cli is a value everyone has.'
        ];
        const actual: string[] = [
            '# The secrets this application runs on, generated for this project. Git ignored.',
            '#',
            '# ".env.example" is the committed list of what a deployment has to set.'
        ];

        for (const entry of ENVIRONMENT_VARIABLES) {
            if (entry.comment != undefined) {
                example.push('', `# ${entry.comment}`);
                actual.push('', `# ${entry.comment}`);
                continue;
            }
            example.push(`${entry.key}=${entry.secret === true ? '' : entry.value}`);
            // 32 bytes, base64url so that nothing in it has to be escaped by whatever reads the file
            actual.push(`${entry.key}=${entry.secret === true ? randomBytes(32).toString('base64url') : entry.value}`);
        }

        await this.createFile(getPath(appPath, '.env.example'), example);
        await this.createFile(getPath(appPath, '.env'), actual);
    }

    private async createEnvTs(appPath: Path): Promise<void> {
        await this.createFile(getPath(appPath, 'src', 'env.ts'), [
            'import { existsSync, readFileSync } from \'node:fs\';',
            'import { parseEnv } from \'node:util\';',
            '',
            '/**',
            ' * Loads the ".env" beside the application, when there is one.',
            ' *',
            ' * Here rather than in the entry point because imports are evaluated before any statement in',
            ' * it: by the time start() could load anything, every module that reads a variable has already',
            ' * read it. Anything reaching for a variable imports this file, so the file is loaded first by',
            ' * construction.',
            ' *',
            ' * A missing ".env" is not an error. A deployment usually sets its variables directly, and',
            ' * writing them to disk there is the thing to avoid rather than the thing to require.',
            ' */',
            'if (existsSync(\'.env\')) {',
            '    // assigned here rather than through process.loadEnvFile, which writes to the environment of the',
            '    // process itself: jest hands each test file a copy of that, taken before this line ran',
            '    for (const [key, value] of Object.entries(parseEnv(readFileSync(\'.env\', \'utf8\')))) {',
            '        // a variable the environment already sets wins over the file, as with process.loadEnvFile',
            '        process.env[key] ??= value;',
            '    }',
            '}',
            '',
            '/**',
            ' * Reads a variable the application cannot run without.',
            ' * @param key - The name of the variable.',
            ' * @returns Its value.',
            ' * @throws When it is unset or empty, naming the variable. A deployment that forgot one stops',
            ' * here, rather than signing tokens with an empty string and finding out later.',
            ' */',
            'export function requireEnv(key: string): string {',
            '    const value: string | undefined = process.env[key];',
            '    if (value == undefined || value === \'\') {',
            '        throw new Error(`The environment variable "${key}" is not set. See .env.example.`);',
            '    }',
            '    return value;',
            '}',
            '',
            '/**',
            ' * Reads a yes-or-no variable the application cannot run without.',
            ' * @param key - The name of the variable, which holds "true" or "false".',
            ' * @returns Whether it is "true".',
            ' * @throws When it is anything but "true" or "false", naming the variable. A typo stops here,',
            ' * rather than reading as "false" and turning off what it was meant to turn on.',
            ' */',
            'export function requireBooleanEnv(key: string): boolean {',
            '    const value: string = requireEnv(key);',
            '    if (value !== \'true\' && value !== \'false\') {',
            '        throw new Error(`The environment variable "${key}" has to be "true" or "false", got "${value}".`);',
            '    }',
            '    return value === \'true\';',
            '}',
            '',
            '/**',
            ' * Reads a variable the application runs without.',
            ' * @param key - The name of the variable.',
            ' * @returns Its value, or an empty string when it is unset.',
            ' */',
            'export function optionalEnv(key: string): string {',
            '    return process.env[key] ?? \'\';',
            '}'
        ]);
    }

    private async createJestConfig(appPath: Path): Promise<void> {
        await this.createFile(getPath(appPath, 'jest.config.mjs'), [
            '/** @type {import(\'jest\').Config} */',
            'const config = {',
            '    // how TypeScript, the templates and the packages the framework loads are compiled for a test',
            '    preset: \'zibri-testing\',',
            '    rootDir: \'src\'',
            '};',
            '',
            'export default config;'
        ]);
    }

    private async createModels(appPath: Path): Promise<void> {
        await this.createFile(getPath(appPath, 'src', 'models', 'index.ts'), [
            'export * from \'./user.model\';',
            'export * from \'./membership.model\';',
            'export * from \'./role.model\';',
            'export * from \'./roles.enum\';',
            'export * from \'./platform-roles.enum\';',
            'export * from \'./permissions\';',
            'export * from \'./tenant.model\';'
        ]);
        await this.createFile(getPath(appPath, 'src', 'models', 'tenant.model.ts'), [
            'import { BaseEntity, Entity, Property } from \'zibri\';',
            '',
            '// the tenants of this application: a tenant\'s id is the tenant id of everything it holds. Shared,',
            '// because the tenants are what every request picks its tenant from',
            '@Entity({ tenant: \'shared\', defaultOrder: { name: \'ASC\' } })',
            'export class Tenant extends BaseEntity {',
            '    @Property.string({ unique: true })',
            '    name!: string;',
            '}'
        ]);
        await this.createFile(getPath(appPath, 'src', 'models', 'membership.model.ts'), [
            'import { BaseMembershipEntity, Entity } from \'zibri\';',
            '',
            '// one membership per user in each tenant, holding the names of roles',
            '@Entity({ uniques: [[\'userId\']] })',
            'export class Membership extends BaseMembershipEntity() {}'
        ]);
        await this.createFile(getPath(appPath, 'src', 'models', 'roles.enum.ts'), [
            '// the tenant roles the application starts with, held by a user through their membership in a tenant',
            'export enum Roles {',
            '    USER = \'user\',',
            '    ADMIN = \'admin\'',
            '}'
        ]);
        await this.createFile(getPath(appPath, 'src', 'models', 'permissions.ts'), [
            // eslint-disable-next-line stylistic/max-len
            'import { DefinedPermissions, definePermissions, DefinedPlatformPermissions, definePlatformPermissions, PermissionDeclaration, ZIBRI_PERMISSIONS, ZIBRI_PLATFORM_PERMISSIONS } from \'zibri\';',
            '',
            '// every permission of the application: what routes may ask for, and what roles may carry. A tenant',
            '// permission is held through a membership, a platform permission by the user. See the permissions docs.',
            '// eslint-disable-next-line typescript/typedef',
            'const PERMISSIONS = [...ZIBRI_PERMISSIONS] as const;',
            '// eslint-disable-next-line typescript/typedef',
            'const PLATFORM_PERMISSIONS = [...ZIBRI_PLATFORM_PERMISSIONS] as const;',
            '',
            'export const Permissions: DefinedPermissions<typeof PERMISSIONS> = definePermissions(PERMISSIONS);',
            // eslint-disable-next-line stylistic/max-len
            'export const PlatformPermissions: DefinedPlatformPermissions<typeof PLATFORM_PERMISSIONS> = definePlatformPermissions(PLATFORM_PERMISSIONS);',
            '',
            'export const permissions: PermissionDeclaration = {',
            '    permissions: Object.values(Permissions),',
            '    platformPermissions: Object.values(PlatformPermissions)',
            '};'
        ]);
        await this.createFile(getPath(appPath, 'src', 'models', 'role.model.ts'), [
            'import { BaseRoleEntity, Entity, Property } from \'zibri\';',
            '',
            '// the roles users and memberships hold: one every tenant shares, or one of a tenant\'s own',
            '@Entity()',
            'export class Role extends BaseRoleEntity {',
            '    @Property.string({ required: false })',
            '    description: string | undefined | null;',
            '}'
        ]);
        await this.createFile(getPath(appPath, 'src', 'models', 'generated', 'providers.ts'), [
            'import { EntityGenerationProvider } from \'zibri\';',
            '',
            'export const providers: EntityGenerationProvider[] = [];'
        ]);
        await this.createFile(getPath(appPath, 'src', 'models', 'platform-roles.enum.ts'), [
            '// the platform roles the application starts with, held by a user whichever tenant a request is for',
            'export enum PlatformRoles {',
            '    USER = \'platform-user\',',
            '    ADMIN = \'platform-admin\'',
            '}'
        ]);
        await this.createFile(getPath(appPath, 'src', 'models', 'user.model.ts'), [
            'import { BaseUserEntity, Entity, IntersectionClass, OmitClass, PasswordCredentials, Property } from \'zibri\';',
            '',
            '// \'shared\' because one user can be member in multiple tenants. Its roles are the names of roles',
            '@Entity({ tenant: \'shared\' })',
            'export class User extends BaseUserEntity() {',
            '    @Property.string()',
            '    name!: string;',
            '}',
            '',
            'export class UserCreateDto extends IntersectionClass(',
            '    OmitClass(User, [\'id\', \'roles\']),',
            '    OmitClass(PasswordCredentials, [\'id\', \'userId\'])',
            ') {}',
            '',
            'export type UserCreateData = Omit<User, \'id\'>;'
        ]);
    }

    private async createRepositories(appPath: Path): Promise<void> {
        await this.createFile(getPath(appPath, 'src', 'repositories', 'index.ts'), [
            'export * from \'./user.repository\';',
            'export * from \'./membership.repository\';',
            'export * from \'./role.repository\';'
        ]);
        await this.createFile(getPath(appPath, 'src', 'repositories', 'role.repository.ts'), [
            'import { BaseRoleRepository, RepositoryFor } from \'zibri\';',
            '',
            'import { Role } from \'../models\';',
            '',
            '@RepositoryFor(Role)',
            'export class RoleRepository extends BaseRoleRepository<Role>() {}'
        ]);
        await this.createFile(getPath(appPath, 'src', 'repositories', 'membership.repository.ts'), [
            'import { BaseMembershipRepository, RepositoryFor } from \'zibri\';',
            '',
            'import { Membership } from \'../models\';',
            '',
            '@RepositoryFor(Membership)',
            'export class MembershipRepository extends BaseMembershipRepository<Membership>() {}'
        ]);
        await this.createFile(getPath(appPath, 'src', 'repositories', 'user.repository.ts'), [
            'import { BaseUserRepository, RepositoryFor } from \'zibri\';',
            '',
            'import { User, UserCreateData } from \'../models\';',
            '',
            '@RepositoryFor(User)',
            'export class UserRepository extends BaseUserRepository<User, UserCreateData>() {}'
        ]);
    }

    private async createDataSource(appPath: Path, features: ScaffoldFeature[]): Promise<void> {
        const mailingListEntities: string[] = features.includes('mailingList')
            ? ['MailingList', 'MailingListSubscriber', 'MailingListSubscriptionConfirmationToken']
            : [];
        const frameworkEntities: string[] = [
            'AuditEntry',
            'BaseEntity',
            'BackupEntity',
            'BackupResourceEntity',
            'CacheInvalidation',
            'Change',
            'ChangeSet',
            'CronJobEntity',
            'Email',
            'EncryptionKey',
            'EncryptionRotationFailure',
            'EncryptionRotationProgress',
            'EncryptionStrategyEntity',
            'Event',
            'EventSubscriberRegistration',
            'EventSubscriberRun',
            'HashStrategyEntity',
            'JwtRefreshToken',
            'Lease',
            'Log',
            'LoginTicket',
            ...mailingListEntities,
            'MigrationEntity',
            'Newable',
            'OtpCredentials',
            'PasswordCredentials',
            'PasswordResetToken',
            'ThreadJobEntity',
            'TwoFactorFailureStreak',
            'WebsocketChannel',
            'WebsocketMessage',
            'WebsocketMessageSequence'
        ];
        await this.createFile(getPath(appPath, 'src', DATA_SOURCES_DIR, 'db', 'db.data-source.ts'), [
            // eslint-disable-next-line stylistic/max-len
            'import { BaseEntity, DataSource, Newable, OmitStrict, PostgresDataSource, PostgresOptions, RepositoryClass, SchemaManagement } from \'zibri\';',
            '',
            'import { entities } from \'./entities\';',
            'import { repositories } from \'./repositories\';',
            'import { requireBooleanEnv, requireEnv } from \'../../env\';',
            '',
            '@DataSource()',
            'export class DbDataSource extends PostgresDataSource {',
            '    // the framework alters the database to match these classes on every boot, which is what a',
            '    // model that is still moving wants and the wrong thing once anything is stored: a renamed',
            '    // property takes the old column and its contents with it. Switch to \'migrations\' before',
            '    // this application holds data anyone would miss. See the data source docs.',
            '    schemaManagement: SchemaManagement = \'synchronize\';',
            '',
            '    options: OmitStrict<PostgresOptions, \'type\' | \'entities\'> = {',
            '        host: requireEnv(\'DB_HOST\'),',
            '        port: Number(requireEnv(\'DB_PORT\')),',
            '        username: requireEnv(\'DB_USERNAME\'),',
            '        password: requireEnv(\'DB_PASSWORD\'),',
            '        database: requireEnv(\'DB_DATABASE\'),',
            '        ssl: requireBooleanEnv(\'DB_SSL\')',
            '    };',
            '    entities: Newable<BaseEntity>[] = entities;',
            '    repositories: RepositoryClass[] = repositories;',
            '}'
        ]);
        await this.createFile(getPath(appPath, 'src', DATA_SOURCES_DIR, 'db', 'repositories.ts'), [
            'import { RepositoryClass } from \'zibri\';',
            '',
            'import { MembershipRepository, RoleRepository, UserRepository } from \'../../repositories\';',
            '',
            '/**',
            ' * The repository classes of this application\'s entities.',
            ' *',
            ' * Declared here rather than on the data source for the reason the entities are, so that a test\'s',
            ' * data source of the same entities reads them through the same classes.',
            ' */',
            'export const repositories: RepositoryClass[] = [',
            '    UserRepository,',
            '    MembershipRepository,',
            '    RoleRepository',
            '];'
        ]);
        await this.createFile(getPath(appPath, 'src', DATA_SOURCES_DIR, 'db', 'entities.ts'), [
            `import { ${frameworkEntities.join(', ')} } from 'zibri';`,
            '',
            'import { Membership, Role, Tenant, User } from \'../../models\';',
            '',
            '/**',
            ' * Everything this application stores.',
            ' *',
            ' * Its own on top of the ones the framework and its plugins keep rows in. Declared here rather than',
            ' * on the data source so that a test can put the same entities into a data source of its own without',
            ' * the list drifting from the one production uses.',
            ' */',
            'export const entities: Newable<BaseEntity>[] = [',
            '    MigrationEntity,',
            '    User,',
            '    Membership,',
            '    Role,',
            '    JwtRefreshToken,',
            '    PasswordCredentials,',
            '    PasswordResetToken,',
            '    Tenant,',
            ...mailingListEntities.map(entity => `    ${entity},`),
            '    Log,',
            '    AuditEntry,',
            '    Change,',
            '    ChangeSet,',
            '    OtpCredentials,',
            '    TwoFactorFailureStreak,',
            '    LoginTicket,',
            '    BackupEntity,',
            '    BackupResourceEntity,',
            '    Email,',
            '    CronJobEntity,',
            '    ThreadJobEntity,',
            '    WebsocketChannel,',
            '    WebsocketMessage,',
            '    WebsocketMessageSequence,',
            '    Event,',
            '    EventSubscriberRun,',
            '    EventSubscriberRegistration,',
            '    Lease,',
            '    HashStrategyEntity,',
            '    EncryptionStrategyEntity,',
            '    EncryptionKey,',
            '    EncryptionRotationProgress,',
            '    EncryptionRotationFailure,',
            '    CacheInvalidation',
            '];'
        ]);
        await this.createFile(
            getPath(appPath, 'src', DATA_SOURCES_DIR, 'db', 'migrations', 'index.ts'), ''
        );
        await this.createFile(getPath(appPath, 'src', DATA_SOURCES_DIR, 'db', 'index.ts'), 'export * from \'./db.data-source\';');
        await this.createFile(getPath(appPath, 'src', DATA_SOURCES_DIR, 'index.ts'), 'export * from \'./db\';');
    }

    private async createWebpackConfig(appPath: Path): Promise<void> {
        await this.createFile(getPath(appPath, 'webpack.config.js'), [
            'const { resolveWebpackConfiguration } = require(\'zibri/webpack\');',
            '',
            '/**',
            ' * The build as zibri ships it, which "npm update" keeps current. Change what it returns to',
            ' * make a part of it this project\'s own.',
            ' */',
            'module.exports = resolveWebpackConfiguration({ root: __dirname });'
        ]);
    }

    private async createTsConfig(appPath: Path): Promise<void> {
        await this.createFile(getPath(appPath, 'tsconfig.json'), [
            '{',
            '    "extends": "zibri/tsconfig.application.json",',
            '    "compilerOptions": {',
            '        "outDir": "dist"',
            '    },',
            '    "include": ["src"]',
            '}'
        ]);
    }

    private async createPostCssConfig(appPath: Path): Promise<void> {
        await this.createFile(getPath(appPath, 'postcss.config.js'), [
            'module.exports = {',
            '    plugins: {',
            '        tailwindcss: {},',
            '        autoprefixer: {}',
            '    }',
            '};'
        ]);
    }

    private async createTailwindConfig(appPath: Path): Promise<void> {
        await this.createFile(getPath(appPath, 'tailwind.config.js'), [
            '/** @type {import(\'tailwindcss\').Config} */',
            'module.exports = {',
            '    content: [\'./src/templates/**/*.{tsx,hbs}\'],',
            '    theme: {',
            '        colors: {',
            '            primary: \'#0e456f\',',
            '            white: \'whitesmoke\',',
            '            secondary: \'#00b4d8\',',
            '            gray: \'#2a2a35\',',
            '            \'dark-gray\': \'#1a1a26\',',
            '            disabled: \'lightgrey\',',
            '            \'disabled-dark\': \'grey\'',
            '        },',
            '        boxShadow: {',
            // eslint-disable-next-line stylistic/max-len
            '            elevation: \'0px 5px 5px -3px rgba(0,0,0,0.2), 0px 8px 10px 1px rgba(0,0,0,0.14), 0px 3px 14px 2px rgba(0,0,0,0.12)\'',
            '        }',
            '    },',
            '    plugins: []',
            '};'
        ]);
    }

    private async createTsxDts(appPath: Path): Promise<void> {
        await this.createFile(getPath(appPath, 'src', 'tsx.d.ts'), [
            'declare module \'chart.js?client\' {',
            '    export * from \'chart.js\';',
            '}'
        ]);
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