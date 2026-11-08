import { ScaffoldFeature } from './scaffold-feature.model';

/**
 * What a project installs for a part of it: its dependencies and its devDependencies.
 */
export type ScaffoldDependencies = {
    /**
     * What the application runs on.
     */
    dependencies: string[],
    /**
     * What it is built and tested with.
     */
    devDependencies: string[]
};

/**
 * What a generated project installs as devDependencies whatever its features: the build, the tests
 * and the compiler.
 *
 * `zi new` installs all of them, and `zi upgrade` those a project lacks.
 */
export const SCAFFOLD_DEV_DEPENDENCIES: string[] = [
    // the types for the runtime this project targets. Its own code reads process.env and
    // loads a .env, which without these is untyped in a project that compiles with strict on
    '@types/node@^24.0.0',
    'copy-webpack-plugin@^14.0.0',
    'handlebars-loader@^1.7.3',
    'jest@^30.4.2',
    'source-map-loader@^5.0.0',
    'ts-jest@^29.4.11',
    'ts-loader@^9.5.4',
    // the build generates the entities by loading src/models/generated/providers.ts, through ts-node
    'ts-node@^10.9.2',
    'typescript@^5.9.3',
    'webpack@^5.105.3',
    'webpack-cli@^6.0.1'
];

// zibri-tsx is not among them: it is a peer dependency of zibri, so npm resolves it on its own and
// the generated app does not need to declare it.
//
// pg-query-stream is, because it is an *optional* peer dependency and npm therefore installs none of
// them: it is what a postgres data source opens a cursor through, and the generated app has one, so
// it is refused at boot without it. ts-node is not, at runtime: a generated app ships compiled worker
// files, and `multithreading.enableTsWorkerFiles` is off unless an app turns it on. Its build needs it,
// so it is among the devDependencies.
//
// saxes is an optional peer needed by the defaults as well: the xml body parser is one of the
// default body parsers, the translations the generated webpack config extracts on every build are
// read at startup, and both read through it. otpauth is an optional peer needed at boot: an
// application that names no two factor methods is given `OtpTwoFactorMethod`, which asks for otpauth
// as it is constructed. jose is the same for the default auth strategy: an application that names
// none is given `JwtAuthStrategy`, which asks for jose as it is constructed.
//
// The two OpenTelemetry packages are the same story once more. The tracer registered by default
// records through them and validates them at startup, so an application taking the defaults needs
// both; one that registers a tracer of its own drops them with the default it replaced. Its exporter
// package is *not* installed: spans are kept in memory until an application says where to send them,
// and saying so is what makes the exporter needed.
//
// re2 is installed although nothing generated declares a `regex` yet. Declaring one is ordinary
// validation on a string property or parameter, and a project should not be stopped by a missing
// package the first time it does.
//
// The pattern under the optional ones: a peer is optional to the *framework* and not to an
// application that takes the defaults, so the generator installs what its own generated
// configuration reaches for. Turning one of those defaults off is what makes the matching package
// droppable.
/**
 * What a generated project installs as dependencies beside the framework, whatever its features.
 *
 * `zi new` installs all of them, and `zi upgrade` those a project lacks.
 */
export const SCAFFOLD_DEPENDENCIES: string[] = [
    'pg-query-stream@^4.10.3',
    'saxes@^6.0.0',
    'otpauth@^9.5.1',
    'jose@^6.2.12',
    '@opentelemetry/api@^1.9.1',
    '@opentelemetry/sdk-trace-node@^2.11.0',
    're2@^1.27.0',
    'nodemailer@^10.1.0',
    '@prometheus-io/client@^0.16.1',
    '@fastify/busboy@^3.2.3',
    'systeminformation@^5.33.15'
];

/**
 * What each feature installs on top, which `zi add` installs with it and `zi remove` uninstalls.
 */
export const SCAFFOLD_FEATURE_DEPENDENCIES: Record<ScaffoldFeature, ScaffoldDependencies> = {
    // the stylesheet: tailwind run over it, and webpack writing it out beside the bundle
    pages: {
        dependencies: [],
        devDependencies: [
            '@tailwindcss/postcss@4',
            'css-loader@^7.1.4',
            'mini-css-extract-plugin@^2.10.0',
            'postcss@^8.5.6',
            'postcss-loader@^8.2.1',
            'tailwindcss@4'
        ]
    },
    mailingList: { dependencies: [], devDependencies: [] },
    metricsDashboard: { dependencies: ['chart.js'], devDependencies: [] },
    logEmail: { dependencies: [], devDependencies: [] }
};