# Security Policy

## Supported versions

We provide security fixes for the latest release line only.

| Version | Supported |
| --- | --- |
| 0.9.x | Yes |
| < 0.9 | No |

## Reporting a vulnerability

Please do **not** open a public GitHub issue for suspected security problems.

Instead, email **opensource@patternmesh.com** with:

- a clear description of the issue
- affected package(s) and version(s)
- reproduction steps or proof of concept
- any proposed mitigations

We will acknowledge receipt within 3 business days and will keep you informed
as we investigate.

## Disclosure process

When a report is confirmed, we will:

1. validate impact and affected versions
2. prepare a fix and tests
3. publish a patched release
4. disclose the issue with mitigation guidance

We ask reporters to avoid public disclosure until a fix is available.

## Package provenance

Published packages are intended to use npm provenance via GitHub Actions OIDC.
Once release automation is active, you can verify provenance with:

```bash
npm audit signatures @patternmeshjs/core
npm audit signatures @patternmeshjs/aws-sdk-v3
npm audit signatures @patternmeshjs/streams
```
