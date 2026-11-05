/**
 * What a certificate's key may be used for, as its key usage extension names it.
 */
export type FakeKeyUsage = 'digitalSignature'
    | 'nonRepudiation'
    | 'keyEncipherment'
    | 'dataEncipherment'
    | 'keyAgreement'
    | 'keyCertSign'
    | 'cRLSign'
    | 'encipherOnly'
    | 'decipherOnly';