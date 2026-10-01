# Releasing RivianMate

1. Update the root, server, and web package versions (e.g. `0.3.1`) and add
   release notes to `CHANGELOG.md`. Commit the release changes on the release
   branch.
2. Run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`,
   `pnpm test`, and `pnpm build`.
3. Merge the tested release changes into `main` and push it. Wait for
   **Build and Push to Docker Hub** to pass. This is the only image build: it
   validates the commit and publishes linux/amd64 and linux/arm64 images as
   `edge` and the full commit SHA.
4. Create and push an annotated release tag pointing to that main commit. The
   tag must be `v` plus the full package version:

   ```sh
   git tag -a v0.3.1 main -m 'RivianMate v0.3.1'
   git push origin refs/tags/v0.3.1:refs/tags/v0.3.1
   ```

   Wait for **Tag release image** to pass. It rejects tags that aren't
   `vMAJOR.MINOR.PATCH` (optionally with a pre-release suffix like `-beta.1`)
   or don't match `package.json`, then copies the existing commit image's
   multi-platform manifest to new tags without rebuilding or rerunning tests:

   | Release | Tags published |
   |---|---|
   | Newest stable, e.g. `v0.3.1` | `0.3.1`, `0.3`, `0`, `latest` |
   | Patch to an older line, e.g. `v0.2.5` after `v0.3.0` | `0.2.5`, `0.2` |
   | Pre-release, e.g. `v0.4.0-beta.1` | `0.4.0-beta.1` only |

   Floating tags (`latest`, `0`, `0.3`) only move to the newest release in
   their range. If main and the tag are pushed together, the workflow waits up
   to ten minutes for the commit image. If the main build fails or takes
   longer, fix/retry that build and rerun the tag workflow once the image is
   available. Both workflows require `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`
   Actions secrets with permission to push `mitchvitale/rivianmate`.
5. Publish a GitHub release from the existing tag, using the corresponding
   changelog entry and upgrade instructions as its notes. Mark a stable release
   as latest (or as a pre-release for `-beta`/`-rc` tags). GitHub provides
   source ZIP and tar archives automatically.

Release tags should never be moved after publication. Pushes to `main` publish
`edge` and the commit SHA, never `latest`. Choose the deployment version in
`docker-compose.yml` with the image tag (see the README); no version
environment variable is needed.

Before deployment, back up Postgres and preserve `APP_SECRET`. Do not roll back
only the image across database migrations; restore the matching database backup
as well. Check `/api/status` and the Settings API usage panel after upgrading.
