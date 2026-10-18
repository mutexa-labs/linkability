# Security

This package scores how easily position slices can be linked. People may rely on that score to decide how to trade. A wrong number is a
security problem, not only a bug.

## Reporting

Please report privately through GitHub's private vulnerability reporting on this repository
(Security tab, "Report a vulnerability"). Do not open a public issue for a problem that could understate
linkability, or for anything in the verifier that sends data anywhere other than the public Hyperliquid API.

Include the input, the score returned, and why you think it is wrong.
A failing vector is the most useful report.

## Scope

- Formula errors in any exported function.
- A scorer result that does not follow SPEC.md.
- Anything in the published package that is not in this repository.

The scorer does no I/O. The verifier only reads the public Hyperliquid info API. The fixture recorder in `scripts/`
is not part of the published package.
