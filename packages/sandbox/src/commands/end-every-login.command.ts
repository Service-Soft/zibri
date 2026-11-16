import { AppCommand, AuthServiceInterface, inject, LoggerInterface, ZIBRI_DI_TOKENS } from 'zibri';

/**
 * Logs every user out: `node dist/bundle.js end-every-login`, or `npm run end-every-login`.
 *
 * For when the database, a backup or a secret got out. Every user logs in again, and api keys stay.
 * An access token already issued works until it expires, an hour by default, unless
 * ACCESS_TOKEN_REVOCATION is 'immediately'. Replacing JWT_ACCESS_SECRET without keeping the old one
 * takes those away as well.
 */
export const endEveryLoginCommand: AppCommand = {
    name: 'end-every-login',
    description: 'Logs every user out',
    run: async (): Promise<void> => {
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        // an auth service of your own provides endEveryLogin to log everybody out
        if (authService.endEveryLogin == undefined) {
            throw new Error('The auth service of this application has no endEveryLogin, which end-every-login logs everybody out with.');
        }
        await authService.endEveryLogin(undefined);
        logger.info('Ended every login: every user logs in again');
    }
};