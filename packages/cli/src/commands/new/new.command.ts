/* eslint-disable no-console */
import { randomBytes } from 'node:crypto';
import { userInfo } from 'node:os';

import packageJson from '../../../package.json' with { type: 'json' };
import { CPUtilities, FsUtilities, InquirerUtilities, QuestionsFor } from '../../encapsulation/index.ts';
import { exitWithError, getPath, Path } from '../../utilities/index.ts';
import { BaseCommand } from '../base-command.model.ts';

/**
 * Where a new app's pull requests are built and tested, or `none` for nowhere yet.
 */
type ContinuousIntegration = 'github' | 'none';

const CONTINUOUS_INTEGRATIONS: ContinuousIntegration[] = ['github', 'none'];

/**
 * What an endpoint without an `@Auth` decorator requires in the new app.
 */
type DefaultAuth = 'requireLogin' | 'public';

const DEFAULT_AUTHS: DefaultAuth[] = ['requireLogin', 'public'];

/**
 * Configuration for creating a new zibri app.
 */
type NewConfiguration = {
    /**
     * The name of the app to create.
     */
    name: string,
    /**
     * The continuous integration workflow to generate.
     */
    ci: ContinuousIntegration,
    /**
     * What an endpoint without an `@Auth` decorator requires.
     */
    defaultAuth: DefaultAuth
};

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

