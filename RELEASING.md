# Releasing RivianMate

1. Update the root, server, and web package versions and add release notes to
   `CHANGELOG.md`. Commit the release changes on the release branch.
2. Run `pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`,
   `pnpm test`, and `pnpm build`.
3. Merge the tested release changes into `main` and push it. Wait for
   **Build and Push to Docker Hub** to pass. This is the only image build: it
   validates the commit and publishes linux/amd64 and linux/arm64 images as
   `latest` and the full commit SHA.
4. Create and push an annotated release tag pointing to that main commit:

   ```sh
   git tag -a v0.3 main -m 'RivianMate v0.3'
   git push origin refs/tags/v0.3:refs/tags/v0.3
   ```

   Wait for **Tag release image** to pass. It copies the existing commit image's
   multi-platform manifest to `v0.3` and `0.3`; it does not rebuild, rerun tests,
   or change `latest`. If main and the tag are pushed together, it waits up to
   ten minutes for the commit image. If the main build fails or takes longer,
   fix/retry that build and rerun the tag workflow once the image is available.
   Both workflows require `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` Actions
   secrets with permission to push `mitchvitale/rivianmate`.
5. Publish a GitHub release from the existing tag, using the corresponding
   changelog entry and upgrade instructions as its notes. Mark a stable release
   as latest. GitHub provides source ZIP and tar archives automatically.

Release tags should never be moved after publication. Pushes to `main`
continue to publish `latest` and the commit SHA. Choose the deployment version
in `docker-compose.yml` using `image: mitchvitale/rivianmate:latest` or
`image: mitchvitale/rivianmate:0.3`; no version environment variable is needed.

Before deployment, back up Postgres and preserve `APP_SECRET`. Do not roll back
only the image across database migrations; restore the matching database backup
as well. Check `/api/status` and the Settings API usage panel after upgrading.
