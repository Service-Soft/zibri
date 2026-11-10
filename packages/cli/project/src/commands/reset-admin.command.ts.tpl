import { AppCommand, AuthServiceInterface, inject, LoggerInterface, ZIBRI_DI_TOKENS } from 'zibri';

import { requireEnv } from '../env';
import { PlatformRoles, User } from '../models';
import { UserRepository } from '../repositories';

/**
 * Lets the default admin in again: `node dist/bundle.js reset-admin`, or `npm run reset-admin`.
 *
 * For when nobody can administer the application any more: the admin forgot their password, locked
 * their account with wrong ones, lost their second factor, or was deactivated or lost the admin role.
 * The admin logs in with DEFAULT_ADMIN_PASSWORD once and chooses a password of their own, so set it
 * to a fresh one for this run rather than reusing a password that is written down somewhere:
 *
 * DEFAULT_ADMIN_PASSWORD='<a new password>' node dist/bundle.js reset-admin.
 *
 * Every step leaves an account that is already fine as it is, so running it again does no harm.
 */
export const resetAdminCommand: AppCommand = {
    name: 'reset-admin',
    description: 'Lets the default admin in again, with DEFAULT_ADMIN_PASSWORD',
    run: async (): Promise<void> => {
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        const userRepository: UserRepository = inject(UserRepository);
        // read from the environment like everything else, so that no address and no password is ever
        // typed into the code base to get somebody in
        const email: string = requireEnv('DEFAULT_ADMIN_EMAIL');
        const password: string = requireEnv('DEFAULT_ADMIN_PASSWORD');

{{! TODO 4.0: drop the check below, once setPassword is required on AuthServiceInterface }}
        // an auth service of your own provides setPassword to reset the admin
        if (authService.setPassword == undefined) {
            throw new Error('The auth service of this application has no setPassword, which reset-admin sets the password with.');
        }

        const admin: User | undefined = await userRepository.findOne({ where: { email }, required: false });
        if (admin == undefined) {
            throw new Error(`There is no user "${email}". Starting the application creates the default admin.`);
        }

        if (admin.deactivatedAt != undefined) {
            await authService.reactivateUser(admin.id, undefined);
            logger.info('  - reactivated');
        }
        if (!admin.roles.includes(PlatformRoles.ADMIN)) {
            await userRepository.updateById(admin.id, { roles: [...admin.roles, PlatformRoles.ADMIN] });
            logger.info(`  - gave back the role ${PlatformRoles.ADMIN}`);
        }
        // the admin enrolls a second factor again once they are in
        await inject(ZIBRI_DI_TOKENS.TWO_FACTOR_SERVICE).resetSecondFactors(admin);
        // ends every login of the admin too, and lifts a lock of wrong passwords
        await authService.setPassword(admin.id, { password, requireChange: true }, undefined);
        logger.info(`${email} logs in with DEFAULT_ADMIN_PASSWORD once, and chooses a password of their own`);
    }
};
