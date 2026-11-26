import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docs: [
    'intro',
    {
      type: 'category',
      collapsed: false,
      label: 'Installation',
      items: [
        'installation/docker',
        'installation/reverse-proxy',
        'installation/updating',
        'installation/backup-restore',
      ],
    },
    {
      type: 'category',
      collapsed: false,
      label: 'Configuration',
      items: [
        'configuration/environment-variables',
        'configuration/settings',
        'configuration/notifications',
      ],
    },
    {
      type: 'category',
      collapsed: false,
      label: 'Importing data',
      items: ['import/overview', 'import/rivian-roamer', 'import/electrafi'],
    },
    {
      type: 'category',
      collapsed: false,
      label: 'Integrations',
      items: ['integrations/overview', 'integrations/grafana'],
    },
    {
      type: 'category',
      collapsed: false,
      label: 'Community',
      items: ['community/projects'],
    },
    'faq',
    'privacy-security',
    {
      type: 'category',
      collapsed: false,
      label: 'Contributing',
      items: [
        'contributing/development',
        'contributing/guidelines',
        'contributing/documentation',
        'contributing/releasing',
      ],
    },
  ],
};

export default sidebars;
