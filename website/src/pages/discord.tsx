import Head from '@docusaurus/Head';
import Layout from '@theme/Layout';
import { useEffect, type ReactNode } from 'react';

/**
 * rivianmate.org/discord: the one place the invite lives, so every link on
 * the site (and anywhere else) can point here and survive a new invite.
 */
export const DISCORD_INVITE = 'https://discord.gg/BZc2GYQKxb';

export default function Discord(): ReactNode {
  useEffect(() => {
    window.location.replace(DISCORD_INVITE);
  }, []);
  return (
    <Layout title="Discord" description="Join the RivianMate community on Discord.">
      <Head>
        <meta httpEquiv="refresh" content={`0; url=${DISCORD_INVITE}`} />
      </Head>
      <main className="container" style={{ padding: '6rem 1rem', textAlign: 'center' }}>
        <p className="eyebrow">Community</p>
        <h1>Taking you to Discord…</h1>
        <p>
          If nothing happens, <a href={DISCORD_INVITE}>join the RivianMate Discord here</a>.
        </p>
      </main>
    </Layout>
  );
}
