import { useVersion } from '../../api/hooks';
import { Skeleton } from '../../components/LoadingState';
import { SettingsGroup, SettingsHero } from './SettingsControls';
import { REPO_URL, shortCommit, versionLabel } from './version';

export function AboutSection() {
  const { data: info, isPending } = useVersion();
  const commit = shortCommit(info?.commit);

  return (
    <>
      <SettingsHero
        tone="accent"
        eyebrow="RivianMate"
        headline={isPending ? <Skeleton className="w-[4em]" /> : versionLabel(info)}
        detail={
          isPending ? (
            <Skeleton className="w-[10em]" />
          ) : commit ? (
            <>
              Built from{' '}
              <a
                href={`${REPO_URL}/commit/${info!.commit}`}
                target="_blank"
                rel="noreferrer noopener"
                className="text-xs text-(--text-primary) underline-offset-4 hover:underline"
              >
                {commit}
              </a>
            </>
          ) : (
            'Development build'
          )
        }
      />
      <SettingsGroup>
        <ExternalRow
          href={`${REPO_URL}/blob/main/CHANGELOG.md`}
          label="Changelog"
          description="What changed in each release"
        />
        <ExternalRow href={REPO_URL} label="Source code" description="RivianMate on GitHub" />
        <ExternalRow
          href={`${REPO_URL}/issues`}
          label="Report an issue"
          description="Bugs and feature requests"
        />
      </SettingsGroup>
      <SettingsGroup title="Data sources">
        <ExternalRow
          href="https://www.openstreetmap.org/copyright"
          label="OpenStreetMap"
          description="Map data and addresses © OpenStreetMap contributors, under the ODbL"
        />
        <ExternalRow
          href="https://openfreemap.org/"
          label="OpenFreeMap"
          description="Map tiles, built with OpenMapTiles"
        />
        <ExternalRow
          href="https://nominatim.org/"
          label="Nominatim"
          description="Address lookups for drive starts and ends"
        />
        <ExternalRow
          href="https://open-meteo.com/"
          label="Open-Meteo"
          description="Outside temperature: Open-Meteo.com model data under CC BY 4.0, interpolated along each drive's route"
        />
      </SettingsGroup>
    </>
  );
}

function ExternalRow(props: { href: string; label: string; description: string }) {
  return (
    <a
      href={props.href}
      target="_blank"
      rel="noreferrer noopener"
      className="flex items-center justify-between gap-4 px-4 py-3.5 transition-colors first:rounded-t-xl last:rounded-b-xl hover:bg-(--surface-2)"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium">{props.label}</span>
        <span className="block text-xs text-(--text-muted)">{props.description}</span>
      </span>
      <svg
        viewBox="0 0 12 12"
        className="h-3.5 w-3.5 shrink-0 text-(--text-muted)"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        aria-hidden
      >
        <path d="M4.5 2.5h5v5M9.5 2.5l-7 7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </a>
  );
}
