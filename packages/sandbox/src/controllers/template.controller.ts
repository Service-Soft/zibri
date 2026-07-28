import { Cached, Controller, errorToLoggedError, Get, HtmlResponse, HttpMethod, Log, LogLevel, Param, Response, TsxUtilities, UUIDUtilities } from 'zibri';

import { StaticPagesCache } from './page.controller';
import { LogEmail } from '../templates/emails/log';
import { PasswordResetEmail } from '../templates/emails/password-reset';
import { SocketIoTestPage } from '../templates/pages/socket-io-test';

@Controller('/templates', { versions: 'all' })
export class TemplateController {

    @Cached(StaticPagesCache, () => StaticPagesCache.getPageKey('socket-io'))
    @Response.html()
    @Get('/socket')
    // eslint-disable-next-line typescript/require-await
    async socketIo(): Promise<HtmlResponse> {
        const html: string = TsxUtilities.renderPage(SocketIoTestPage, { primary: '#0e456f', secondary: '#00b4d8' });
        return HtmlResponse.fromString(html);
    }

    @Cached(StaticPagesCache, () => StaticPagesCache.getPageKey('password-reset-mail'))
    @Response.html()
    @Get('/password-reset-mail')
    // eslint-disable-next-line typescript/require-await
    async getMailTemplate(): Promise<HtmlResponse> {
        const html: string = TsxUtilities.renderEmail(
            PasswordResetEmail,
            {
                confirmPasswordResetLink: 'http://localhost:4200/confirm-password-reset/test-token',
                user: {
                    id: '42',
                    email: 'admin@test.com',
                    name: 'root',
                    roles: []
                }
            }
        );
        return HtmlResponse.fromString(html);
    }

    @Response.html()
    @Get('/log')
    getLog(
        @Param.query('level', { type: 'number', min: LogLevel.DEBUG, max: LogLevel.CRITICAL })
        logLevel: LogLevel
    ): HtmlResponse {
        // eslint-disable-next-line unicorn/error-message
        const line: string = (new Error().stack ?? '').split('\n')[1];
        const matches: RegExpMatchArray | null = line.match(/\((.*):\d+:\d+\)/);
        const origin: string = matches?.[0].split('(')[1].split(')')[0] ?? 'unknown';
        const log: Log = {
            id: UUIDUtilities.generate(),
            createdAt: new Date(),
            cleanupAt: new Date(),
            level: logLevel,
            message: 'test 42',
            context: {
                origin,
                request: {
                    method: HttpMethod.GET,
                    url: 'http://localhost:3000/templates/log',
                    clientIp: '123.456.789.10',
                    userAgent: 'Mozilla/Firefox'
                },
                error: errorToLoggedError(new Error('Something Failed'))
            }
        };

        const html: string = TsxUtilities.renderEmail(LogEmail, { log });
        return HtmlResponse.fromString(html);
    }
}