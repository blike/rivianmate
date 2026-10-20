import { useMemo, type ReactNode } from 'react';
import type { BatteryWindowDto, ChargingSessionDto, DriveDto } from '@server/api-types';
import { useUnits } from '../../api/hooks';
import { ContentFrame, Skeleton, useLoading } from '../../components/LoadingState';
import { formatMoney } from '../../lib/charging';
import { shortDate } from '../../lib/format';
import { fmt } from '../../lib/state';
import { type ChargeSource, type EnergyBalance, energyBalance, energyLedger } from './patterns';

const SOURCE: Record<ChargeSource, { label: string; color: string }> = {
  home: { label: 'Home', color: 'var(--accent)' },
  public: { label: 'Public', color: 'var(--series-1)' },
  other: { label: 'Elsewhere', color: 'var(--series-3)' },
};
const SOURCES: ChargeSource[] = ['home', 'public', 'other'];

const DRIVING_COLOR = 'var(--series-1)';
/** Energy the battery gave up or took in over the period: on the in side or the out side. */
const BATTERY_COLOR = 'color-mix(in srgb, var(--accent) 35%, var(--surface-3))';

/**
 * Where charged energy went, in the order the bar lays it out. What isn't
 * matched to any of these is left as bare track, explained in a note.
 */
function balanceParts(b: EnergyBalance) {
  return [
    { key: 'driving', label: 'Driving', kwh: b.drivingKwh, color: DRIVING_COLOR },
    { key: 'parked', label: 'Parked', kwh: b.parkedKwh, color: 'var(--series-3)' },
    {
      key: 'thermal',
      label: 'Charging losses',
      kwh: b.thermalKwh,
      color: 'var(--series-2)',
    },
    {
      key: 'stored',
      label: 'Left in battery',
      kwh: Math.max(0, b.batteryChangeKwh),
      color: BATTERY_COLOR,
    },
  ];
}

/**
 * Energy in against energy out: what was charged and where, on the same
 * scale as what the drives used, and what it all cost.
 */
