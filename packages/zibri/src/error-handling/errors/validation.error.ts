import { BadRequestError } from './bad-request.error';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { LocaleCode } from '../../localization/models/locale-code.model';
import { TranslatedString } from '../../localization/models/translated-string.model';
import { $t, $ts, TranslationToken } from '../../localization/translate.function';
import { ValidationProblem } from '../../validation/validation-problem.model';

// eslint-disable-next-line jsdoc/require-jsdoc
type ValidationErrorType = 'body' | 'path' | 'query' | 'header' | 'websocketRequest';

const startMessage: Record<ValidationErrorType, TranslationToken> = {
    body: $t`Validation failed for request body`,
    path: $t`Validation failed for path parameter`,
    query: $t`Validation failed for query parameter`,
    header: $t`Validation failed for header parameter`,
    websocketRequest: $t`Validation failed for websocket request`
};

/**
 * An error with validation.
 */
export class ValidationError extends BadRequestError {
    constructor(readonly type: ValidationErrorType, paramName: string | undefined, problems: ValidationProblem[], options?: ErrorOptions) {
        const paramNameSuffix: string = paramName ? ` "${paramName}"` : '';
        const ctx: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        const locale: LocaleCode = inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).resolveSupportedLocale(ctx);
        const paragraphs: TranslatedString[] = [`${startMessage[type].getValue(locale)}${paramNameSuffix}` as TranslatedString];
        for (const problem of problems) {
            paragraphs.push(`- ${problem.key}: ${problem.message}` as TranslatedString);
        }
        super(paragraphs, options);
        this.name = 'ValidationError';
        this.title = $ts`Validation Error`;
    }
}