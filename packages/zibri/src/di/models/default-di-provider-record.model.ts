import { DiTokenProviderRecord, TokenRecord } from './di-token.model';

/**
 * A record that maps the framework's DI tokens to their default providers.
 */
export type DefaultDiProviderRecord<Tokens extends TokenRecord> = {
    [K in keyof Tokens]: DiTokenProviderRecord<Tokens>[K] & {
        /**
         * When the provider is registered: while the container is built, or only once something
         * injects its token, which builds nothing for a token nobody injects. A provider the
         * application declares for the token wins either way. Defaults to 'immediately'.
         */
        register?: 'immediately' | 'onUse'
    };
};
