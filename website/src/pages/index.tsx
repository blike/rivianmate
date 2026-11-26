import Head from '@docusaurus/Head';
import Link from '@docusaurus/Link';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';
import type { ReactNode } from 'react';
import styles from './index.module.css';

const FEATURES: { eyebrow: string; title: string; body: string; tone: string }[] = [
  {
    eyebrow: 'Live',
    title: 'The vehicle, right now',
    body: 'Battery, range, charge limit, closures, tire pressures, climate and software, pushed to the app as Rivian reports them.',
    tone: 'var(--accent)',
  },
  {
    eyebrow: 'Drives',
    title: 'Every drive, mapped',
    body: 'Detected on their own, with routes, speed and elevation, efficiency, addresses and the weather you drove in.',
    tone: 'var(--series-1)',
  },
  {
    eyebrow: 'Trips',
    title: 'Road trips, day by day',
    body: 'Pick the dates and drives and charges join as they finish: a map by day, overnight stays, totals and a replay.',
    tone: 'var(--series-3)',
  },
  {
    eyebrow: 'Charging',
    title: 'Curves and costs',
    body: 'Power curves, energy delivered, range added and what each session cost, from your own rates by location.',
    tone: 'var(--series-2)',
  },
  {
    eyebrow: 'Health',
    title: 'Battery over the years',
    body: 'Capacity estimates, parked energy loss, tire pressure trends and a timeline of every software version.',
    tone: 'var(--status-cold)',
  },
  {
    eyebrow: 'Alerts',
    title: 'Told when it matters',
    body: 'Doors left open, unlocked, charge finished, low battery or tire pressure, through Discord or Apprise.',
    tone: 'var(--series-4)',
  },
];

const PRINCIPLES: { title: string; body: string }[] = [
  {
    title: 'Self-hosted',
    body: 'Your history lives in your own Postgres, on your own hardware. No RivianMate cloud, no telemetry.',
  },
  {
    title: 'Read-only',
    body: 'RivianMate never sends a command to the vehicle. It listens, spaced out and gentle on Rivian.',
  },
  {
    title: 'R1 and R2',
    body: 'R1T, R1S and R2, with several vehicles on one account.',
  },
];

const INTEGRATIONS: { name: string; to: string; body: string }[] = [
  { name: 'Grafana', to: '/docs/integrations/grafana', body: 'Fifteen ready-made dashboards' },
  {
    name: 'Discord & Apprise',
    to: '/docs/configuration/notifications',
    body: 'Alerts wherever you get messages',
  },
  {
    name: 'Your old app',
    to: '/docs/import/overview',
    body: 'Bring history from Roamer or ElectraFi',
  },
];

/**
 * The icon's two headlight pills and yellow bar, drawn as a Rivian front end:
 * two stadium lamps joined by the bar.
 */
function Headlights(): ReactNode {
  const pill = { width: 96, height: 236, rx: 48 };
  const lamps = [420, 780];
  return (
    <svg className={styles.headlights} viewBox="0 0 1200 360" aria-hidden="true">
      <defs>
        <filter id="rm-glow" x="-20%" y="-60%" width="140%" height="220%">
          <feGaussianBlur stdDeviation="9" />
        </filter>
        <filter id="rm-halo" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="40" />
        </filter>
      </defs>

      {/* Soft wash of light around each lamp. */}
      <g filter="url(#rm-halo)" fill="#fff3c4" opacity="0.16">
        {lamps.map((x) => (
          <ellipse key={x} cx={x} cy={178} rx={90} ry={150} />
        ))}
      </g>

      {/* The lit parts twice: blurred for the glow, then sharp on top. */}
      {['glow', 'sharp'].map((layer) => (
        <g
          key={layer}
          filter={layer === 'glow' ? 'url(#rm-glow)' : undefined}
          opacity={layer === 'glow' ? 0.7 : 1}
        >
          {lamps.map((x) => (
            <rect
              key={x}
              x={x - pill.width / 2}
              y={60}
              {...pill}
              fill="none"
              stroke={layer === 'glow' ? '#fff3c4' : '#f7f4ea'}
              strokeWidth={layer === 'glow' ? 10 : 6}
            />
          ))}
          {/* The yellow bar between the lamps, as in the icon. */}
          <line
            x1={486}
            y1={147}
            x2={714}
            y2={147}
            stroke="#f5c518"
            strokeWidth={7}
            strokeLinecap="round"
          />
        </g>
      ))}
    </svg>
  );
}

