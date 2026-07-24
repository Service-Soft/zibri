/* eslint-disable no-console */
import { version } from '../../../package.json';
import { CPUtilities, FsUtilities, InquirerUtilities, QuestionsFor } from '../../encapsulation';
import { exitWithError, getPath, Path } from '../../utilities';
import { BaseCommand } from '../base-command.model';

/**
 * Configuration for creating a new zibri app.
 */
type NewConfiguration = {
    /**
     * The name of the app to create.
     */
    name: string
};

const newConfigurationQuestions: QuestionsFor<NewConfiguration> = {
    name: {
        name: 'name',
        type: 'input',
        message: 'name',
        validate: (value: string) => !!value
    }
};

const DATA_SOURCES_DIR: string = 'data-sources';

/**
 * Creates a new Zibri application.
 */
export class NewCommand extends BaseCommand<NewConfiguration> {
    protected override maxLength: number | undefined = 2;

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
            '        "build": "webpack"',
            '    }',
            '}'
        ]);
        const devDependencies: string[] = [
            'autoprefixer@^10.4.27',
            'copy-webpack-plugin@^14.0.0',
            'css-loader@^7.1.4',
            'handlebars-loader@^1.7.3',
            'mini-css-extract-plugin@^2.10.0',
            'postcss@^8.5.6',
            'postcss-loader@^8.2.1',
            'source-map-loader@^5.0.0',
            'tailwindcss@3',
            'ts-loader@^9.5.4',
            'typescript@^5.9.3',
            'webpack@^5.105.3',
            'webpack-cli@^6.0.1'
        ];

        await CPUtilities.exec(`cd ${appPath} && npm i -D ${devDependencies.join(' ')}`);
        // ZIBRI_CLI_LOCAL_DEV is only set by this package's own "start"/"clear" scripts, so a
        // published "zi new" install always resolves the real packages from npm.
        // zibri-tsx is installed explicitly (not just as zibri's peer) because the app's
        // webpack.config.js requires 'zibri-tsx/webpack' and its tsconfig uses it as jsxImportSource.
        const zibriDependency: string = process.env['ZIBRI_CLI_LOCAL_DEV']
            ? `file:${getPath(__dirname, '..', '..', '..', '..', 'zibri')}`
            : `zibri@${version}`;
        const zibriTsxDependency: string = process.env['ZIBRI_CLI_LOCAL_DEV']
            ? `file:${getPath(__dirname, '..', '..', '..', '..', 'tsx')}`
            : `zibri-tsx@${version}`;
        await CPUtilities.exec(`cd ${appPath} && npm i ${zibriDependency} ${zibriTsxDependency} chart.js`);

        await this.createTsConfig(appPath);
        await this.createPostCssConfig(appPath);
        await this.createTailwindConfig(appPath);
        await this.createWebpackConfig(appPath);
        await this.createTsxDts(appPath);
        await this.createIndexTs(appPath, configuration);
        await this.createProvidersTs(appPath);
        await this.createCreateDefaultDataFunction(appPath);
        await this.createDataSource(appPath);
        await this.createRepositories(appPath);
        await this.createControllers(appPath);
        await this.createModels(appPath);

        await FsUtilities.copyDirectoryContent(
            getPath(__dirname, '..', '..', '..', 'assets'),
            getPath(appPath, 'assets')
        );
        await FsUtilities.copyDirectoryContent(
            getPath(__dirname, '..', '..', '..', 'templates'),
            getPath(appPath, 'src', 'templates')
        );

        await FsUtilities.createFile(getPath(appPath, 'src', 'controllers', 'index.ts'), 'export * from \'./page.controller\';');
        await FsUtilities.createFile(getPath(appPath, 'src', 'cron', 'index.ts'), '');
        await FsUtilities.createFile(getPath(appPath, 'src', 'services', 'index.ts'), '');
    }

    private async createControllers(appPath: Path): Promise<void> {
        await FsUtilities.createFile(
            getPath(appPath, 'src', 'controllers', 'page.controller.ts'),
            [
                // eslint-disable-next-line stylistic/max-len
                'import { AssetServiceInterface, Cache, Cached, CacheServiceInterface, Controller, Get, GlobalRegistry, HtmlResponse, HttpRequestContext, Inject, inject, InMemoryCacheStore, LoggerInterface, MetricsServiceInterface, Response, TreeNode, TsxUtilities, WebsocketRequestContext, WriteThroughReadThroughCache, ZIBRI_DI_TOKENS, ZIBRI_REQUEST_CONTEXT_TOKENS } from \'zibri\';',
                '',
                'import { AssetsPage } from \'../templates/pages/assets\';',
                'import { HomePage } from \'../templates/pages/home\';',
                '',
                '@Cache()',
                'export class StaticPagesCache extends WriteThroughReadThroughCache<string, HtmlResponse, \'StaticPagesCache\'> {',
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
                '        return ctx?.get(ZIBRI_REQUEST_CONTEXT_TOKENS.CURRENT_LANGUAGE) + page;',
                '    }',
                '}',
                '',
                '@Controller(\'/\')',
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
    }

    private async createProvidersTs(appPath: Path): Promise<void> {
        await FsUtilities.createFile(
            getPath(appPath, 'src', 'providers.ts'),
            [
                // eslint-disable-next-line stylistic/max-len
                'import { AesGcmEncryptionStrategy, defineProvider, DiProvider, EmailConfigInput, ZIBRI_DI_TOKENS, ZIBRI_MAILING_LIST_PLUGIN_DI_TOKENS } from \'zibri\';',
                '',
                'import { MailingListBaseEmail } from \'./templates/email-components/mailing-list-base-email\';',
                'import { MailingListSubscribeConfirmationEmail } from \'./templates/emails/mailing-list-subscribe-confirmation\';',
                'import { PasswordResetEmail } from \'./templates/emails/password-reset\';',
                'import { ErrorPage } from \'./templates/pages/error\';',
                'import { MailingListPreferencesPage } from \'./templates/pages/mailing-list-preferences\';',
                'import { MailingListUnsubscribeConfirmationPage } from \'./templates/pages/mailing-list-unsubscribe-confirmation\';',
                'import { SubscribeSuccessPage } from \'./templates/pages/subscribe-success\';',
                '',
                'export const providers: DiProvider<unknown>[] = [',
                // eslint-disable-next-line sonar/no-duplicate-string
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
                '                value: \'MASTER_KEY_VALUE\'',
                '            }',
                '        }',
                '    }),',
                '    defineProvider({',
                '        token: ZIBRI_DI_TOKENS.PASSWORD_RESET_EMAIL_TEMPLATE,',
                '        useFactory: () => PasswordResetEmail',
                '    }),',
                '    defineProvider({',
                '        token: ZIBRI_DI_TOKENS.JWT_ACCESS_TOKEN_SECRET,',
                '        useFactory: () => \'JWT_ACCESS_TOKEN_SECRET\'',
                '    }),',
                '    defineProvider({',
                '        token: ZIBRI_DI_TOKENS.JWT_REFRESH_TOKEN_SECRET,',
                '        useFactory: () => \'JWT_REFRESH_TOKEN_SECRET\'',
                '    }),',
                '    defineProvider({',
                '        token: ZIBRI_DI_TOKENS.CONFIRM_PASSWORD_RESET_URL,',
                '        useFactory: () => \'http://localhost:4200/confirm-password-reset\'',
                '    }),',
                '    defineProvider({',
                '        token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,',
                '        useFactory: (): EmailConfigInput => {',
                '            return {',
                '                maxEmailsPerHour: 3600,',
                '                defaultSender: \'\',',
                '                host: \'\',',
                '                port: 0,',
                '                auth: {',
                '                    user: \'\',',
                '                    pass: \'\'',
                '                }',
                '            };',
                '        }',
                '    })',
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
                ']'
            ]
        );
    }

    private async createCreateDefaultDataFunction(appPath: Path): Promise<void> {
        await FsUtilities.createFile(getPath(appPath, 'src', 'create-default-data.function.ts'), [
            // eslint-disable-next-line stylistic/max-len
            'import { DataSourceInterface, inject, JwtCredentials, JwtCredentialsCreateData, Newable, Repository, repositoryTokenFor, Transaction } from \'zibri\';',
            '',
            'import { logger } from \'.\';',
            'import { Roles, User } from \'./models\';',
            'import { UserRepository } from \'./repositories\';',
            '',
            'export async function createDefaultData(dataSourceClass: Newable<DataSourceInterface>): Promise<void> {',
            '    const dataSource: DataSourceInterface = inject(dataSourceClass);',
            '    await logger.info(\'Creates default data if missing\');',
            '',
            '    await createDefaultAdmin(dataSource);',
            '    await logger.info(\'Finished creating default data\');',
            '}',
            '',
            'async function createDefaultAdmin(dataSource: DataSourceInterface): Promise<void> {',
            '    const userRepository: UserRepository = inject(UserRepository);',
            // eslint-disable-next-line stylistic/max-len
            '    const credentialsRepository: Repository<JwtCredentials, JwtCredentialsCreateData> = inject(repositoryTokenFor(JwtCredentials));',
            '',
            '    const defaultUser: User | undefined = await userRepository.findOne({ where: { email: \'zibri@zibri.de\' } }, false);',
            '    if (defaultUser) {',
            '        return;',
            '    }',
            '',
            '    await logger.info(\'  - default admin\');',
            '    const transaction: Transaction = await dataSource.startTransaction();',
            '    try {',
            '        const user: User = await userRepository.create({ name: \'root\', email: \'zibri@zibri.de\', roles: [Roles.ADMIN] });',

            '        await credentialsRepository.create({ email: user.email, password: \'password\', userId: user.id });',
            '        await transaction.commit();',
            '    }',
            '    catch (error) {',
            '        await transaction.rollback();',
            '        throw error;',
            '    }',
            '}'
        ]);
    }

    private async createIndexTs(appPath: Path, configuration: NewConfiguration): Promise<void> {
        await FsUtilities.createFile(getPath(appPath, 'src', 'index.ts'), [
            'import H from \'handlebars/runtime\';',
            // eslint-disable-next-line stylistic/max-len
            'import { inject, JwtAuthController, LoggerInterface, MailingListController, SemVerUtilities, ZibriMailingListPlugin, ZIBRI_DI_TOKENS, ZibriApplication } from \'zibri\';',
            '',
            `import { DbDataSource } from './${DATA_SOURCES_DIR}';`,
            'import { version } from \'../package.json\';',
            'import { createDefaultData } from \'./create-default-data.function\';',
            'import { providers } from \'./providers\';',
            'import { PageController } from \'./controllers\';',
            '',
            'export let logger: LoggerInterface;',
            '',
            'async function start(): Promise<void> {',
            '    if (!SemVerUtilities.isSemVerVersion(version)) {',
            '        throw new Error(\'The version of the package.json is not valid.\');',
            '    }',
            '',
            '    const app: ZibriApplication = new ZibriApplication({',
            `        name: '${configuration.name}',`,
            '        version,',
            '        baseUrl: \'http://localhost:3000\',',
            '        plugins: [new ZibriMailingListPlugin()],',
            '        controllers: [PageController, MailingListController, JwtAuthController],',
            '        websocketControllers: [],',
            '        dataSources: [DbDataSource],',
            '        cronJobs: [],',
            '        providers',
            '    });',
            '    await app.init(H);',
            '',
            '    logger = inject(ZIBRI_DI_TOKENS.LOGGER);',
            '',
            '    await createDefaultData(DbDataSource);',
            '',
            '    await app.start(3000);',
            '}',
            '',
            'void start();'
        ]);
    }

    private async createModels(appPath: Path): Promise<void> {
        await FsUtilities.createFile(getPath(appPath, 'src', 'models', 'index.ts'), [
            'export * from \'./user.model\';',
            'export * from \'./roles.enum\';'
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
            'import { BaseUser, Entity, IntersectionClass, JwtCredentials, OmitClass, Property } from \'zibri\';',
            '',
            'import { Roles } from \'./roles.enum\';',
            '',
            '@Entity()',
            'export class User BaseUserEntity(Roles) {',
            '    @Property.string()',
            '    name!: string;',
            '}',
            '',
            'export class UserCreateDto extends IntersectionClass(',
            '    OmitClass(User, [\'id\', \'roles\']),',
            '    OmitClass(JwtCredentials, [\'id\', \'userId\', \'email\'])',
            ') {}',
            '',
            'export type UserCreateData = Omit<User, \'id\'>;'
        ]);
    }

    private async createRepositories(appPath: Path): Promise<void> {
        await FsUtilities.createFile(getPath(appPath, 'src', 'repositories', 'index.ts'), 'export * from \'./user.repository\';');
        await FsUtilities.createFile(getPath(appPath, 'src', 'repositories', 'user.repository.ts'), [
            // eslint-disable-next-line stylistic/max-len
            'import { getDefaultBeforeReturnHook, getDefaultBeforeSaveHook, inject, InjectRepository, JwtCredentials, Repository, repositoryTokenFor, UserRepo, UserRepositoryInterface } from \'zibri\';',
            '',
            'import { Roles, User, UserCreateData } from \'../models\';',
            '',
            '@UserRepo()',
            'export class UserRepository extends Repository<User, UserCreateData>',
            '    implements UserRepositoryInterface<Roles, User, JwtCredentials> {',
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
            '    async resolveCredentialsFor(user: User): Promise<JwtCredentials> {',
            '        const repo: Repository<JwtCredentials> = inject(repositoryTokenFor(JwtCredentials));',
            '        return repo.findOne({ where: { userId: user.id } });',
            '    }',
            '}'
        ]);
    }

    private async createDataSource(appPath: Path): Promise<void> {
        await FsUtilities.createFile(getPath(appPath, 'src', DATA_SOURCES_DIR, 'db', 'db.data-source.ts'), [
            // eslint-disable-next-line stylistic/max-len
            'import { PostgresDataSource, BaseEntity, Change, ChangeSet, DataSource, Event, EventSubscriberRun, Newable, OmitStrict, PostgresOptions, MigrationEntity, MailingList, MailingListSubscriber, MailingListSubscriptionConfirmationToken, JwtRefreshToken, JwtCredentials, Log, PasswordResetToken, Email, CronJobEntity, ThreadJobEntity, WebsocketChannel, WebsocketMessage, OtpCredentials, BackupEntity, BackupResourceEntity, HashStrategyEntity, EncryptionStrategyEntity, EncryptionKey } from \'zibri\';',
            '',
            'import { User } from \'../../models\';',
            '',
            '@DataSource()',
            'export class DbDataSource extends PostgresDataSource {',
            '    options: OmitStrict<PostgresOptions, \'type\' | \'entities\'> = {',
            '        host: \'localhost\',',
            '        port: 5432,',
            '        username: \'postgres\',',
            '        password: \'password\',',
            '        database: \'db\',',
            '        synchronize: true',
            '    };',
            '    entities: Newable<BaseEntity>[] = [',
            '        MigrationEntity,',
            '        User,',
            '        JwtRefreshToken,',
            '        JwtCredentials,',
            '        PasswordResetToken,',
            '        MailingList,',
            '        MailingListSubscriber,',
            '        MailingListSubscriptionConfirmationToken,',
            '        Log,',
            '        Change,',
            '        ChangeSet,',
            '        OtpCredentials,',
            '        BackupEntity,',
            '        BackupResourceEntity,',
            '        Email,',
            '        CronJobEntity,',
            '        ThreadJobEntity,',
            '        WebsocketChannel,',
            '        WebsocketMessage,',
            '        Event,',
            '        EventSubscriberRun,',
            '        HashStrategyEntity,',
            '        EncryptionStrategyEntity,',
            '        EncryptionKey',
            '    ];',
            '}'
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
            'const { generateHandlebarTypeFiles, generateEntityFiles } = require(\'zibri\');',
            'const { ZibriTsxVendorPlugin } = require(\'zibri-tsx/webpack\');',
            'const MiniCssExtractPlugin = require(\'mini-css-extract-plugin\');',
            'const { NormalModuleReplacementPlugin } = require(\'webpack\');',
            '',
            '// Page and component templates are compiled by zibri-tsx. Emails stay on preact.',
            'const tsxTemplateDirs = [',
            '    path.resolve(__dirname, \'src\', \'templates\', \'pages\'),',
            '    path.resolve(__dirname, \'src\', \'templates\', \'components\')',
            '];',
            '',
            'class OnBuildSuccessPlugin {',
            // eslint-disable-next-line sonar/no-duplicate-string
            '    /** @type {import(\'webpack\').WebpackPluginFunction } */',
            // eslint-disable-next-line sonar/no-duplicate-string
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
            '/** @type {import(\'webpack\').Configuration} */',
            // eslint-disable-next-line sonar/no-duplicate-string
            'module.exports = {',
            '    target: \'node\',',
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
            '        \'express\': \'commonjs2 express\',',
            '        \'typeorm\': \'commonjs2 typeorm\',',
            '        \'handlebars\': \'commonjs2 handlebars\'',
            '    },',
            '    resolve: {',
            '        extensions: [\'.ts\', \'.tsx\', \'.js\', \'.css\'],',
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
            '                use: \'ts-loader\'',
            '            },',
            '            {',
            '                test: /\\.js$/,',
            '                enforce: \'pre\',',
            '                use: \'source-map-loader\',',
            '                exclude: [',
            '                    /node_modules[\\/\\\\]node-cron/,',
            '                    /node_modules\\/xmlbuilder2/,',
            // eslint-disable-next-line cspell/spellchecker
            '                    /node_modules\\/@oozcitak/,',
            // eslint-disable-next-line cspell/spellchecker
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
            '        ],',
            '    },',
            '    plugins: [',
            '        new HandlebarsTypegenPlugin(),',
            '        new ZibriTsxVendorPlugin({',
            '            templateDirs: tsxTemplateDirs,',
            '            outDir: path.resolve(__dirname, \'assets\', \'public\', \'vendor\'),',
            '            resolveFrom: __dirname',
            '        }),',
            '        new EntityGenerationPlugin(),',
            '        new OnBuildSuccessPlugin(),',
            '        new MiniCssExtractPlugin({ filename: \'assets/public/style.css\' }),',
            '        new NormalModuleReplacementPlugin(',
            '            /^([^?]+)\?client$/,',
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
            '                {',
            '                    from: path.resolve(__dirname, \'versions\'),',
            '                    to: path.resolve(__dirname, \'dist\', \'versions\')',
            '                }',
            '            ],',
            '        })',
            '    ]',
            '};'
        ]);
    }

    private async createTsConfig(appPath: Path): Promise<void> {
        await FsUtilities.createFile(getPath(appPath, 'tsconfig.json'), [
            '{',
            '    "compilerOptions": {',
            '        "target": "ES2022",',
            '        "module": "NodeNext",',
            '        "moduleResolution": "NodeNext",',
            '        "jsx": "react-jsx",',
            '        "jsxImportSource": "zibri-tsx",',
            '        "outDir": "dist",',
            '        "strict": true,',
            '        "esModuleInterop": true,',
            '        "skipLibCheck": true,',
            '        "experimentalDecorators": true,',
            '        "emitDecoratorMetadata": true,',
            '        "sourceMap": true,',
            '        "resolveJsonModule": true',
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
            // eslint-disable-next-line stylistic/max-len
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

    protected override async resolveInput(args: string[]): Promise<NewConfiguration> {
        if (args.length === 2) {
            return {
                name: args[1]
            };
        }
        return await InquirerUtilities.prompt(newConfigurationQuestions);
    }
}