const newConfigurationQuestions: QuestionsFor<NewConfiguration> = {
    name: {
        name: 'name',
        type: 'input',
        message: 'name',
        validate: (value: string) => !!value
    },
    ci: {
        name: 'ci',
        type: 'select',
        message: 'ci workflow',
        choices: [
            { name: 'GitHub Actions', value: 'github' },
            { name: 'none', value: 'none' }
        ]
    },
    // asked rather than answered, as the application options require it to be said: an endpoint
    // whose decorator was forgotten is open or closed by this, and only the developer knows which
    // they want. A login first, as forgetting is what it guards against
    defaultAuth: {
        name: 'defaultAuth',
        type: 'select',
        message: 'what an endpoint without @Auth requires',
        choices: [
            { name: 'a login (a forgotten decorator answers 401)', value: 'requireLogin' },
            { name: 'nothing (a forgotten decorator serves anyone)', value: 'public' }
        ]
    }
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
 * Reads the continuous integration named on the command line.
 * @param value - What was passed.
 * @returns The continuous integration it names. Exits naming the valid ones when it names none.
 */
async function resolveContinuousIntegration(value: string): Promise<ContinuousIntegration> {
    return CONTINUOUS_INTEGRATIONS.find(ci => ci === value)
        ?? await exitWithError(`Unknown ci "${value}", expected one of: ${CONTINUOUS_INTEGRATIONS.join(', ')}`);
}

/**
 * Reads the default auth named on the command line.
 * @param value - What was passed.
 * @returns The default auth it names. Exits naming the valid ones when it names none.
 */
async function resolveDefaultAuth(value: string): Promise<DefaultAuth> {
    return DEFAULT_AUTHS.find(defaultAuth => defaultAuth === value)
        ?? await exitWithError(`Unknown defaultAuth "${value}", expected one of: ${DEFAULT_AUTHS.join(', ')}`);
}

/**
 * Creates a new Zibri application.
 */
export class NewCommand extends BaseCommand<NewConfiguration> {
    protected override maxLength: number | undefined = 4;

    protected override async run(configuration: NewConfiguration): Promise<void> {
        console.log('creates a new zibri application', configuration.name);
        const appPath: Path = getPath(configuration.name);
        if (await FsUtilities.exists(appPath)) {
            await exitWithError(`Could not create folder "${appPath}": It already exists`);
        }
        await FsUtilities.mkdir(appPath);
        // Written directly instead of via "npm init": npm walks up to the nearest ancestor
        // package.json when the cwd has none of its own, which inside the monorepo means it
        // would write into packages/cli/package.json instead of appPath/package.json.
        await FsUtilities.createFile(getPath(appPath, 'package.json'), [
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
        const devDependencies: string[] = [
            // the types for the runtime this project targets. Its own code reads process.env and
            // loads a .env, which without these is untyped in a project that compiles with strict on
            '@types/node@^24.0.0',
            'autoprefixer@^10.4.27',
            'copy-webpack-plugin@^14.0.0',
            'css-loader@^7.1.4',
            'handlebars-loader@^1.7.3',
            'jest@^30.4.2',
            'mini-css-extract-plugin@^2.10.0',
            'postcss@^8.5.6',
            'postcss-loader@^8.2.1',
            'source-map-loader@^5.0.0',
            'tailwindcss@3',
            'ts-jest@^29.4.11',
            'ts-loader@^9.5.4',
            'typescript@^5.9.3',
            'webpack@^5.105.3',
            'webpack-cli@^6.0.1'
        ];

        await CPUtilities.exec(`cd ${appPath} && npm i -D ${devDependencies.join(' ')}`);
        // ZIBRI_CLI_LOCAL_DEV is only set by this package's own "start"/"clear" scripts, so a
        // published "zi new" install always resolves the real packages from npm.
        // zibri-tsx is not installed explicitly: it is a peer dependency of zibri, so npm resolves
        // it on its own and the generated app does not need to declare it.
        //
        // ts-node and pg-query-stream are the exceptions, because they are *optional* peer
        // dependencies and npm therefore installs none of them. A generated app runs its worker
        // files as TypeScript, which is what `multithreading.enableTsWorkerFiles` defaults to, so it
        // has to ask for the compiler itself. An app that ships compiled worker files can turn that
        // option off and drop this. pg-query-stream is what a postgres data source opens a cursor
        // through, and the generated app has one, so it is refused at boot without it.
        //
        // saxes is an optional peer needed by the defaults as well: the xml body parser is one of the
        // default body parsers, the translations the generated webpack config extracts on every build
        // are read at startup, and both read through it. otpauth is an optional peer needed at boot: an
        // application that names no two factor methods is given `OtpTwoFactorMethod`, which asks for
        // otpauth as it is constructed. jose is the same for the default auth strategy: an application
        // that names none is given `JwtAuthStrategy`, which asks for jose as it is constructed.
        //
        // The two OpenTelemetry packages are the same story once more. The tracer registered by
        // default records through them and validates them at startup, so an application taking the
        // defaults needs both; one that registers a tracer of its own drops them with the default it
        // replaced. Its exporter package is *not* installed: spans are kept in memory until an
        // application says where to send them, and saying so is what makes the exporter needed.
        //
        // re2 is installed although nothing generated declares a `regex` yet. Declaring one is
        // ordinary validation on a string property or parameter, and a project should not be stopped
        // by a missing package the first time it does.
        //
        // The pattern under the optional six: a peer is optional to the *framework* and not to an application
        // that takes the defaults, so the generator installs what its own generated configuration
        // reaches for. Turning one of those defaults off is what makes the matching package droppable.
        const zibriDependency: string = process.env['ZIBRI_CLI_LOCAL_DEV']
            ? `file:${getPath(import.meta.dirname, '..', '..', '..', '..', 'zibri')}`
            : `zibri@${packageJson.version}`;
        await CPUtilities.exec(
            `cd ${appPath} && npm i ${zibriDependency} chart.js ts-node@^10.9.2 pg-query-stream@^4.10.3`
            + ' saxes@^6.0.0 otpauth@^9.5.1 jose@^6.2.12 @opentelemetry/api@^1.9.1'
            + ' @opentelemetry/sdk-trace-node@^2.11.0 re2@^1.27.0 nodemailer@^10.1.0'
            + ' prom-client@^15.1.3 @fastify/busboy@^3.2.3 systeminformation@^5.33.15'
        );
        // the test harness, which peer depends on zibri and is therefore installed after it. A
        // devDependency: it starts the application a test drives, and nothing a deployment runs
        // imports it.
        const zibriTestingDependency: string = process.env['ZIBRI_CLI_LOCAL_DEV']
            ? `file:${getPath(import.meta.dirname, '..', '..', '..', '..', 'testing')}`
            : `zibri-testing@${packageJson.version}`;
        await CPUtilities.exec(`cd ${appPath} && npm i -D ${zibriTestingDependency}`);

        // where each of the two things a build needs goes: the routes each released version served,
        // and the extracted translation source. Both carry a ".gitkeep", because git records files
        // rather than folders - without one the first commit of a new project drops them again, and
        // the clone after it has a build that fails on a folder its own config names and an
        // application that refuses to start because its version history is not there.
        await FsUtilities.createFile(getPath(appPath, 'versions', '.gitkeep'), '');
        await FsUtilities.createFile(getPath(appPath, 'translations', '.gitkeep'), '');

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
        await this.createProvidersTs(appPath);
        await this.createCreateDefaultDataFunction(appPath);
        await this.createDataSource(appPath);
        await this.createRepositories(appPath);
        await this.createControllers(appPath);
        await this.createModels(appPath);

        await FsUtilities.copyDirectoryContent(
            getPath(import.meta.dirname, '..', '..', '..', 'assets'),
            getPath(appPath, 'assets')
        );
        await FsUtilities.copyDirectoryContent(
            getPath(import.meta.dirname, '..', '..', '..', 'templates'),
            getPath(appPath, 'src', 'templates')
        );

        await FsUtilities.createFile(getPath(appPath, 'src', 'controllers', 'index.ts'), [
            'export * from \'./auth.controller\';',
            'export * from \'./health.controller\';',
            'export * from \'./page.controller\';'
        ]);
        await FsUtilities.createFile(getPath(appPath, 'src', 'cron', 'index.ts'), '');
        await FsUtilities.createFile(getPath(appPath, 'src', 'services', 'index.ts'), '');
    }

    private async createControllers(appPath: Path): Promise<void> {
        await FsUtilities.createFile(
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
        await FsUtilities.createFile(
            getPath(appPath, 'src', 'controllers', 'page.controller.ts'),
            [
                'import { AssetServiceInterface, Auth, Cache, Cached, CacheServiceInterface, Controller, Get, GlobalRegistry, HtmlResponse, HttpRequestContext, Inject, inject, InMemoryCacheStore, LocaleCode, LoggerInterface, MetricsServiceInterface, Response, TreeNode, TsxUtilities, WebsocketRequestContext, WriteThroughReadThroughCache, ZIBRI_DI_TOKENS } from \'zibri\';',
                '',
                'import { AssetsPage } from \'../templates/pages/assets\';',
                'import { HomePage } from \'../templates/pages/home\';',
                '',
                '@Cache()',
                'export class StaticPagesCache extends WriteThroughReadThroughCache<string, HtmlResponse, \'StaticPagesCache\'> {',
                // eslint-disable-next-line sonarjs/no-duplicate-string
                '    constructor(',
                // eslint-disable-next-line sonarjs/no-duplicate-string
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
        await FsUtilities.createFile(
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

    private async createProvidersTs(appPath: Path): Promise<void> {
        await FsUtilities.createFile(
            getPath(appPath, 'src', 'providers.ts'),
            [
                'import { AesGcmEncryptionStrategy, defineProvider, DiProvider, EmailConfigInput, JwtAuthOptionsInput, SmtpEmailTransport, ZIBRI_DI_TOKENS, ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS } from \'zibri\';',
                '',
                'import { optionalEnv, requireEnv } from \'./env\';',
                'import { MailingListBaseEmail } from \'./templates/email-components/mailing-list-base-email\';',
                'import { MailingListSubscribeConfirmationEmail } from \'./templates/emails/mailing-list-subscribe-confirmation\';',
                'import { PasswordResetEmail } from \'./templates/emails/password-reset\';',
                'import { ErrorPage } from \'./templates/pages/error\';',
                'import { MailingListPreferencesPage } from \'./templates/pages/mailing-list-preferences\';',
                'import { MailingListUnsubscribeConfirmationPage } from \'./templates/pages/mailing-list-unsubscribe-confirmation\';',
                'import { SubscribeSuccessPage } from \'./templates/pages/subscribe-success\';',
                '',
                'export const providers: DiProvider<unknown>[] = [',
                // eslint-disable-next-line sonarjs/no-duplicate-string
                '    defineProvider({',
                '        token: ZIBRI_DI_TOKENS.ERROR_PAGE_TEMPLATE,',
                '        useFactory: () => ErrorPage',
                '    }),',
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
                '        token: ZIBRI_DI_TOKENS.CONFIRM_PASSWORD_RESET_URL,',
                '        useFactory: () => requireEnv(\'CONFIRM_PASSWORD_RESET_URL\')',
                '    }),',
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
                '    }),',
                '];'
            ]
        );
    }

    private async createCreateDefaultDataFunction(appPath: Path): Promise<void> {
        await FsUtilities.createFile(getPath(appPath, 'src', 'create-default-data.function.ts'), [
            'import { DataSourceInterface, inject, Newable, PasswordCredentials, PasswordCredentialsCreateData, Repository, repositoryTokenFor, Transaction } from \'zibri\';',
            '',
            'import { logger } from \'.\';',
            IMPORT_REQUIRE_ENV,
            'import { Roles, User } from \'./models\';',
            'import { UserRepository } from \'./repositories\';',
            '',
            'export async function createDefaultData(dataSourceClass: Newable<DataSourceInterface>): Promise<void> {',
            '    const dataSource: DataSourceInterface = inject(dataSourceClass);',
            '    logger.info(\'Creates default data if missing\');',
            '',
            '    await createDefaultAdmin(dataSource);',
            '    logger.info(\'Finished creating default data\');',
            '}',
            '',
            'async function createDefaultAdmin(dataSource: DataSourceInterface): Promise<void> {',
            '    const userRepository: UserRepository = inject(UserRepository);',
            '    const credentialsRepository: Repository<PasswordCredentials, PasswordCredentialsCreateData>',
            '        = inject(repositoryTokenFor(PasswordCredentials));',
            '',
            '    const email: string = requireEnv(\'DEFAULT_ADMIN_EMAIL\');',
            '',
            '    const defaultUser: User | undefined = await userRepository.findOne({ where: { email }, required: false });',
            '    if (defaultUser) {',
            '        return;',
            '    }',
            '',
            '    logger.info(\'  - default admin\');',
            '    const transaction: Transaction = await dataSource.startTransaction();',
            '    try {',
            '        const user: User = await userRepository.create({ name: \'root\', email, roles: [Roles.ADMIN] }, { transaction });',
            '        await credentialsRepository.create(',
            '            { password: requireEnv(\'DEFAULT_ADMIN_PASSWORD\'), userId: user.id },',
            '            { transaction }',
            '        );',
            '        await transaction.commit();',
            '    }',
            '    catch (error) {',
            '        await transaction.rollback();',
            '        throw error;',
            '    }',
            '}'
        ]);
    }

    private async createIndexTs(appPath: Path): Promise<void> {
        await FsUtilities.createFile(getPath(appPath, 'src', 'index.ts'), [
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

    private async createApplicationOptions(appPath: Path, configuration: NewConfiguration): Promise<void> {
        await FsUtilities.createFile(getPath(appPath, 'src', 'application-options.base.ts'), [
            'import { MailingListController, OmitStrict, SemVerUtilities, ZibriApplicationOptions, ZibriMailingListPlugin } from \'zibri\';',
            '',
            'import { AppAuthController, HealthController, PageController } from \'./controllers\';',
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
            '    plugins: [new ZibriMailingListPlugin()],',
            '    controllers: [HealthController, PageController, MailingListController, AppAuthController],',
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
            '    providers',
            '};'
        ]);
        await FsUtilities.createFile(getPath(appPath, 'src', 'application-options.ts'), [
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
        await FsUtilities.createFile(getPath(appPath, 'src', TESTING_DIR, 'test-application-options.ts'), [
            'import { ZibriApplicationOptions } from \'zibri\';',
            'import { createInMemoryDataSource, defaultTestProviders } from \'zibri-testing\';',
            '',
            'import { baseApplicationOptions } from \'../application-options.base\';',
            `import { entities } from '../${DATA_SOURCES_DIR}/db/entities';`,
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
            '    dataSources: [createInMemoryDataSource({ entities })],',
            '    providers: [...baseApplicationOptions.providers ?? [], ...defaultTestProviders]',
            '};'
        ]);
        await FsUtilities.createFile(getPath(appPath, 'src', TESTING_DIR, 'home-page.test.ts'), [
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
        await FsUtilities.createFile(getPath(appPath, '.gitignore'), [
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
        await FsUtilities.createFile(getPath(appPath, '.dockerignore'), [
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
        await FsUtilities.createFile(getPath(appPath, 'Dockerfile'), [
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
            'COPY --from=build --chown=node:node /app/package.json ./package.json',
            'COPY --from=build --chown=node:node /app/node_modules ./node_modules',
            '',
            '# the bundle carries everything read from inside it: the assets, the compiled templates and',
            '# the translations. "versions" is the one thing read from beside it, because the application',
            '# writes to it and the next release is checked against what this one recorded. An image',
            '# without it does not start, which is the point: an application that quietly treated the',
            '# version it is on as the first one that ever existed would drop every guarantee it gives.',
            'COPY --from=build --chown=node:node /app/dist ./dist',
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
        await FsUtilities.createFile(getPath(appPath, '.github', 'workflows', 'ci.yml'), [
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

        await FsUtilities.createFile(getPath(appPath, '.env.example'), example);
        await FsUtilities.createFile(getPath(appPath, '.env'), actual);
    }

    private async createEnvTs(appPath: Path): Promise<void> {
        await FsUtilities.createFile(getPath(appPath, 'src', 'env.ts'), [
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
        await FsUtilities.createFile(getPath(appPath, 'jest.config.mjs'), [
            '/** @type {import(\'ts-jest\').JestConfigWithTsJest} **/',
            'const config = {',
            '    testEnvironment: \'node\',',
            '    rootDir: \'src\',',
            '    transform: {',
            '        // the templates are compiled by zibri-tsx, as the zibri-tsx/webpack loader does for the build',
            '        \'^.+[\\\\/]src[\\\\/]templates[\\\\/].+\\\\.tsx$\': \'zibri-tsx/jest\',',
            '        // commonjs, which is what jest runs a test in. ts-jest compiles to it either way, and says so',
            '        // for every file when the tsconfig names nodenext instead',
            '        \'^.+.tsx?$\': [\'ts-jest\', { tsconfig: { module: \'commonjs\' } }],',
            '        // jose ships as es modules only, which jest cannot require. The default auth strategy loads it',
            '        // as the application starts, so it is compiled to commonjs like the sources',
            '        \'/node_modules/jose/.+\\\\.js$\': [\'ts-jest\', { tsconfig: { allowJs: true, module: \'commonjs\' } }]',
            '    },',
            '    transformIgnorePatterns: [\'/node_modules/(?!jose/)\'],',
            '    // a package a template imports with ?client is the package itself on the server, which is how',
            '    // the NormalModuleReplacementPlugin in webpack.config.js resolves it for the build',
            '    moduleNameMapper: {',
            '        \'^(.+)\\\\?client$\': \'$1\'',
            '    }',
            '};',
            '',
            'export default config;'
        ]);
    }

    private async createModels(appPath: Path): Promise<void> {
        await FsUtilities.createFile(getPath(appPath, 'src', 'models', 'index.ts'), [
            'export * from \'./user.model\';',
            'export * from \'./membership.model\';',
            'export * from \'./roles.enum\';'
        ]);
        await FsUtilities.createFile(getPath(appPath, 'src', 'models', 'membership.model.ts'), [
            'import { BaseMembershipEntity, Entity } from \'zibri\';',
            '',
            'import { Roles } from \'./roles.enum\';',
            '',
            '// one membership per user in each tenant',
            '@Entity({ uniques: [[\'userId\']] })',
            'export class Membership extends BaseMembershipEntity(Roles) {}'
        ]);
        await FsUtilities.createFile(getPath(appPath, 'src', 'models', 'generated', 'providers.ts'), [
            'import { EntityGenerationProvider } from \'zibri\';',
            '',
            'export const providers: EntityGenerationProvider[] = [];'
        ]);
        await FsUtilities.createFile(getPath(appPath, 'src', 'models', 'roles.enum.ts'), [
            'export enum Roles {',
            '    USER = \'user\',',
            '    ADMIN = \'admin\'',
            '}'
        ]);
        await FsUtilities.createFile(getPath(appPath, 'src', 'models', 'user.model.ts'), [
            'import { BaseUserEntity, Entity, IntersectionClass, OmitClass, PasswordCredentials, Property } from \'zibri\';',
            '',
            'import { Roles } from \'./roles.enum\';',
            '',
            '// \'shared\' because one user can be member in multiple tenants',
            '@Entity({ tenant: \'shared\' })',
            'export class User extends BaseUserEntity(Roles) {',
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
        await FsUtilities.createFile(getPath(appPath, 'src', 'repositories', 'index.ts'), [
            'export * from \'./user.repository\';',
            'export * from \'./membership.repository\';'
        ]);
        await FsUtilities.createFile(getPath(appPath, 'src', 'repositories', 'membership.repository.ts'), [
            'import { getDefaultBeforeReturnHook, getDefaultBeforeSaveHook, Inject, InjectRepository, LoggerInterface, MembershipRepo, MembershipRepositoryInterface, Repository, Transaction, ZIBRI_DI_TOKENS } from \'zibri\';',
            '',
            'import { Membership, Roles } from \'../models\';',
            '',
            '@MembershipRepo()',
            'export class MembershipRepository extends Repository<Membership>',
            '    implements MembershipRepositoryInterface<Roles, Membership> {',
            '',
            '    constructor(',
            '        @InjectRepository(Membership)',
            '        repo: Repository<Membership>,',
            '        @Inject(ZIBRI_DI_TOKENS.LOGGER)',
            '        logger: LoggerInterface',
            '    ) {',
            '        super(Membership, repo, logger, repo.dataSource, getDefaultBeforeSaveHook(), getDefaultBeforeReturnHook());',
            '    }',
            '',
            '    async findMembership(userId: string): Promise<Membership | undefined> {',
            '        return await this.findOne({ where: { userId }, required: false });',
            '    }',
            '',
            '    async findMemberships(userId: string): Promise<Membership[]> {',
            '        return await this.findAll({ where: { userId }, acrossTenants: true });',
            '    }',
            '',
            '    async resolveMembership(userId: string, transaction: Transaction | undefined): Promise<Membership> {',
            '        return await this.findOne({ where: { userId }, transaction, required: false })',
            '            ?? await this.create({ userId, roles: [] }, { transaction });',
            '    }',
            '',
            '    async updateDeactivatedAt(userId: string, deactivatedAt: Date | null, transaction: Transaction | undefined): Promise<void> {',
            '        await this.updateAll({ userId }, { deactivatedAt }, { transaction });',
            '    }',
            '',
            '    async deleteMembership(userId: string, transaction: Transaction | undefined): Promise<void> {',
            '        await this.deleteAll({ userId }, { transaction });',
            '    }',
            '',
            '    async deleteMemberships(userIds: string[], transaction: Transaction): Promise<void> {',
            '        await this.deleteAll({ userId: { oneOf: userIds } }, { transaction, acrossTenants: true });',
            '    }',
            '}'
        ]);
        await FsUtilities.createFile(getPath(appPath, 'src', 'repositories', 'user.repository.ts'), [
            'import { getDefaultBeforeReturnHook, getDefaultBeforeSaveHook, Inject, InjectRepository, LoggerInterface, Repository, Transaction, UserRepo, UserRepositoryInterface, ZIBRI_DI_TOKENS } from \'zibri\';',
            '',
            'import { Roles, User, UserCreateData } from \'../models\';',
            '',
            '@UserRepo()',
            'export class UserRepository extends Repository<User, UserCreateData>',
            '    implements UserRepositoryInterface<Roles, User> {',
            '',
            '    constructor(',
            '        @InjectRepository(User)',
            '        repo: Repository<User>,',
            '        @Inject(ZIBRI_DI_TOKENS.LOGGER)',
            '        logger: LoggerInterface',
            '    ) {',
            '        super(User, repo, logger, repo.dataSource, getDefaultBeforeSaveHook(), getDefaultBeforeReturnHook());',
            '    }',
            '',
            '    async findByEmail(email: string): Promise<User> {',
            '        return await this.findOne({ where: { email } });',
            '    }',
            '',
            '    async updateDeactivatedAt(id: string, deactivatedAt: Date | null, transaction: Transaction | undefined): Promise<void> {',
            '        await this.updateById(id, { deactivatedAt }, { transaction });',
            '    }',
            '}'
        ]);
    }

    private async createDataSource(appPath: Path): Promise<void> {
        await FsUtilities.createFile(getPath(appPath, 'src', DATA_SOURCES_DIR, 'db', 'db.data-source.ts'), [
            'import { BaseEntity, DataSource, Newable, OmitStrict, PostgresDataSource, PostgresOptions, SchemaManagement } from \'zibri\';',
            '',
            'import { entities } from \'./entities\';',
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
            '}'
        ]);
        await FsUtilities.createFile(getPath(appPath, 'src', DATA_SOURCES_DIR, 'db', 'entities.ts'), [
            'import { BaseEntity, BackupEntity, BackupResourceEntity, CacheInvalidation, Change, ChangeSet, CronJobEntity, Email, EncryptionKey, EncryptionRotationFailure, EncryptionRotationProgress, EncryptionStrategyEntity, Event, EventSubscriberRegistration, EventSubscriberRun, HashStrategyEntity, JwtRefreshToken, Lease, Log, MailingList, MailingListSubscriber, MailingListSubscriptionConfirmationToken, MigrationEntity, Newable, OtpCredentials, PasswordCredentials, PasswordResetToken, ThreadJobEntity, TwoFactorFailureStreak, WebsocketChannel, WebsocketMessage, WebsocketMessageSequence } from \'zibri\';',
            '',
            'import { Membership, User } from \'../../models\';',
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
            '    JwtRefreshToken,',
            '    PasswordCredentials,',
            '    PasswordResetToken,',
            '    MailingList,',
            '    MailingListSubscriber,',
            '    MailingListSubscriptionConfirmationToken,',
            '    Log,',
            '    Change,',
            '    ChangeSet,',
            '    OtpCredentials,',
            '    TwoFactorFailureStreak,',
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
        await FsUtilities.createFile(
            getPath(appPath, 'src', DATA_SOURCES_DIR, 'db', 'migrations', 'index.ts'), ''
        );
        await FsUtilities.createFile(getPath(appPath, 'src', DATA_SOURCES_DIR, 'db', 'index.ts'), 'export * from \'./db.data-source\';');
        await FsUtilities.createFile(getPath(appPath, 'src', DATA_SOURCES_DIR, 'index.ts'), 'export * from \'./db\';');
    }

    private async createWebpackConfig(appPath: Path): Promise<void> {
        await FsUtilities.createFile(getPath(appPath, 'webpack.config.js'), [
            'const path = require(\'path\');',
            'const { spawn } = require(\'child_process\');',
            'const CopyPlugin = require(\'copy-webpack-plugin\');',
            'const { generateHandlebarTypeFiles, generateEntityFiles, generateSourceXlf, resolveZibriRoot } = require(\'zibri\');',
            'const { ZibriTsxVendorPlugin } = require(\'zibri-tsx/webpack\');',
            'const MiniCssExtractPlugin = require(\'mini-css-extract-plugin\');',
            'const { NormalModuleReplacementPlugin } = require(\'webpack\');',
            '',
            '/**',
            ' * The template directories that are compiled by zibri-tsx: pages, components, and',
            ' * the emails and their components too.',
            ' */',
            'const tsxTemplateDirs = [',
            '    path.resolve(__dirname, \'src\', \'templates\', \'pages\'),',
            '    path.resolve(__dirname, \'src\', \'templates\', \'components\'),',
            '    path.resolve(__dirname, \'src\', \'templates\', \'emails\'),',
            '    path.resolve(__dirname, \'src\', \'templates\', \'email-components\')',
            '];',
            '',
            'class OnBuildSuccessPlugin {',
            // eslint-disable-next-line sonarjs/no-duplicate-string
            '    /** @type {import(\'webpack\').WebpackPluginFunction } */',
            // eslint-disable-next-line sonarjs/no-duplicate-string
            '    apply(compiler) {',
            '        compiler.hooks.done.tap(\'OnBuildSuccessPlugin\', stats => {',
            '            if (stats.hasErrors() || compiler.watchMode === false) {',
            '                return;',
            '            }',
            '',
            '            if (this.serverProcess) {',
            '                this.serverProcess.kill();',
            '            }',
            '            this.serverProcess = spawn(\'node\', [\'--enable-source-maps\', \'dist/bundle.js\'], {',
            '                stdio: \'inherit\',',
            '                shell: true',
            '            });',
            '        });',
            '    }',
            '}',
            '',
            'class HandlebarsTypegenPlugin {',
            '    /** @type {import(\'webpack\').WebpackPluginFunction } */',
            '    apply(compiler) {',

            '        compiler.hooks.beforeCompile.tapPromise(',
            '            \'HandlebarsTypegenPlugin\',',
            '            () => generateHandlebarTypeFiles()',
            '        );',
            '    }',
            '}',
            '',
            'class EntityGenerationPlugin {',
            '    /** @type {import(\'webpack\').WebpackPluginFunction } */',
            '    apply(compiler) {',
            '        compiler.hooks.beforeCompile.tapPromise(',
            '            \'EntityGenerationPlugin\',',
            '            () => generateEntityFiles()',
            '        );',
            '    }',
            '}',
            '',
            'class LocalizationPlugin {',
            '    /** @type {import(\'webpack\').WebpackPluginFunction } */',
            '    apply(compiler) {',
            '        compiler.hooks.beforeCompile.tapPromise(\'LocalizationPlugin\', async () => {',
            '            const frameworkSrc = path.join(resolveZibriRoot(), \'src\');',
            '            const projectSrc = path.resolve(compiler.context, \'src\');',
            '            await generateSourceXlf([',
            '                {',
            '                    origin: \'zibri\',',
            '                    originLocale: \'en-US\',',
            '                    patterns: { include: `${frameworkSrc}/**/*.{ts,tsx}`, exclude: \'**/*.test.{ts,tsx}\' }',
            '                },',
            '                {',
            '                    origin: \'project\',',
            '                    originLocale: \'en-US\',',
            '                    patterns: { include: `${projectSrc}/**/*.{ts,tsx}`, exclude: \'**/*.test.{ts,tsx}\' }',
            '                }',
            '            ]);',
            '        });',
            '    }',
            '}',
            '',
            '/** @type {import(\'webpack\').Configuration} */',
            // eslint-disable-next-line sonarjs/no-duplicate-string
            'module.exports = {',
            '    target: \'node\',',
            // Both warnings come from zibri's own dependencies (typeorm's dynamic requires and
            // handlebars' require.extensions) and cannot be acted on from inside a generated app.
            '    ignoreWarnings: [',
            '        (warning) => {',
            '            if (',
            '                warning.message.includes(\'Critical dependency: the request of a dependency is an expression\')',
            '                || warning.message.includes(\'require.extensions is not supported by webpack.\')',
            '            ) {',
            '                return true;',
            '            }',
            '            return false;',
            '        }',
            '    ],',
            '    mode: \'none\',',
            '    entry: {',
            '        bundle: \'./src/index.ts\',',
            '        style: \'./assets/public/style.css\'',
            '    },',
            '    output: {',
            '        path: path.resolve(__dirname, \'dist\'),',
            '        filename: \'[name].js\',',
            '        devtoolModuleFilenameTemplate: info => {',
            '            // info.resourcePath is the original filename (e.g. \'./src/controllers/test.controller.ts\')',
            '            // We strip leading \'./\' and make it absolute for editors to link',
            '            const relPath = info.resourcePath.replace(/^\\.\\//, \'\');',
            '            return `file://${path.resolve(process.cwd(), relPath).replace(/\\\\/g, \'/\')}`;',
            '        },',
            '        clean: true',
            '    },',
            '    devtool: \'source-map\',',
            '    externals: {',
            '        pdfmake: \'commonjs2 pdfmake\',',
            '        pdfkit: \'commonjs2 pdfkit\',',
            '        \'@foliojs-fork/fontkit\': \'commonjs2 @foliojs-fork/fontkit\',',
            '        \'@foliojs-fork/linebreak\': \'commonjs2 @foliojs-fork/linebreak\',',
            '        \'osx-temperature-sensor\': \'commonjs2 osx-temperature-sensor\',',
            '        \'pg-native\': \'commonjs2 pg-native\',',
            '        \'cloudflare:sockets\': \'commonjs2 cloudflare:sockets\',',
            '        \'react-native-sqlite-storage\': \'commonjs2 react-native-sqlite-storage\',',
            '        \'@google-cloud\\/spanner\': \'commonjs2 @google-cloud\\/spanner\',',
            '        mssql: \'commonjs2 mssql\',',
            '        \'sql.js\': \'commonjs2 sql.js\',',
            '        redis: \'commonjs2 redis\',',
            '        \'pg-query-stream\': \'commonjs2 pg-query-stream\',',
            '        \'typeorm-aurora-data-api-driver\': \'commonjs2 typeorm-aurora-data-api-driver\',',
            '        oracledb: \'commonjs2 oracledb\',',
            '        mysql: \'commonjs2 mysql\',',
            '        \'hdb-pool\': \'commonjs2 hdb-pool\',',
            '        \'better-sqlite3\': \'commonjs2 better-sqlite3\',',
            '        sqlite3: \'commonjs2 sqlite3\',',
            '        ioredis: \'commonjs2 ioredis\',',
            '        mysql2: \'commonjs2 mysql2\',',
            '        mongodb: \'commonjs2 mongodb\',',
            '        \'@sap\\/hana-client\': \'commonjs2 @sap\\/hana-client\',',
            '        \'@sap\\/hana-client\\/extension\\/Stream\': \'commonjs2 @sap\\/hana-client\\/extension\\/Stream\',',
            '        \'ts-node\': \'commonjs2 ts-node\',',
            '        \'utf-8-validate\': \'commonjs2 utf-8-validate\',',
            '        bufferutil: \'commonjs2 bufferutil\',',
            '        \'macos-temperature-sensor\': \'commonjs2 macos-temperature-sensor\',',
            '        express: \'commonjs2 express\',',
            '        typeorm: \'commonjs2 typeorm\',',
            '        handlebars: \'commonjs2 handlebars\'',
            '    },',
            '    resolve: {',
            '        extensions: [\'.ts\', \'.tsx\', \'.js\', \'.css\']',
            '    },',
            '    module: {',
            '        rules: [',
            '            {',
            '                test: /\\.tsx$/,',
            '                include: tsxTemplateDirs,',
            '                use: \'zibri-tsx/webpack\'',
            '            },',
            '            {',
            '                test: /\\.tsx?$/,',
            '                exclude: tsxTemplateDirs,',
            '                loader: \'ts-loader\',',
            // without it ts-loader compiles everything the tsconfig includes, tests too, and a type
            // error in a test then fails the build and keeps "start" from restarting the server
            '                options: { onlyCompileBundledFiles: true }',
            '            },',
            '            {',
            '                test: /\\.js$/,',
            '                enforce: \'pre\',',
            '                use: \'source-map-loader\',',
            '                exclude: [',
            '                    /node_modules[\\/\\\\]node-cron/,',
            // cspell:disable-next-line
            '                    /node_modules\\/@jridgewell/',
            '                ]',
            '            },',
            '            {',
            '                test: /\\.hbs$/,',
            '                use: [',
            '                    {',
            '                        loader: \'handlebars-loader\',',
            '                        options: {',
            '                            runtime: \'handlebars/runtime\',',
            '                            knownHelpersOnly: false',
            '                        }',
            '                    }',
            '                ]',
            '            },',
            '            {',
            '                test: /\\.css$/,',
            '                use: [',
            '                    MiniCssExtractPlugin.loader,',
            '                    {',
            '                        loader: \'css-loader\',',
            '                        options: {',
            '                            importLoaders: 1,',
            '                            esModule: false',
            '                        }',
            '                    },',
            '                    \'postcss-loader\'',
            '                ]',
            '            }',
            '        ]',
            '    },',
            '    plugins: [',
            '        new HandlebarsTypegenPlugin(),',
            '        new ZibriTsxVendorPlugin({',
            '            templateDirs: tsxTemplateDirs,',
            '            outDir: path.resolve(__dirname, \'assets\', \'public\', \'vendor\'),',
            '            resolveFrom: __dirname',
            '        }),',
            '        new EntityGenerationPlugin(),',
            '        new LocalizationPlugin(),',
            '        new OnBuildSuccessPlugin(),',
            '        new MiniCssExtractPlugin({ filename: \'assets/public/style.css\' }),',
            '        new NormalModuleReplacementPlugin(',
            '            /^([^?]+)\\?client$/,',
            '            (resource) => resource.request = resource.request.replace(/\\?client$/, \'\')',
            '        ),',
            '        new CopyPlugin({',
            '            patterns: [',
            '                {',
            '                    from: path.resolve(__dirname, \'assets\'),',
            '                    to: path.resolve(__dirname, \'dist\', \'assets\')',
            '                },',
            '                {',
            '                    from: path.resolve(__dirname, \'src\', \'templates\'),',
            '                    to: path.resolve(__dirname, \'dist\', \'assets\', \'templates\')',
            '                },',
            // everything copied here is read back from inside the bundle. "versions" is not copied
            // because it is the one thing that is not read from there: the application writes to it
            // and the next release reads what this one wrote, so it lives beside "dist" and travels
            // with a deployment on its own. It could not live inside "dist" either way - "clean"
            // empties that folder on every build, so a snapshot written there would not survive one.
            '                {',
            '                    from: path.resolve(__dirname, \'translations\'),',
            '                    to: path.resolve(__dirname, \'dist\', \'translations\')',
            '                }',
            '            ]',
            '        })',
            '    ]',
            '};'
        ]);
    }

    private async createTsConfig(appPath: Path): Promise<void> {
        await FsUtilities.createFile(getPath(appPath, 'tsconfig.json'), [
            '{',
            '    "compilerOptions": {',
            '        "emitDecoratorMetadata": true,',
            '        "esModuleInterop": true,',
            '        "experimentalDecorators": true,',
            '        "jsx": "react-jsx",',
            '        "jsxImportSource": "zibri-tsx",',
            '        "module": "NodeNext",',
            '        "moduleResolution": "NodeNext",',
            '        "outDir": "dist",',
            '        "resolveJsonModule": true,',
            '        "skipLibCheck": true,',
            '        "sourceMap": true,',
            '        "strict": true,',
            '        "target": "ES2022"',
            '    },',
            '    "include": ["src"]',
            '}'
        ]);
    }

    private async createPostCssConfig(appPath: Path): Promise<void> {
        await FsUtilities.createFile(getPath(appPath, 'postcss.config.js'), [
            'module.exports = {',
            '    plugins: {',
            '        tailwindcss: {},',
            '        autoprefixer: {}',
            '    }',
            '};'
        ]);
    }

    private async createTailwindConfig(appPath: Path): Promise<void> {
        await FsUtilities.createFile(getPath(appPath, 'tailwind.config.js'), [
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
            '            elevation: \'0px 5px 5px -3px rgba(0,0,0,0.2), 0px 8px 10px 1px rgba(0,0,0,0.14), 0px 3px 14px 2px rgba(0,0,0,0.12)\'',
            '        }',
            '    },',
            '    plugins: []',
            '};'
        ]);
    }

    private async createTsxDts(appPath: Path): Promise<void> {
        await FsUtilities.createFile(getPath(appPath, 'src', 'tsx.d.ts'), [
            'declare module \'chart.js?client\' {',
            '    export * from \'chart.js\';',
            '}'
        ]);
    }

    // `zi new [name] [ci] [defaultAuth]`: what the command line leaves out is asked for, in that order
    protected override async resolveInput(args: string[]): Promise<NewConfiguration> {
        const [, name, ci, defaultAuth]: (string | undefined)[] = args;
        return {
            name: name
                ?? (await InquirerUtilities.prompt<Pick<NewConfiguration, 'name'>>({ name: newConfigurationQuestions.name })).name,
            ci: ci == undefined
                ? (await InquirerUtilities.prompt<Pick<NewConfiguration, 'ci'>>({ ci: newConfigurationQuestions.ci })).ci
                : await resolveContinuousIntegration(ci),
            defaultAuth: defaultAuth == undefined
                ? (await InquirerUtilities.prompt<Pick<NewConfiguration, 'defaultAuth'>>({
                    defaultAuth: newConfigurationQuestions.defaultAuth
                })).defaultAuth
                : await resolveDefaultAuth(defaultAuth)
        };
    }
}