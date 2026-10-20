import { setTimeout as wait } from 'node:timers/promises';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TOTP } from 'otpauth';
import { ClusterInstance, StartedTestCluster, startTestCluster } from 'zibri-testing';

import { otpUserEmail, otpUserPassword } from './otp-replay.instance-options.ts';
import { OtpRegistration } from '../../../auth/2fa/methods/otp/otp.two-factor-method.ts';
import { OTP_PERIOD_IN_SECONDS } from '../../../auth/2fa/methods/otp/otp.utilities.ts';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../../di/inject.function.ts';
import { FsUtilities } from '../../../utilities/fs.utilities.ts';
import { JsonUtilities } from '../../../utilities/json.utilities.ts';

/**
 * Executable form of evaluation/03-auth-and-security.md C3, the half that only more than one replica
 * can show.
 *
 * A TOTP code is shown for thirty seconds, so the same six digits are valid for that whole window
 * and RFC 6238 5.2 requires a verifier to accept them once. Recording the use in the process that
 * saw it satisfies that for a single server and for nothing else: the replay simply goes to another
 * pod, which has never heard of the code. The record is a lease for that reason, and this is what
 * says so.
 */

/**
 * How long to let a replica's log buffer drain before reading its output for a failure message.
 */
const LOG_DRAIN_WAIT_IN_MS: number = 250;

let cluster: StartedTestCluster | undefined;
let otpHeader: string;

beforeAll(async () => {
    cluster = await startTestCluster({
        instanceOptions: FsUtilities.getPath(import.meta.dirname, 'otp-replay.instance-options.ts')
    });
    // read rather than written out, so a deployment that moves the header does not quietly stop
    // being covered here
    otpHeader = inject(ZIBRI_DI_TOKENS.OTP_HEADER);
}, 30000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await cluster?.shutdown();
}, 15000);

/**
 * Creates a user with a confirmed authenticator on the given replica.
 * @param instance - The replica to enroll on.
 * @param tag - What to name the enrollment, so two tests do not share a user.
 * @returns What enrolling answers, whose secret generates the codes.
 */
async function enroll(instance: ClusterInstance, tag: string): Promise<OtpRegistration> {
    const res: Response = await fetch(`${instance.baseUrl}/cluster-otp/enroll/${tag}`, { method: 'POST' });
    expect(res.status).toBe(200);
    return await res.json() as OtpRegistration;
}

/**
 * Logs in as the given user, the way a client does.
 * @param instance - The replica to log in against.
 * @param email - The user to log in as.
 * @returns The access token value.
 */
