import { Email } from '../models/email.model';

/**
 * What a provider answered about one message.
 */
export type EmailSendResult = {
    /**
     * The addresses the provider refused, or an empty array when it took all of them.
     *
     * A partial refusal is the common real bounce - one address in a list that no longer exists -
     * and it is the reason this is a list rather than a boolean. What lands in the row is exactly
     * this, so a failed mail answers *who* rather than only *that something went wrong*.
     */
    rejectedRecipients: string[]
};

/**
 * The definition of a transport that actually delivers an email.
 *
 * This is the seam between the mail subsystem - queueing, priorities, the per-mail claim, the rate
 * limiter, and what becomes of the row - and whatever is on the other end of it. Zibri ships
 * `SmtpEmailTransport`; an http API such as SES, SendGrid or Postmark is a class implementing this
 * and registered under `ZIBRI_DI_TOKENS.EMAIL_TRANSPORT`.
 *
 * **The difference between throwing and answering is the contract**, and it is the thing to get
 * right when writing one:
 *
 * - **Throw** when the message did not reach the provider: a refused connection, a timeout, a 5xx,
 * an expired credential. The mail stays `QUEUED` and is attempted again once the claim on it
 * expires, so a provider having a bad minute costs a delay rather than the mail.
 * - **Answer with `rejectedRecipients`** when the provider replied and refused an address. That is
 * a verdict, so the mail is recorded `FAILED` and is never attempted again.
 *
 * Answering where you should have thrown loses mail silently. Throwing where you should have
 * answered sends the accepted recipients a second copy on the next attempt.
 */
export interface EmailTransportInterface {
    /**
     * The name of the transport. Used in error messages, so it should say which provider this is.
     */
    readonly name: string,
    /**
     * Delivers one mail, or throws when it could not be delivered to the provider at all.
     *
     * The whole row is handed over rather than a message built from it, so a transport can use the
     * id as an idempotency key with providers that offer one. Its `status` is still `QUEUED` here -
     * what becomes of the row is decided by the service from what this answers.
     */
    send: (email: Email) => Promise<EmailSendResult>,
    /**
     * Releases whatever the transport is holding - a connection pool, a keep-alive agent, an sdk
     * client - when the application shuts down.
     *
     * Optional, because a transport that opens a connection per send has nothing to release.
     */
    close?: () => void | Promise<void>
}