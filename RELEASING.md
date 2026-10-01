# Releasing RivianMate

1. Update the root, server, and web package versions and add release notes to
   `CHANGELOG.md`. Commit the release changes on the release branch.
2. Run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`,
   `pnpm test`, and `pnpm build`.
3. Push the branch, then create and push an annotated release tag pointing to
   the tested commit. For v0.3, use explicit refs because branch and tag share
   a name:

   ```sh
   git push origin refs/heads/v0.3:refs/heads/v0.3
   git tag -a v0.3 refs/heads/v0.3 -m 'RivianMate v0.3'
   git push origin refs/tags/v0.3:refs/tags/v0.3
   ```

4. Wait for **Build and Push to Docker Hub** to pass. It runs type checking,
   lint, tests, and builds before publishing linux/amd64 and linux/arm64 images.
   The repository must have `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` Actions
   secrets with permission to push `mitchvitale/rivianmate`.
5. Publish a GitHub release from the existing tag, using the corresponding
   changelog entry and upgrade instructions as its notes. Mark a stable release
   as latest. GitHub provides source ZIP and tar archives automatically.

The v0.3 tag publishes Docker tags `v0.3`, `0.3`, `latest`, and the full commit
SHA. Release tags should never be moved after publication. Pushes to `main`
continue to publish `latest` and the commit SHA; pin `0.3` to stay on this release.

Before deployment, back up Postgres and preserve `APP_SECRET`. Do not roll back
only the image across database migrations; restore the matching database backup
as well. Check `/api/status` and the Settings API usage panel after upgrading.