export function EnergyPanel(props: {
  drives: DriveDto[] | undefined;
  sessions: ChargingSessionDto[] | undefined;
  /** When drive history starts; charging before then is left out. */
  drivesSince: string | null;
  /** The battery over the same period, to balance against. */
  battery?: BatteryWindowDto;
  loading: boolean;
  from: Date;
  to: Date;
}) {
  const u = useUnits();
  const ledger = useMemo(
    () =>
      energyLedger(
        props.drives ?? [],
        props.sessions ?? [],
        props.from.getTime(),
        props.to.getTime(),
        props.drivesSince ? Date.parse(props.drivesSince) : null,
      ),
    [props.drives, props.sessions, props.from, props.to, props.drivesSince],
  );
  const balance = useMemo(() => energyBalance(ledger, props.battery), [ledger, props.battery]);
  const out = balance ? balanceParts(balance) : null;
  // Energy the battery gave up over the period went out too, so it comes in beside charging.
  const fromBattery = balance ? Math.max(0, -balance.batteryChangeKwh) : 0;
  const inKwh = ledger.chargedKwh + fromBattery;
  const outKwh = out ? out.reduce((sum, p) => sum + p.kwh, 0) : ledger.usedKwh;
  const scale = Math.max(inKwh, outKwh);
  const drivingNote =
    ledger.usedKwh > 0
      ? `${u.formatDistance(ledger.usedKm)} · ${u.formatEfficiency(ledger.usedKm, ledger.usedKwh)}`
      : 'No drive energy recorded';
  const money = (n: number | null) =>
    n == null ? '—' : formatMoney(n.toFixed(2), ledger.currency);
  const perDistance =
    ledger.totalCost != null && ledger.usedKm > 0
      ? `${money(ledger.totalCost / (u.distance(ledger.usedKm) ?? 1))} per ${u.distanceUnit}`
      : null;
  // No charging of a kind means it cost nothing, not that the cost is unknown.
  const costOf = (k: ChargeSource) => ledger.cost[k] ?? (ledger.charged[k] > 0 ? null : 0);
  const homeShare = ledger.chargedKwh > 0 ? ledger.charged.home / ledger.chargedKwh : null;
  const batteryLevels = `${fmt(props.battery?.startLevel, 0)}% → ${fmt(props.battery?.endLevel, 0)}%`;

  return (
    <section className="card p-5 sm:p-6">
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="eyebrow text-(--text-secondary)">In and out</h2>
        {ledger.since != null && (
          <p className="text-xs text-(--text-muted)">
            Since {shortDate(ledger.since)}, the earliest recorded drive
          </p>
        )}
      </div>
      <ContentFrame
        height="9rem"
        loading={props.loading}
        empty={scale === 0}
        emptyText="No charging or drive energy recorded in this period."
      >
        <div className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <div className="space-y-6">
            <Flow
              label={out ? 'Energy in' : 'Charged'}
              total={`${fmt(inKwh, 0)} kWh`}
              parts={[
                ...SOURCES.map((k) => ({ key: k, kwh: ledger.charged[k], color: SOURCE[k].color })),
                { key: 'battery', kwh: fromBattery, color: BATTERY_COLOR },
              ]}
              scale={scale}
            />
            <Legend
              items={[
                ...SOURCES.filter((k) => ledger.charged[k] > 0).map((k) => ({
                  key: k,
                  label: `Charged ${SOURCE[k].label.toLowerCase()}`,
                  kwh: ledger.charged[k],
                  color: SOURCE[k].color,
                })),
                ...(fromBattery >= 0.5
                  ? [
                      {
                        key: 'battery',
                        label: 'From the battery',
                        kwh: fromBattery,
                        color: BATTERY_COLOR,
                        sub: batteryLevels,
                      },
                    ]
                  : []),
              ]}
            />
            {out && balance ? (
              <>
                <Flow
                  label="Energy out"
                  total={`${fmt(outKwh, 0)} kWh`}
                  parts={out}
                  scale={scale}
                />
                <Legend
                  items={out
                    .filter((p) => p.kwh >= 0.5)
                    .map((p) => ({
                      ...p,
                      sub:
                        p.key === 'driving'
                          ? drivingNote
                          : p.key === 'stored'
                            ? batteryLevels
                            : undefined,
                    }))}
                />
              </>
            ) : (
              <Flow
                label="Used driving"
                total={`${fmt(ledger.usedKwh, 0)} kWh`}
                parts={[{ key: 'used', kwh: ledger.usedKwh, color: DRIVING_COLOR }]}
                scale={scale}
                note={ledger.usedKwh > 0 ? `over ${drivingNote}` : drivingNote}
              />
            )}
          </div>

          <dl className="grid grid-cols-2 content-start gap-x-6 gap-y-5 lg:border-l lg:border-(--hairline) lg:pl-12">
            <Figure label="Charging cost" sub={perDistance}>
              {money(ledger.totalCost)}
            </Figure>
            <Figure label="Charged at home">
              {homeShare == null ? '—' : `${Math.round(homeShare * 100)}%`}
            </Figure>
            <Figure label="Home cost" sub={rate(ledger.cost.home, ledger.charged.home, money)}>
              {money(costOf('home'))}
            </Figure>
            <Figure
              label="Public cost"
              sub={rate(ledger.cost.public, ledger.charged.public, money)}
            >
              {money(costOf('public'))}
            </Figure>
          </dl>
        </div>
      </ContentFrame>
    </section>
  );
}

const rate = (cost: number | null, kwh: number, money: (n: number | null) => string) =>
  cost != null && kwh > 0 ? `${money(cost / kwh)}/kWh` : null;

/** One labelled bar, its parts laid end to end on the shared scale. */
function Flow(props: {
  label: string;
  total: string;
  parts: { key: string; kwh: number; color: string }[];
  scale: number;
  note?: string;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-4">
        <span className="text-sm text-(--text-secondary)">{props.label}</span>
        <span className="readout text-2xl font-normal">{props.total}</span>
      </div>
      <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-(--surface-2)">
        {props.parts
          .filter((p) => p.kwh > 0)
          .map((p) => (
            <span
              key={p.key}
              className="h-full transition-[width] duration-500"
              style={{ width: `${(p.kwh / props.scale) * 100}%`, background: p.color }}
            />
          ))}
      </div>
      {props.note && <div className="mt-1.5 text-xs text-(--text-muted)">{props.note}</div>}
    </div>
  );
}

function Legend(props: {
  items: { key: string; label: string; kwh: number; color: string; sub?: string }[];
}) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-(--text-muted)">
      {props.items.map((item) => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
          {item.label}
          <span className="text-(--text-secondary) tabular-nums">{fmt(item.kwh, 0)} kWh</span>
          {item.sub && <span>· {item.sub}</span>}
        </li>
      ))}
    </ul>
  );
}

function Figure(props: { label: string; sub?: string | null; children: ReactNode }) {
  const loading = useLoading();
  return (
    <div className="min-w-0">
      <dt className="eyebrow">{props.label}</dt>
      <dd className="mt-1.5 truncate text-[0.9375rem] font-medium tabular-nums">
        {loading ? <Skeleton className="w-[4em]" /> : props.children}
      </dd>
      {props.sub && <dd className="truncate text-xs text-(--text-muted)">{props.sub}</dd>}
    </div>
  );
}
