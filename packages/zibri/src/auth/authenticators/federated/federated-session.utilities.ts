import { FederatedSessionColumns } from './federated-session-columns.model';
import { FederatedSessionMatch } from './federated-session-match.model';
import { FederatedSession } from './federated-session.model';

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
     */
    static toWhere(match: FederatedSessionMatch): Pick<FederatedSessionColumns, 'federatedProvider' | 'federatedSubjectKey'>
        & Partial<Pick<FederatedSessionColumns, 'federatedSessionKey'>> {
        return {
            federatedProvider: match.provider,
            federatedSubjectKey: match.subjectKey,
            ...match.sessionKey == undefined ? {} : { federatedSessionKey: match.sessionKey }
        };
    }
}