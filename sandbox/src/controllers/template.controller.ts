import { Controller, errorToLoggedError, FormatDateFn, Get, GlobalRegistry, HtmlResponse, HttpMethod, inject, Log, LogLevel, Param, Response, UUIDUtilities, ZIBRI_DI_TOKENS } from 'zibri';

import renderBaseEmail from '../templates/emails/base-email.hbs';
import renderLog from '../templates/emails/log.hbs';
import renderPasswordResetTemplate from '../templates/emails/password-reset.hbs';

const logLevelLabels: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: 'Debug Log',
    [LogLevel.INFO]: 'Info Log',
    [LogLevel.WARN]: 'Warning',
    [LogLevel.ERROR]: 'Error',
    [LogLevel.CRITICAL]: 'Critical Error'
};

const bgColorForLogLevel: Record<LogLevel, string> = {
    [LogLevel.DEBUG]: '#00b4d8',
    [LogLevel.INFO]: '#00b4d8',
    [LogLevel.WARN]: '#edff4aff',
    [LogLevel.ERROR]: '#ff5959ff',
    [LogLevel.CRITICAL]: '#cc6cffff'
};

@Controller('/templates')
export class TemplateController {

    @Response.html()
    @Get('/password-reset-mail')
    getMailTemplate(): HtmlResponse {
        const content: string = renderPasswordResetTemplate({
            confirmPasswordResetUrl: 'http://localhost:4200/confirm-password-reset',
            resetToken: 'test-token',
            user: { name: 'Max Mustermann' }
        });
        const html: string = renderBaseEmail({
            content,
            base: {
                title: 'Password Reset',
                baseUrl: 'http://localhost:3000',
                mailingListData: {
                    mailingList: {
                        id: '42'
                    },
                    mailingListBaseRoute: 'mailing-lists',
                    subscriber: {
                        id: '43'
                    }
                }
            }
        });
        return HtmlResponse.fromString(html);
    }

    @Response.html()
    @Get('/log')
    getLog(
        @Param.query('level', { type: 'number', min: LogLevel.DEBUG, max: LogLevel.CRITICAL })
        logLevel: LogLevel
    ): HtmlResponse {
        const formatDate: FormatDateFn = inject(ZIBRI_DI_TOKENS.FORMAT_DATE);

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
            error: errorToLoggedError(new Error('Something Failed')),
            context: {
                origin,
                request: {
                    method: HttpMethod.GET,
                    url: 'http://localhost:3000/templates/log',
                    clientIp: '192.168.237.42',
                    userAgent: 'Mozilla/Firefox'
                }
            }
        };
        const content: string = renderLog({
            log: log as any,
            levelName: logLevelLabels[log.level],
            appName: GlobalRegistry.getAppData('name') ?? '',
            boxBgColor: bgColorForLogLevel[log.level],
            createdAtString: formatDate(log.createdAt, true)
        });
        const html: string = renderBaseEmail({
            content,
            base: {
                title: 'New log event',
                baseUrl: 'http://localhost:3000'
            }
        });
        return HtmlResponse.fromString(html);
    }
}