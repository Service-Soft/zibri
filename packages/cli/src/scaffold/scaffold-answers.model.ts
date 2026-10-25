import { ScaffoldFeature } from './scaffold-feature.model';
import { QuestionsFor } from '../encapsulation';

/**
 * Where a new app's pull requests are built and tested, or `none` for nowhere yet.
 */
export type ContinuousIntegration = 'github' | 'none';

/**
 * Every continuous integration a project can be generated with.
 */
export const CONTINUOUS_INTEGRATIONS: ContinuousIntegration[] = ['github', 'none'];

/**
 * What an endpoint without an `@Auth` decorator requires in the new app.
 */
export type DefaultAuth = 'requireLogin' | 'public';

/**
 * Every default auth a project can be generated with.
 */
export const DEFAULT_AUTHS: DefaultAuth[] = ['requireLogin', 'public'];

/**
 * What a project is generated from: everything `zi new` asks.
 */
export type ScaffoldAnswers = {
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
    defaultAuth: DefaultAuth,
    /**
     * The features the project has, in the order of `SCAFFOLD_FEATURES`. None is a JSON API.
     */
    features: ScaffoldFeature[]
};

/**
 * How each answer is asked for when the command line leaves it out.
 */
export const scaffoldQuestions: QuestionsFor<ScaffoldAnswers> = {
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
    },
    features: {
        name: 'features',
        type: 'checkbox',
        message: 'features (none is a JSON API)',
        // every one checked but the mailing list, which adds public routes and tables of its own
        choices: [
            { name: 'pages: home page, assets explorer, error page', value: 'pages', checked: true },
            { name: 'mailing list: subscriptions, with their pages and email', value: 'mailingList', checked: false },
            { name: 'metrics dashboard: an example page with charts', value: 'metricsDashboard', checked: true },
            { name: 'log email: an example email built from data', value: 'logEmail', checked: true }
        ]
    }
};