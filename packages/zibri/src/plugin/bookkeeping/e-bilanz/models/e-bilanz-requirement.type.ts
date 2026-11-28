/**
 * What the tax administration asks of a position or field of the HGB taxonomy: `M` a value or NIL in every E-Bilanz
 * (Mussfeld), `S` a value or NIL, and the same of the positions below it (Summenmussfeld), `R` a value where the
 * positions it sums with have one (rechnerisch notwendig, soweit vorhanden).
 */
export type EBilanzRequirement = 'M' | 'S' | 'R';