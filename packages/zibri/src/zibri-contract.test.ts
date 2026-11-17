import { describe, expect, it } from '@jest/globals';
import * as Contract from 'zibri-contract';

import { Equals } from './__testing__/equals.type';
import { Json } from './__testing__/json.type';
import * as Zibri from './index';

// the types of zibri-contract are what a frontend reads the responses of zibri with, and what it sends. Each is
// compared with the model zibri declares, as it arrives as json: a mismatch fails the typecheck, which is where these
// checks run. The bodies of the errors of a login that waits for a step are typed by the contract where zibri builds
// them, so they need no check here.

/**
 * The roles of an application, which both sides take as a parameter.
 */
type Role = 'admin' | 'user';

/**
 * A row of a page, which both sides take as a parameter.
 */
type Row = {
    /**
     * The id of the row.
     */
    id: string
};

describe('the types of zibri-contract', () => {
    it('are the enums zibri declares, rather than a copy of them', () => {
        expect(Zibri.LogLevel).toBe(Contract.LogLevel);
        expect(Zibri.ChangeSetType).toBe(Contract.ChangeSetType);
    });

    it('read a page and an error as zibri sends them', () => {
        const checks: true[] = [
            true satisfies Equals<Json<Zibri.PaginationResult<Row>>, Json<Contract.PaginationResult<Row>>>,
            true satisfies Equals<Json<Zibri.ErrorResponseBody>, Json<Contract.ErrorResponseBody>>,
            true satisfies Equals<Json<Zibri.ValidationProblem>, Json<Contract.ValidationProblem>>
        ];
        expect(checks).not.toContain(false);
    });

    it('read and send what the auth of zibri answers and takes', () => {
        const checks: true[] = [
            true satisfies Equals<Json<Zibri.JwtAuthData<Role>>, Json<Contract.JwtAuthData<Role>>>,
            true satisfies Equals<Json<Zibri.CookieAuthData<Role>>, Json<Contract.CookieAuthData<Role>>>,
            true satisfies Equals<Json<Zibri.CsrfToken>, Json<Contract.CsrfToken>>,
            true satisfies Equals<Json<Zibri.LogoutResult>, Json<Contract.LogoutResult>>,
            true satisfies Equals<Json<Zibri.UserLogin>, Json<Contract.UserLogin>>,
            true satisfies Equals<Json<Zibri.CurrentUserProfile>, Json<Contract.CurrentUserProfile>>,
            true satisfies Equals<Json<Zibri.CurrentUserMembership>, Json<Contract.CurrentUserMembership>>,
            true satisfies Equals<Json<Zibri.TwoFactorRegistrations>, Json<Contract.TwoFactorRegistrations>>,
            true satisfies Equals<Json<Zibri.OtpRegistration>, Json<Contract.OtpRegistration>>,
            true satisfies Equals<Json<Zibri.OtpRegistrationConfirmData>, Json<Contract.OtpRegistrationConfirmData>>,
            true satisfies Equals<Json<Zibri.RecoveryCodeRegistration>, Json<Contract.RecoveryCodeRegistration>>,
            true satisfies Equals<Json<Zibri.CodeRegistrationConfirmData>, Json<Contract.CodeRegistrationConfirmData>>,
            // confirmed with a code like the codes that are sent
            true satisfies Equals<Json<Zibri.RecoveryCodeRegistrationConfirmData>, Json<Contract.CodeRegistrationConfirmData>>,
            true satisfies Equals<Json<Zibri.SmsRegistrationRequestData>, Json<Contract.SmsRegistrationRequestData>>,
            true satisfies Equals<Json<Zibri.EmailConfirmation>, Json<Contract.EmailConfirmation>>,
            true satisfies Equals<Json<Zibri.LinkedIdentity>, Json<Contract.LinkedIdentity>>,
            true satisfies Equals<Json<Zibri.PasswordResetTokenValidity>, Json<Contract.PasswordResetTokenValidity>>,
            true satisfies Equals<Json<Zibri.FederatedLinkIdentityStart>, Json<Contract.FederatedLinkIdentityStart>>,
            true satisfies Equals<Json<Zibri.PasskeyTicketCredentials>, Json<Contract.PasskeyTicketCredentials>>
        ];
        expect(checks).not.toContain(false);
    });

    it('read and send the logs of zibri', () => {
        const checks: true[] = [
            true satisfies Equals<Json<Zibri.LoggedError>, Json<Contract.LoggedError>>,
            true satisfies Equals<Json<Zibri.LogContext>, Json<Contract.LogContext>>,
            true satisfies Equals<Json<Zibri.Log>, Json<Contract.Log>>
        ];
        expect(checks).not.toContain(false);
    });

    it('read the change sets of zibri, without the relation back from a change to its change set', () => {
        const checks: true[] = [
            true satisfies Equals<Json<Omit<Zibri.Change, 'changeSet'>>, Json<Contract.Change>>,
            true satisfies Equals<Json<Omit<Zibri.ChangeSet, 'changes'>>, Json<Omit<Contract.ChangeSet, 'changes'>>>,
            true satisfies Equals<Json<Omit<Zibri.ChangeSetEntity, 'changeSets'>>, Json<Omit<Contract.ChangeSetEntity, 'changeSets'>>>,
            true satisfies Equals<Json<Omit<Zibri.SoftDeleteEntity, 'changeSets'>>, Json<Omit<Contract.SoftDeleteEntity, 'changeSets'>>>,
            // zibri resets nested values too, which a frontend reads as the properties they are in
            true satisfies Equals<keyof Zibri.ResetChangeSetResult<Zibri.ChangeSetEntity>, keyof Contract.ResetChangeSetResult>
        ];
        expect(checks).not.toContain(false);
    });
});