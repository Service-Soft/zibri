import { AuthControllerClass } from './auth-controller-class.type';
import { AuthControllerStrategyClass } from './auth-controller-strategy-class.type';
import { isAuthControllerClass } from './is-auth-controller-class.function';
import { ZibriApplication } from '../../application/application';
import { Transaction } from '../../data-source/transaction/transaction.model';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { MimeType } from '../../http/mime-type.enum';
import { $ts } from '../../localization/translate.function';
import { JsonBodyMetadata, XmlBodyMetadata } from '../../routing/decorators/body-metadata.model';
import { resolveStructuredBodyMetadata } from '../../routing/resolve-body-metadata.function';
import { Newable } from '../../types/newable.type';
import { type AuthServiceInterface } from '../auth-service.interface';
import { isAuthControllerAuthenticator } from '../authenticators/auth-controller-authenticator.interface';
import { isConnectingAuthenticator } from '../authenticators/connecting-authenticator.interface';
import { isConnectionCompletingAuthenticator } from '../authenticators/connection-completing-authenticator.interface';
import { isFederatedAuthenticator } from '../authenticators/federated/federated-authenticator.interface';
import { isSignInOptionsAuthenticator } from '../authenticators/sign-in-options-authenticator.interface';
import { isSignUpAuthenticator } from '../authenticators/sign-up-authenticator.interface';
import { isAuthControllerStrategy } from '../strategies/auth-controller-strategy.interface';

/**
 * The routes of `AuthController` that read more than a login from an authenticator.
 */
const ROUTE_CAPABILITIES: RouteCapability[] = [
    { route: 'login', member: 'authenticate', isCapable: isAuthControllerAuthenticator, implement: 'AuthControllerAuthenticatorInterface' },
    {
        route: 'signInOptions',
        member: 'resolveSignInOptions',
        isCapable: isSignInOptionsAuthenticator,
        implement: 'SignInOptionsAuthenticatorInterface'
    },
    { route: 'register', member: 'completeSignUp', isCapable: isSignUpAuthenticator, implement: 'SignUpAuthenticatorInterface' },
    { route: 'authorize', member: 'completeSignIn', isCapable: isFederatedAuthenticator, implement: 'FederatedAuthenticatorInterface' },
    {
        route: 'startConnection',
        member: 'startConnection',
        isCapable: isConnectingAuthenticator,
        implement: 'ConnectingAuthenticatorInterface'
    },
    {
        route: 'completeConnection',
        member: 'completeConnection',
        isCapable: isConnectionCompletingAuthenticator,
        implement: 'ConnectionCompletingAuthenticatorInterface'
    }
];

/**
 * What the routes of `AuthController` share.
 */
export abstract class AuthControllerUtilities {
    /**
     * Finds the one of the given classes a request names by the `name` of its instance.
     * @param classes - The classes the route serves.
     * @param name - The name the request sent, if any.
     * @param parameter - The query parameter the name is sent in, for the answer when it is wrong.
     * @returns The class.
     * @throws BadRequestError when the request names none of them, or names none while there is a choice.
     */
    static resolveNamed<ClassType extends Newable<{
        /**
         * The name a request names the instance by.
         */
        readonly name: string
    }>>(
        classes: ClassType[],
        name: string | undefined,
        parameter: string
    ): ClassType {
        if (name == undefined) {
            const only: ClassType | undefined = classes.length === 1 ? classes[0] : undefined;
            if (only == undefined) {
                throw new BadRequestError($ts`Name one of ${this.resolveNames(classes).join(', ')} in "${parameter}".`);
            }
            return only;
        }
        const found: ClassType | undefined = classes.find(c => inject(c).name === name);
        if (found == undefined) {
            throw new BadRequestError($ts`"${name}" is none of ${this.resolveNames(classes).join(', ')}.`);
        }
        return found;
    }

    /**
     * Finds the one of the given classes a request names, among those whose instance has a capability.
     * @param classes - The classes the route serves.
     * @param name - The name the request sent, if any.
     * @param parameter - The query parameter the name is sent in, for the answer when it is wrong.
     * @param isCapable - Whether an instance has the capability.
     * @returns The class.
     * @throws BadRequestError when the request names none of them, or names none while there is a choice.
     */
    static resolveCapable<Capable extends {
        /**
         * The name a request names the instance by.
         */
        readonly name: string
    }>(
        classes: Newable<unknown>[],
        name: string | undefined,
        parameter: string,
        isCapable: (value: unknown) => value is Capable
    ): Newable<Capable> {
        const capable: Newable<Capable>[] = classes.filter((c): c is Newable<Capable> => isCapable(inject(c)));
        return this.resolveNamed(capable, name, parameter);
    }

