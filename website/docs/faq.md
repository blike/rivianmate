---
title: FAQ
description: Common questions about RivianMate.
---

# Frequently asked questions

### Does RivianMate control my vehicle?

No. RivianMate is read-only: it never sends commands such as unlock, climate or charging, and
changes that add them won't be accepted.

### Will it drain my battery or bother the Rivian app?

RivianMate listens to Rivian's live updates rather than polling the vehicle, spaces out its requests
and backs off when Rivian asks it to. It's designed to stay out of the way of the official app.
**Settings → API & Feeds** shows exactly what it's doing.

### Which vehicles are supported?

R1T, R1S and R2, and several vehicles on one Rivian account.

### Where is my data stored?

In the PostgreSQL database that runs next to RivianMate, on your own server. See
[Privacy & security](./privacy-security.md) for the outside services it talks to.

### Can I open it from my phone?

Yes. The interface works on phones and tablets. To open it away from home, use
[Tailscale or a reverse proxy with HTTPS](./installation/reverse-proxy.md).

### Rivian asked me to sign in again. Why?

Rivian sometimes ends sessions on its side. RivianMate shows a prompt to sign in again, and picks up
where it left off once you do. If it happens after an update, check that `APP_SECRET` didn't change:
the stored tokens can't be read without the original secret.

### Can I run it without Docker?

Docker Compose is the supported install. RivianMate is a Node.js app with a PostgreSQL database, so
running it another way is possible (see [Development](./contributing/development.md)), but it's not
documented or supported.

### Some drives are missing.

RivianMate records drives from the moment it's connected. For older history,
[import it](./import/overview.md). If drives go missing while it's running, set `LOG_LEVEL=debug`
and [open an issue](https://github.com/blike/rivianmate/issues/new/choose) with the logs.

### Where can I get help?

Ask on the [RivianMate Discord](pathname:///discord), where other owners and the maintainers hang
out. For bugs, open an issue so it isn't lost.

### How do I report a bug or ask for a feature?

Use the [issue templates](https://github.com/blike/rivianmate/issues/new/choose). For bugs, include
the RivianMate version (**Settings → About**), your vehicle model and the logs around the problem,
with tokens, your VIN and locations removed. For security problems, follow the
[security policy](https://github.com/blike/rivianmate/security/policy) instead.
