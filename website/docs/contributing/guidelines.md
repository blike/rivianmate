---
title: Contribution guidelines
sidebar_label: Guidelines
description: Ground rules, code style and how pull requests work.
---

# Contribution guidelines

Bug reports, fixes, features and documentation are all welcome. For anything larger than a small
fix, [open an issue](https://github.com/blike/rivianmate/issues/new/choose) first so the approach
can be agreed before you spend time on it. For a quick question about the code, ask on
[Discord](pathname:///discord).

## Ground rules

RivianMate talks to a private Rivian API on behalf of real owners, so every change follows these:

- **Read-only.** No vehicle commands (unlock, climate, charging and so on). Changes that add them
  won't be accepted.
- **Gentle on Rivian.** Requests go through a shared governor that spaces them out and backs off
  when rate limited. Reuse data already received, prefer the live subscriptions over polling, and
  never poll tightly.
- **Private by default.** Nothing leaves the user's server beyond the
  [outside services](../privacy-security.md#outside-services) listed. Don't log tokens, passwords,
  VINs or precise locations, and don't add telemetry or third-party services.

## Code style

- TypeScript in strict mode throughout. Avoid `any`.
- Format with Prettier: `pnpm format`.
- Match the code around your change: naming, structure and comment density. Comments say why, not
  what.
- Put testable logic in plain functions (`web/src/lib/`, `server/src/services/`) with tests beside
  it as `*.test.ts`. Tests that need PostgreSQL are named `*.db.test.ts`.
- The web app is organized by feature. Each page lives in `web/src/features/<feature>/` with what
  only it uses; shared components go in `web/src/components/` and shared logic in `web/src/lib/`
  once a second feature needs them.
- Use the theme's CSS variables rather than fixed colors, in Tailwind's short form:
  `text-(--text-muted)`, not `text-[var(--text-muted)]`. Check changes at phone width as well as
  desktop.

## Pull requests

- One change per pull request, with the template filled in.
- Screenshots for visible changes, taken in [demo mode](./development.md#demo-mode).
- Note anything people have to do when upgrading, such as new environment variables.
- Mention user-facing changes so they get a line in the changelog at release time.

## Reporting bugs

Use the issue templates. The RivianMate version, your vehicle model and the server logs around the
problem help most. Remove tokens, your VIN and locations from anything you paste.

Security problems go through the
[security policy](https://github.com/blike/rivianmate/security/policy), not public issues.

## License

RivianMate is licensed under the
[GNU General Public License v3.0](https://github.com/blike/rivianmate/blob/main/LICENSE). By
contributing, you agree your contribution is released under the same license.
