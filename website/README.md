# RivianMate documentation site

The source of the RivianMate docs, built with [Docusaurus](https://docusaurus.io).

This folder is its own npm project. It is not part of the pnpm workspace, the app build or the
Docker image, and the image workflow ignores changes here.

```sh
npm ci
npm start        # http://localhost:3000/
npm run build    # production build into build/, fails on broken links
npm run serve    # preview the production build
npm run preview  # build then serve: the only way to try search, whose index is made at build time
```

Pages are Markdown files in `docs/`, ordered by `sidebars.ts`. The theme in `src/css/custom.css`
uses the same tokens as the app (`web/src/index.css`).

Deployment to GitHub Pages is handled by `.github/workflows/docs.yml`. See
[Working on the docs](docs/contributing/documentation.md) for details.