async function login(instance: ClusterInstance, email: string): Promise<string> {
    const res: Response = await fetch(`${instance.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JsonUtilities.stringify({ email, password: otpUserPassword })
    });
    expect(res.status).toBe(200);
    const data: { accessToken: { value: string } } = await res.json() as { accessToken: { value: string } };
    return data.accessToken.value;
}

/**
 * Presents a code to the guarded operation on one replica.
 * @param instance - The replica to present it to.
 * @param accessToken - The logged in user's access token.
 * @param code - The code to present.
 * @returns The status the replica answered with.
 */
async function presentCode(instance: ClusterInstance, accessToken: string, code: string): Promise<number> {
    const res: Response = await fetch(`${instance.baseUrl}/cluster-otp/sensitive`, {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, [otpHeader]: code }
    });
    return res.status;
}

/**
 * Presents a code and reports the replica's own log when the status is not the expected one.
 *
 * There are several ways to be refused here and they all arrive as the same bare 401 - a code that
 * did not validate, a step already spent, credentials the replica could not read. The replica audits
 * every failed validation with a reason, so pulling its output in on a mismatch is what makes a red
 * name its cause rather than only its number.
 * @param instance - The replica to present to.
 * @param accessToken - The logged in user's access token.
 * @param code - The code to present.
 * @param expected - The status this presentation is supposed to answer with.
 * @returns The status on its own when it matches, followed by the replica's log when it does not.
 */
async function presentCodeExpecting(
    instance: ClusterInstance,
    accessToken: string,
    code: string,
    expected: number
): Promise<string> {
    const status: number = await presentCode(instance, accessToken, code);
    if (status === expected) {
        return `${status}`;
    }

    // the replica's log is buffered, and its `flush` lives in that process rather than in this one -
    // an instance is reachable over http and over the boot handshake, and neither carries a request
    // to drain a buffer. So the line explaining the refusal is waited for instead, only ever on the
    // way to a red, where waiting costs nothing.
    await wait(LOG_DRAIN_WAIT_IN_MS);
    return `${status}\n${instance.id}:\n${instance.output}`;
}

/**
 * The code the user's authenticator is showing right now.
 * @param enrollment - The enrollment to generate for.
 * @returns The six digits.
 */
function currentCode(enrollment: OtpRegistration): string {
    return new TOTP({ secret: enrollment.secret, period: OTP_PERIOD_IN_SECONDS }).generate();
}

describe('evaluation/03-auth-and-security C3 - otp replay across replicas', () => {

    it('refuses a code on one replica once another has accepted it', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const first: ClusterInstance = cluster.instanceAt(0);
        const second: ClusterInstance = cluster.instanceAt(1);

        const enrollment: OtpRegistration = await enroll(first, 'sequential');
        const accessToken: string = await login(first, otpUserEmail('sequential'));
        const code: string = currentCode(enrollment);

        // spent on the replica that did *not* enroll the user, which is also the control this test
        // needs: everything about the request has to work over there - the user, the confirmed
        // credentials, the token signed elsewhere - or the refusal below would prove nothing about
        // replay
        expect(await presentCodeExpecting(second, accessToken, code, 204)).toBe('204');

        // the same digits, still inside their window, to the replica that created them
        expect(await presentCodeExpecting(first, accessToken, code, 401)).toBe('401');
    }, 30000);

    it('accepts a code once when two replicas are given it at the same moment', async () => {
        if (!cluster) {
            throw new Error('the cluster did not start');
        }
        const first: ClusterInstance = cluster.instanceAt(0);
        const second: ClusterInstance = cluster.instanceAt(1);

        // its own enrollment: the code above is spent for the rest of its window, and the record is
        // keyed by the credentials, so a second user has an unspent code for the same window
        const enrollment: OtpRegistration = await enroll(first, 'simultaneous');
        const accessToken: string = await login(first, otpUserEmail('simultaneous'));
        const code: string = currentCode(enrollment);

        // both at once rather than one after the other. Sequentially even a read-then-write would
        // usually get this right; the two arriving together is what needs the claim to be taken
        // before anything is decided.
        const statuses: number[] = await Promise.all([
            presentCode(first, accessToken, code),
            presentCode(second, accessToken, code)
        ]);

        // the loser is refused one of two ways, and both mean the code was accepted once. Codes for
        // one user are checked one at a time across replicas, so a presentation arriving while the
        // other is still being checked is answered 429 without being looked at; one arriving just
        // after finds the code spent and is answered 401. Which of the two is down to timing
        expect(statuses.filter(s => s === 204)).toHaveLength(1);
        expect(statuses.filter(s => s === 401 || s === 429)).toHaveLength(1);

        // one of each is also what a replica that refuses *everything* produces, so the refusal has
        // to be shown to be about the code rather than about the replica. The one that lost gets an
        // unspent code, and accepting it is what says the refusal above was the other replica
        // having the code first.
        const refused: ClusterInstance = statuses[0] === 204 ? second : first;
        const control: OtpRegistration = await enroll(first, 'simultaneous-control');
        const controlToken: string = await login(first, otpUserEmail('simultaneous-control'));

        expect(await presentCodeExpecting(refused, controlToken, currentCode(control), 204)).toBe('204');
    }, 30000);
});