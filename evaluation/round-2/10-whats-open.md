# What's open — round 2

Every finding of this round in one table, by severity, and nothing else. A finding leaves this file
the moment it is completely done; what was decided and how it closed belongs to its chapter, under
its heading. Code quality items (the files under [code-review/](./code-review/), one per chapter plus
the cross-cutting [09](./code-review/09-architecture-and-code-quality.md)) are listed after the findings. The rows of [08 Part 1](./08-docs-and-dx.md) (claims the code does not support) are a table in
that chapter, all of them closed.

**0 CRITICAL, 9 MAJOR, 89 MINOR findings; 1 MAJOR and 42 MINOR code quality items** (counted 2026-10-21;
01 §D1, §D2, §D3, §D6, 03 §H1, 05 §I1 and 09 §Q3 closed the same day, and 01 §D14–§D16, which the Q3
file's first postgres run found, were filed and closed the same day too; 03 §H2, §H3, §H4, 01 §D17,
04 §A1, §A2, §A3, §A4, §A5, 05 §I2, §I3, §I4, §I5, 06 §F1, §F2, §F3, §F4, §F5, §F6, §F7, §F8, §F9, §F10, §F14, §F25, 01 §D4, §D5, 02 §S1, §S2, §S4, §S5 and §S6 closed 2026-10-22,
and 06 §F26 split out of §F25 and 01 §D18 out of §D5 the same day; 02 §S7, §S8, §S9, §S10, §S11, 03 §H18, 07 §T1, §T2, §T3, §T4, §T5 and §T6 closed 2026-10-23, and 07 §T21 split out of §T5 and 08 §X26 and 09 §Q14 filed and 08 §X13, §X8, §X9, §X10, §X11, §X12, §X24, §X1, §X2, §X3 and §X4 closed the same day, and 08 §X27 split out of §X3; 08 §X5 closed 2026-10-24, and 01 §D19 and §D20 filed from it the same day, and 08 §X14 and §X15 closed the same day, and 08 §X28 filed from §X15, and 08 §X16 closed 2026-10-25, widening 08 §X28, and 08 §X17 and §X19 closed the same day, and 08 §X20 closed the same day with 07 §T16 and 09 §Q10, and 01 §D21 filed from it, and 02 §S20 filed and closed the same day, and 01 §D21, 08 §X21, §X6, §X7, §X18, §X22 and §X23 closed the same day; 08 §X25, §X26, §X27 and §X28 closed 2026-10-26, and 06 §F27, 04 §A17 and §A18 filed from §X27 and closed the same day, and 03 §H20 filed and closed the same day, and 04 §A10, 01 §D18 and 02 §S3 closed the same day, and 06 §F28 filed and closed the same day, and 01 §D7, §D8, §D9, §D10, §D11, §D12, §D13, §D19 and §D20 closed the same day, and 09 §Q1, §Q6 and 06 §Q4 closed the same day, and 09 §Q9 closed the same day with §Q15 and §Q16 filed from it; 09 §Q5 and §Q2 closed 2026-10-27, and 02 §S12, §S13 and §S15 the same day; 06 §F11–§F13, §F15–§F24, §F26 and 07 §T13 closed 2026-10-28, and 07 §T7 and §T8 the same day, with 07 §T22 filed from §T8 and closed the same day and 07 §T23 filed from §T22, and 07 §T9, §T10, §T11, §T12, §T14 and §T15 closed the same day; 07 §T21 closed 2026-10-29 as a decision, and §T23 the same day, and the code quality items 01 §Q5, §Q6, 03 §Q2, §Q9, 04 §Q4, 05 §Q2, 06 §Q2, §Q3, §Q5, 07 §T17, 02 §Q5, 03 §Q8, 07 §T18, 03 §Q1, §Q5, 05 §Q6, 02 §Q4, 09 §Q14, §Q15, §Q16, 01 §Q4, §Q7, §Q3, §Q1, 02 §Q1, §Q2, §Q3, §Q6, 03 §Q3, §Q4, §Q6, §Q7, 04 §Q1, §Q2, §Q3, §Q5, 05 §Q4, §Q5, 09 §Q11, §Q4, §Q12, §Q13, 06 §Q6, §Q1, 07 §T20, §T19, 05 §Q1, §Q3, 06 §Q9 and 09 §Q8 closed the same day, and 09 §Q7 narrowed and then closed the same day, and 02 §S21 closed the same day, and the last five rows of 08 Part 1 the same day; [11](./11-unread-code-review.md) filed the same day with 1 CRITICAL, 25 MAJOR and 34 MINOR findings, and 06 §Q7 closed as a decision; 11 §U1, §S5, §S6, §S8, §S10, §S12, §L6 and §L7 closed 2026-10-30, and 06 §Q8 deferred by the user; 11 §V1–§V5, §W1 and §W2 filed and closed the same day, and 11 §S14 found by the container run of §S12 and closed the same day, the whole package suite green after it, and 06 §Q8 closed the same day as checkpoints and idempotency keys; [12](./12-hardcoded-values.md) filed the same day with 3 MAJOR and 26 MINOR findings, 12 §B1–§B5 closed the same day, and 12 §P3, §A1–§A4, §D1–§D6 and §H1–§H8 the same day, and 12 §B6 found by §H2 and closed the same day; 12 §P1, §P2 and §O1 closed 2026-10-31, and 12 §B7 and §O4 filed from §O2 the same day, §B7 closed, and 12 §B8 and §B9 found by the container run of §B7 and closed the same day, and 12 §O4 and §O2 closed the same day, with 12 §B10 filed from §O2 and closed the same day, and 12 §O3 closed the same day with none filed, and 12 §O5 and §O6 pulled back from it and closed the same day).

---

## MAJOR

### Data layer

| | |
|---|---|

### Auth and identity

| | |
|---|---|

### Infrastructure

| | |
|---|---|

### DI, packaging, tooling

| | |
|---|---|

### Docs and DX

| | |
|---|---|

### Architecture (MAJOR)

| | |
|---|---|

## MINOR

### Data layer

| | |
|---|---|

### HTTP runtime

| | |
|---|---|

### Auth and identity

| | |
|---|---|

### Infrastructure

| | |
|---|---|

### DI, packaging, tooling

| | |
|---|---|

### Docs and DX

| | |
|---|---|

## Code quality items (all MINOR unless marked)

| | |
|---|---|
