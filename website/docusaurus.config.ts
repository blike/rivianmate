import type * as Preset from '@docusaurus/preset-classic';
import type { Config } from '@docusaurus/types';
import { themes as prismThemes } from 'prism-react-renderer';

// Served from the root of rivianmate.org (see static/CNAME).
const url = 'https://rivianmate.org';
const baseUrl = '/';

const repo = 'https://github.com/blike/rivianmate';

const config: Config = {
  title: 'RivianMate',
  tagline: 'A self-hosted data logger and dashboard for your Rivian.',
  favicon: 'img/icon.svg',
  url,
  baseUrl,
  organizationName: 'blike',
  projectName: 'rivianmate',
  trailingSlash: false,
  baseUrlIssueBanner: false,

  onBrokenLinks: 'throw',
  markdown: { hooks: { onBrokenMarkdownLinks: 'throw' } },

  i18n: { defaultLocale: 'en', locales: ['en'] },

  presets: [
    [
      'classic',
      {
        docs: {
          sidebarPath: './sidebars.ts',
          editUrl: `${repo}/edit/main/website/`,
          showLastUpdateTime: false,
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],

  // Search runs in the browser from an index built with the site: no outside service.
  themes: [
    [
      '@easyops-cn/docusaurus-search-local',
      {
        hashed: true,
        indexBlog: false,
        indexPages: false,
        docsRouteBasePath: '/docs',
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
        searchBarShortcutHint: true,
      },
    ],
  ],

  themeConfig: {
    image: 'img/dashboard-desktop.png',
    // The app has one committed dark look; the docs do too.
    colorMode: { defaultMode: 'dark', disableSwitch: true, respectPrefersColorScheme: false },
    metadata: [{ name: 'theme-color', content: '#0e0e0d' }],
    docs: { sidebar: { hideable: false, autoCollapseCategories: false } },
    navbar: {
      title: 'RivianMate',
      logo: { alt: 'RivianMate', src: 'img/icon.svg', width: 28, height: 28 },
      items: [
        // One item lights up per page: each shortcut owns its section of the docs,
        // and Docs owns the rest.
        {
          to: '/docs/intro',
          label: 'Docs',
          position: 'left',
          activeBaseRegex: '^/docs/(?!installation/|integrations/|contributing/)',
        },
        {
          to: '/docs/installation/docker',
          label: 'Install',
          position: 'left',
          activeBasePath: '/docs/installation/',
        },
        {
          to: '/docs/integrations/overview',
          label: 'Integrations',
          position: 'left',
          activeBasePath: '/docs/integrations/',
        },
        {
          to: '/docs/contributing/development',
          label: 'Contribute',
          position: 'left',
          activeBasePath: '/docs/contributing/',
        },
        { to: '/discord', label: 'Discord', position: 'right' },
        { href: `${repo}/releases`, label: 'Releases', position: 'right' },
        {
          href: repo,
          position: 'right',
          className: 'header-github-link',
          'aria-label': 'GitHub repository',
        },
      ],
    },
    // One quiet line rather than link columns: the sidebar and navbar already cover the docs.
    footer: {
      copyright: [
        `<a href="${repo}">GitHub</a>`,
        `<a href="/discord">Discord</a>`,
        `<a href="${repo}/releases">Releases</a>`,
        `<a href="${repo}/security/policy">Security</a>`,
        '<span>GPL-3.0 · Not affiliated with Rivian Automotive</span>',
      ].join(''),
    },
    prism: {
      theme: prismThemes.oneDark,
      darkTheme: prismThemes.oneDark,
      additionalLanguages: ['bash', 'yaml', 'sql', 'nginx', 'json', 'ini'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
