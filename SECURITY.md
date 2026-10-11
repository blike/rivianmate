# Security policy

RivianMate holds sensitive data: encrypted Rivian account tokens, and a record of where a vehicle
has been and when. Security reports are taken seriously, and are welcome even if you're not sure
something is a real problem.

## Supported versions

Fixes go into the next release. Only the latest release (the `latest` Docker image) is supported;
please update before reporting.

## Reporting a vulnerability

**Don't open a public issue.** Report it privately through GitHub instead:

1. Go to the repository's **Security** tab.
2. Choose **Report a vulnerability**
   ([direct link](https://github.com/blike/rivianmate/security/advisories/new)).

Please include:

- the RivianMate version, and how it's deployed (Docker Compose, reverse proxy, and so on)
- what an attacker could do, and what access they'd need
- steps to reproduce, or a proof of concept

Don't include real Rivian tokens, passwords, VINs or location data. Redact them, or reproduce with
demo mode (`MOCK_RIVIAN=1`).

This is a volunteer project, so response times are best effort. You should hear back within a week.

## In scope

- Authentication and sessions for the web app
- Storage and encryption of Rivian tokens
- Access to vehicle, location or charging data without signing in
- Injection, cross-site scripting, or request forgery in the web app or API
- Secrets or personal data leaking into logs, notifications or error messages
- The published Docker image and how it runs

## Out of scope

- Vulnerabilities in Rivian's own services or API. Report those to Rivian.
- Deployments that expose port 4000 directly to the internet without HTTPS, which the README advises
  against
- Attacks that need access to the host, the database, or `APP_SECRET`
- Missing hardening that doesn't lead to a concrete exploit