function Hero(): ReactNode {
  const desktop = useBaseUrl('img/dashboard-desktop.png');
  const mobile = useBaseUrl('img/dashboard-mobile.png');
  return (
    <header className={styles.hero}>
      <Headlights />
      <div className="container">
        <h1 className={styles.heroTitle}>
          Your Rivian&rsquo;s history,
          <br />
          on your own server.
        </h1>
        <p className={styles.heroLede}>
          RivianMate records drives, charging, battery health and live vehicle state into your own
          database, and shows it on a dashboard you can open from anywhere.
        </p>
        <div className={styles.heroActions}>
          <Link className="btn-primary" to="/docs/installation/docker">
            Install with Docker
          </Link>
          <Link className="btn-secondary" to="/docs/intro">
            Read the docs
          </Link>
        </div>

        <div className={styles.shots}>
          <figure className={styles.shotDesktop}>
            <img
              src={desktop}
              alt="The RivianMate dashboard on a desktop, partway through a drive home"
              width={1680}
              height={860}
            />
          </figure>
          <figure className={styles.shotMobile}>
            <img src={mobile} alt="The same dashboard on a phone" width={390} height={835} />
          </figure>
        </div>
      </div>
    </header>
  );
}

function QuickStart(): ReactNode {
  return (
    <section className={styles.section}>
      <div className="container">
        <div className={styles.quickstart}>
          <div>
            <p className="eyebrow">Quick start</p>
            <h2 className={styles.sectionTitle}>Running in about five minutes</h2>
            <p className={styles.sectionLede}>
              One Compose file brings the app and its PostgreSQL database. Set a secret, start it,
              and sign in to Rivian from the setup wizard.
            </p>
            <Link className="btn-secondary" to="/docs/installation/docker">
              Full installation guide →
            </Link>
          </div>
          <div className={`rm-card ${styles.terminal}`}>
            <div className={styles.terminalBar}>
              <span />
              <span />
              <span />
              <em>~/rivianmate</em>
            </div>
            <pre>
              <code>
                <span className={styles.c}># 1. Get the Compose file and an .env</span>
                {'\n'}curl -LO
                https://raw.githubusercontent.com/blike/rivianmate/main/docker-compose.yml
                {'\n'}curl -Lo .env
                https://raw.githubusercontent.com/blike/rivianmate/main/.env.example
                {'\n\n'}
                <span className={styles.c}># 2. Set APP_SECRET and POSTGRES_PASSWORD</span>
                {'\n'}openssl rand -hex 32
                {'\n\n'}
                <span className={styles.c}># 3. Start it, then open http://localhost:4000</span>
                {'\n'}docker compose up -d
              </code>
            </pre>
          </div>
        </div>
      </div>
    </section>
  );
}

function Features(): ReactNode {
  return (
    <section className={styles.section}>
      <div className="container">
        <p className="eyebrow">What it records</p>
        <h2 className={styles.sectionTitle}>Everything the app shows you, kept</h2>
        <div className={styles.featureGrid}>
          {FEATURES.map((f) => (
            <div key={f.title} className={`rm-card ${styles.feature}`}>
              <p className="eyebrow" style={{ color: f.tone }}>
                {f.eyebrow}
              </p>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Principles(): ReactNode {
  return (
    <section className={styles.section}>
      <div className="container">
        <div className={styles.principles}>
          {PRINCIPLES.map((p) => (
            <div key={p.title}>
              <h3>{p.title}</h3>
              <p>{p.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Integrations(): ReactNode {
  return (
    <section className={styles.section}>
      <div className="container">
        <p className="eyebrow">Plays well with</p>
        <h2 className={styles.sectionTitle}>Your homelab, your way</h2>
        <p className={styles.sectionLede}>
          The data is plain PostgreSQL, so it goes wherever you want it. Owners have wired it into
          their dashboards and alerts; here&rsquo;s how.
        </p>
        <div className={styles.integrationGrid}>
          {INTEGRATIONS.map((i) => (
            <Link key={i.name} to={i.to} className={`rm-card ${styles.integration}`}>
              <strong>{i.name}</strong>
              <span>{i.body}</span>
              <em aria-hidden="true">→</em>
            </Link>
          ))}
        </div>
        <p className={styles.showcaseNote}>
          Built something with RivianMate?{' '}
          <Link to="/docs/community/projects">Add it to the community projects page</Link>, or show
          it off on <Link to="/discord">Discord</Link>.
        </p>
      </div>
    </section>
  );
}

export default function Home(): ReactNode {
  return (
    <Layout description="RivianMate records drives, charging, battery health and live vehicle state in your own database.">
      <Head>
        <title>RivianMate · Self-hosted data logger and dashboard for Rivian</title>
      </Head>
      <Hero />
      <main>
        <Principles />
        <Features />
        <QuickStart />
        <Integrations />
      </main>
    </Layout>
  );
}
