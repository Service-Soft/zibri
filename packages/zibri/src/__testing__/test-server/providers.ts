import { defaultTestProviders } from 'zibri-testing';

import { PasswordResetEmailTemplate } from '../../auth/authenticators/password/password-reset-email-template.model.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { defineProvider, DiProvider } from '../../di/models/di-provider.model.ts';
import { LocalizeService } from '../../localization/localize.service.ts';
import { Ms } from '../../utilities/ms.ts';
import { compileTsxTemplate } from '../compile-tsx-template.function.ts';
import { testVersionsFolder } from '../constants.ts';

export { testMasterKey } from 'zibri-testing';

class TestLocalizeService extends LocalizeService {
    override async onAppInit(): Promise<void> {
        // do nothing
    }
}

/**
 * What this repository's own test servers run with.
 *
 * The harness's defaults, plus the three things that are about *this* repository rather than about
 * running a Zibri application in a test: where its version folders and translations live, and a
 * password reset template compiled from a string instead of a file.
 */
export const defaultTestServerProviders: DiProvider<unknown>[] = [
    ...defaultTestProviders,
    defineProvider({
        token: ZIBRI_DI_TOKENS.PASSWORD_RESET_EMAIL_TEMPLATE,
        // eslint-disable-next-line typescript/no-explicit-any
        useValue: compileTsxTemplate<PasswordResetEmailTemplate<any, any>>(
            'export const Email = ({ confirmPasswordResetLink }) => <a href={confirmPasswordResetLink}></a>;'
        )
    }),
    // the real versioning service, writing into this repository's own file-output folder rather than
    // into the scratch directory the harness hands out: these suites share one recorded history on
    // purpose, and `file-output` is where everything this repository writes during a test goes.
    defineProvider({
        token: ZIBRI_DI_TOKENS.VERSIONS_PATH,
        useValue: testVersionsFolder
    }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.LOCALIZE_SERVICE,
        useClass: TestLocalizeService
    }),
    // what an application with websockets has to say, said once for the suites that only boot a
    // websocket controller. Here rather than in the harness's defaults: an application's own tests
    // should fail the way the application does when it forgot
    defineProvider({
        token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT,
        useValue: { messageRetentionInMs: Ms.DAY }
    })
];