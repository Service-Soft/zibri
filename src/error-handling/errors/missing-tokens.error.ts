import { DiToken } from '../../di/models/di-token.model';
import { InjectionToken } from '../../di/models/injection-token.model';

/**
 * An error to throw when there are tokens that are not injectable.
 */
export class MissingTokensError extends Error {
    constructor(context: string, tokens: DiToken<unknown>[]) {
        const messages: string[] = [
            `Error initializing ${context}`,
            'Could not inject the following tokens:'
        ];
        for (const token of tokens) {
            messages.push(`  - ${token instanceof InjectionToken ? token.key : token.name}`);
        }
        super(messages.join('\n'));
        this.name = 'MissingTokensError';
    }
}