    /**
     * Checks a body the way a json body of the given model is checked. A route whose body may be one of
     * several models checks it again against the one the request names.
     * @param body - The body.
     * @param model - The model.
     * @throws When the body is not one of the model.
     */
    static async validateBody(body: unknown, model: Newable<unknown>): Promise<void> {
        const metadata: JsonBodyMetadata | XmlBodyMetadata = resolveStructuredBodyMetadata({ type: MimeType.JSON, modelClass: model }, 0);
        await inject(ZIBRI_DI_TOKENS.VALIDATION_SERVICE).validateBody(body, metadata);
    }

    /**
     * Runs something in a transaction of the data source the given strategy keeps its logins in.
     * @param strategy - The strategy.
     * @param run - What runs in it.
     * @returns What it answers with, once the transaction is committed.
     */
    static async runInTransaction<T>(strategy: AuthControllerStrategyClass, run: (transaction: Transaction) => Promise<T>): Promise<T> {
        const transaction: Transaction = await inject(strategy).startTransaction();
        try {
            const result: T = await run(transaction);
            await transaction.commit();
            return result;
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    /**
     * Checks the controller defined by `AuthController` the application declares, if any: that it is
     * the only one, that its options name exactly the strategies that log in, the authenticators and
     * the two factor methods the application registers, and that each class declares what the routes
     * of the controller read from it.
     * @param app - The application that starts.
     * @throws When one of these does not hold.
     */
    static validateControllers(app: ZibriApplication): void {
        const controllers: AuthControllerClass[] = app.options.controllers.filter(isAuthControllerClass);
        if (controllers.length > 1) {
            throw new InternalError([
                `${controllers.map(c => c.name).join(', ')} are all defined by AuthController.`,
                'An application declares one, since a provider sends the browser back to one url.'
            ]);
        }
        const controller: AuthControllerClass | undefined = controllers[0];
        if (controller == undefined) {
            return;
        }
        const { strategies, authenticators, twoFactorMethods } = controller.authControllerOptions;
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        this.validateSameClasses(
            controller,
            'auth strategies that log in',
            strategies,
            authService.strategies.filter(s => isAuthControllerStrategy(inject(s)))
        );
        this.validateSameClasses(
            controller,
            'authenticators',
            authenticators,
            authService.authenticators.filter(a => isAuthControllerAuthenticator(inject(a)))
        );
        this.validateSameClasses(controller, 'two factor methods', twoFactorMethods, app.options.twoFactorMethods);
        for (const { route, member, isCapable, implement } of ROUTE_CAPABILITIES) {
            if (!(route in controller.prototype)) {
                continue;
            }
            const lacking: Newable<unknown> | undefined = authenticators.find(a => this.hasMember([a], member) && !isCapable(inject(a)));
            if (lacking != undefined) {
                throw new InternalError(
                    // eslint-disable-next-line stylistic/max-len
                    `${lacking.name} is given to ${controller.name} for its ${route} route, and does not declare all it reads: implement ${implement}.`
                );
            }
        }
    }

    /**
     * Whether any of the given classes has a member on its prototype, which is where a class keeps its methods.
     * @param classes - The classes.
     * @param key - The member.
     * @returns True when one of them has it.
     */
    static hasMember(classes: Newable<unknown>[], key: string): boolean {
        return classes.some(c => {
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const prototype: object = c.prototype;
            return key in prototype;
        });
    }

    private static resolveNames(classes: Newable<{
        /**
         * The name a request names the instance by.
         */
        readonly name: string
    }>[]): string[] {
        return classes.map(c => `"${inject(c).name}"`);
    }

    private static validateSameClasses(
        controller: AuthControllerClass,
        kind: string,
        given: Newable<unknown>[],
        registered: Newable<unknown>[]
    ): void {
        const missing: Newable<unknown>[] = registered.filter(c => !given.includes(c));
        const extra: Newable<unknown>[] = given.filter(c => !registered.includes(c));
        if (!missing.length && !extra.length) {
            return;
        }
        const names: (classes: Newable<unknown>[]) => string = classes => classes.map(c => c.name).join(', ') || 'none';
        throw new InternalError([
            `${controller.name} is defined by AuthController for the ${kind} ${names(given)},`,
            `and the application registers ${names(registered)}. Name the same ones in both.`
        ]);
    }
}

/**
 * A route of `AuthController` that reads more than a login from an authenticator.
 */
type RouteCapability = {
    /**
     * The route, by its method.
     */
    route: string,
    /**
     * The method of the authenticator that calls for the route.
     */
    member: string,
    /**
     * Whether an instance declares all the route reads.
     */
    isCapable: (value: unknown) => boolean,
    /**
     * The interface that says what that is.
     */
    implement: string
};