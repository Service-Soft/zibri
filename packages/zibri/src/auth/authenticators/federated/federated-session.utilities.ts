import { FederatedSessionColumns } from './federated-session-columns.model';
import { FederatedSessionMatch } from './federated-session-match.model';
import { FederatedSession } from './federated-session.model';
import { InternalError } from '../../../error-handling/internal-error.model';

/**
 * What a strategy needs to keep the session at a provider with a login, and to find the login by it.
 */
export abstract class FederatedSessionUtilities {
    /**
     * The columns a login keeps the session in.
     * @param session - The session, or undefined for a login started some other way.
     * @returns The columns, all empty for a login started some other way.
     */
    static toColumns(session: FederatedSession | undefined): FederatedSessionColumns {
        return {
            federatedProvider: session?.provider,
            federatedSubjectKey: session?.subjectKey,
            federatedSessionKey: session?.sessionKey,
            federatedLogout: session?.logout
        };
    }

    /**
     * The session a login kept.
     * @param columns - The columns of the login.
     * @returns The session, or undefined for a login started some other way.
     */
    static fromColumns(columns: FederatedSessionColumns): FederatedSession | undefined {
        if (columns.federatedProvider == undefined || columns.federatedSubjectKey == undefined) {
            return undefined;
        }
        return {
            provider: columns.federatedProvider,
            subjectKey: columns.federatedSubjectKey,
            sessionKey: columns.federatedSessionKey ?? undefined,
            logout: columns.federatedLogout ?? undefined
        };
    }

    /**
     * What the logins a logout at a provider ends are found by.
     * @param match - The person, or one session of theirs.
     * @returns The filter on the columns.
     * @throws {InternalError} When the match names neither the person nor a session.
     */
    static toWhere(match: FederatedSessionMatch): Pick<FederatedSessionColumns, 'federatedProvider'>
        & Partial<Pick<FederatedSessionColumns, 'federatedSubjectKey' | 'federatedSessionKey'>> {
        // a match naming neither would be every login the provider ever started
        if (match.subjectKey == undefined && match.sessionKey == undefined) {
            throw new InternalError(`A logout at ${match.provider} names neither the person nor a session, so it finds no login.`);
        }
        return {
            federatedProvider: match.provider,
            ...match.subjectKey == undefined ? {} : { federatedSubjectKey: match.subjectKey },
            ...match.sessionKey == undefined ? {} : { federatedSessionKey: match.sessionKey }
        };
    }
}