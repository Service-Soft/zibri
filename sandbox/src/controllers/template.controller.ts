import { Controller, Get, HtmlResponse, Response } from 'zibri';

import renderBaseEmail from '../templates/emails/base-email.hbs';
import renderPasswordResetTemplate from '../templates/emails/password-reset.hbs';

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
}