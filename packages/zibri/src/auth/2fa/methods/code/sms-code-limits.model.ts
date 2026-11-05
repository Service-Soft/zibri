/**
 * What the codes sent by text message may cost.
 */
export type SmsCodeLimits = {
    /**
     * How many codes the whole application sends by text message in an hour.
     */
    maxPerHour: number,
    /**
     * How many codes one phone number is sent in a day, whichever accounts ask for them.
     */
    maxPerNumberPerDay: number,
    /**
     * The numbers codes are sent to, by how they start, eg. `['+49', '+43']`. A number that starts
     * with none of them is refused.
     */
    allowedCallingCodes: `+${number}`[]
};