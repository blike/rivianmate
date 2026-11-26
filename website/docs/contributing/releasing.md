---
title: Releasing
description: How a RivianMate release is cut and published.
---

# Releasing

For maintainers. The repository's
[`RELEASING.md`](https://github.com/blike/rivianmate/blob/main/RELEASING.md) is the source of truth;
this is the outline.

1. Update the root, server and web package versions, and add release notes to `CHANGELOG.md`.
2. Run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test` and
   `pnpm build`.
3. Merge into `main` and wait for **Build and Push to Docker Hub**. It publishes `linux/amd64` and
   `linux/arm64` images as `edge` and the commit SHA.
4. Tag the main commit and push the tag:

   ```bash
   git tag -a v0.12.1 main -m 'RivianMate v0.12.1'
   git push origin refs/tags/v0.12.1:refs/tags/v0.12.1
   ```

   **Tag release image** retags the existing commit image without rebuilding:

   | Release                            | Tags published                  |
   | ---------------------------------- | ------------------------------- |
   | Newest stable, e.g. `v0.12.1`      | `0.12.1`, `0.12`, `0`, `latest` |
   | Patch to an older line             | that version and its minor      |
   | Pre-release, e.g. `v0.13.0-beta.1` | that tag only                   |

5. Publish a GitHub release from the tag, with the changelog entry and any upgrade notes.

Release tags are never moved after publication.

## Docs and releases

The documentation site deploys from `main` on its own schedule and isn't versioned with the app.
When a release changes behavior, update the docs in the same pull request so they're live when the
image is.
