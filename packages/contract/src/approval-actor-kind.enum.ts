/**
 * Who or what proposed or decided an approval request, which tells what the id or name beside it names.
 */
export enum ApprovalActorKind {
    /**
     * A user, a service account among them: the id names the user.
     */
    USER = 'USER',
    /**
     * The application or a plugin, proposing without a user: the name says which part of it.
     */
    SYSTEM = 'SYSTEM',
    /**
     * A policy of the action, approving without a user: the name is that of the policy.
     */
    POLICY = 'POLICY'
}