import { useEffect, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useRivianDiagnostics, useStatus, useVehicles } from '../../api/hooks';
import { AboutSection } from './AboutSection';
import { ApiConnectionsPanel } from './ApiConnectionsPanel';
import { GeneralSection } from './GeneralSection';
import { HomeChargingPanel } from './HomeChargingPanel';
import {
  CarIcon,
  BoltIcon,
  BellIcon,
  DatabaseIcon,
  PulseIcon,
  LockIcon,
  InfoIcon,
} from './NavIcons';
import { NotificationsPanel } from './NotificationsPanel';
import { SecuritySection } from './SecuritySection';
import { TeslaMatePanel } from './TeslaMatePanel';

const sections = [
  {
    id: 'general',
    label: 'General',
    description: 'Your vehicle, display units and Rivian account.',
    icon: <CarIcon />,
  },
  {
    id: 'charging',
    label: 'Charging',
    description: 'How home charging is priced and recognized.',
    icon: <BoltIcon />,
  },
  {
    id: 'notifications',
    label: 'Notifications',
    description: 'Alerts for doors, locks, software, charging and tires.',
    icon: <BellIcon />,
  },
  {
    id: 'api',
    label: 'API & Feeds',
    description: 'How data is arriving from Rivian.',
    icon: <PulseIcon />,
  },
  {
    id: 'teslamate',
    label: 'TeslaMate',
    description: 'Show your Tesla from a TeslaMate database, read-only.',
    icon: <DatabaseIcon />,
  },
  {
    id: 'security',
    label: 'Security',
    description: 'Your app password and this browser’s session.',
    icon: <LockIcon />,
  },
  {
    id: 'about',
    label: 'About',
    description: 'Version, build and project links.',
    icon: <InfoIcon />,
  },
];

export function SettingsPage() {
  const [params] = useSearchParams();
  const section = sections.find((item) => item.id === params.get('section')) ?? sections[0]!;
  const { data: status } = useStatus();
  const {
    data: diagnostics,
    isPending: diagnosticsPending,
    isError: diagnosticsError,
  } = useRivianDiagnostics(section.id === 'api');
  const { data: vehicles } = useVehicles();
  // On phones the nav is a scrolling strip; keep the open section in view.
  const activeLink = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    activeLink.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [section.id]);

  return (
    <div className="grid items-start gap-6 md:grid-cols-[12rem_minmax(0,1fr)] md:gap-10">
      <nav
        aria-label="Settings"
        className="-mx-4 flex gap-1 overflow-x-auto px-4 md:sticky md:top-4 md:mx-0 md:flex-col md:overflow-visible md:px-0"
      >
        {sections.map((item) => {
          const nextParams = new URLSearchParams(params);
          nextParams.set('section', item.id);
          const active = section.id === item.id;
          return (
            <Link
              key={item.id}
              ref={active ? activeLink : undefined}
              to={{ search: `?${nextParams}` }}
              aria-current={active ? 'page' : undefined}
              className={`flex items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors ${
                active
                  ? 'bg-(--surface-2) font-medium text-(--text-primary)'
                  : 'text-(--text-secondary) hover:bg-(--surface-2) hover:text-(--text-primary)'
              }`}
            >
              <span className={active ? 'text-(--accent)' : 'text-(--text-muted)'}>
                {item.icon}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>
      <section aria-label={section.label} className="min-w-0 max-w-3xl space-y-6">
        <header>
          <h2 className="text-xl font-semibold tracking-tight">{section.label}</h2>
          <p className="mt-1 text-sm text-(--text-secondary)">{section.description}</p>
        </header>
        {section.id === 'general' && (
          <GeneralSection
            parallaxModes={diagnostics?.monitor.parallaxModes}
            email={status?.rivianEmail ?? null}
            connected={status?.rivianConnected ?? false}
            mockMode={status?.mockMode ?? false}
          />
        )}
        {section.id === 'charging' && <HomeChargingPanel vehicleId={vehicles?.[0]?.id} />}
        {section.id === 'notifications' && <NotificationsPanel />}
        {section.id === 'api' && (
          <ApiConnectionsPanel
            diagnostics={diagnostics}
            loading={diagnosticsPending}
            error={diagnosticsError}
            vehicles={vehicles ?? []}
            mockMode={status?.mockMode ?? false}
          />
        )}
        {section.id === 'teslamate' && <TeslaMatePanel />}
        {section.id === 'security' && <SecuritySection />}
        {section.id === 'about' && <AboutSection />}
      </section>
    </div>
  );
}
