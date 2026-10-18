import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { LogBacklogDto } from '@server/api-types';
import { Dot } from '../../components/Dot';
import { SegmentedControl, secondaryButton } from './SettingsControls';
import {
  type LogEntryDto,
  type LogLevelName,
  appendLogs,
  errorText,
  filterLogs,
  inlineFields,
  logText,
} from './logs';

const LEVEL_OPTIONS: { value: LogLevelName; label: string }[] = [
  { value: 'debug', label: 'All' },
  { value: 'info', label: 'Info' },
  { value: 'warn', label: 'Warnings' },
  { value: 'error', label: 'Errors' },
];

const LEVEL_COLOR: Record<LogLevelName, string> = {
  trace: 'var(--text-muted)',
  debug: 'var(--text-muted)',
  info: 'var(--accent)',
  warn: 'var(--status-warning)',
  error: 'var(--status-critical)',
  fatal: 'var(--status-critical)',
};

/** Live server log: what `docker compose logs` shows, without a terminal. */
export function LogsSection(props: {
  /** The server's LOG_LEVEL, once the stream reports it. */
  onServerLevel: (level: string) => void;
}) {
  const [entries, setEntries] = useState<readonly LogEntryDto[]>([]);
  const [connected, setConnected] = useState(false);
  const [level, setLevel] = useState<LogLevelName>('debug');
  const [query, setQuery] = useState('');

  const { onServerLevel } = props;
  useEffect(() => {
    const source = new EventSource('/api/logs/stream');
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);
    source.addEventListener('backlog', (event) => {
      const backlog = JSON.parse((event as MessageEvent).data) as LogBacklogDto;
      onServerLevel(backlog.level);
      // A reconnect after a restart starts the count again: replace, don't append.
      setEntries((held) =>
        (backlog.entries.at(-1)?.seq ?? 0) < (held.at(-1)?.seq ?? 0)
          ? backlog.entries
          : appendLogs(held, backlog.entries),
      );
    });
    source.addEventListener('log', (event) => {
      const entry = JSON.parse((event as MessageEvent).data) as LogEntryDto;
      setEntries((held) => appendLogs(held, [entry]));
    });
    return () => source.close();
  }, [onServerLevel]);

  const shown = useMemo(() => filterLogs(entries, level, query), [entries, level, query]);

  // Follow new lines while scrolled to the bottom, like a terminal.
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [shown]);

  const download = () => {
    const blob = new Blob([entries.map(logText).join('\n') + '\n'], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rivianmate-${new Date().toISOString().slice(0, 19).replace(/:/g, '')}.log`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusColor = connected ? 'var(--status-good)' : 'var(--status-warning)';

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl label="Level" value={level} options={LEVEL_OPTIONS} onChange={setLevel} />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter"
          aria-label="Filter log lines"
          className="min-w-0 flex-1 basis-40 rounded-md border border-(--border) bg-(--surface-1) px-3 py-1.5 text-sm placeholder:text-(--text-muted) focus:outline-2 focus:outline-(--accent)"
        />
        <button
          type="button"
          className={secondaryButton}
          onClick={download}
          disabled={!entries.length}
        >
          Download
        </button>
      </div>

      <section aria-label="Log lines" className="card overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-(--border) px-4 py-2 text-xs text-(--text-muted)">
          <span className="flex items-center gap-2" style={{ color: statusColor }}>
            <Dot color={statusColor} pulse={connected} />
            {connected ? 'Live' : 'Reconnecting…'}
          </span>
          <span>
            {shown.length === entries.length
              ? `${entries.length.toLocaleString()} lines`
              : `${shown.length.toLocaleString()} of ${entries.length.toLocaleString()} lines`}
          </span>
        </div>
        <div
          ref={scroller}
          onScroll={(e) => {
            const el = e.currentTarget;
            atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
          className="h-[32rem] overflow-y-auto py-2 font-mono text-xs leading-5"
        >
          {shown.length === 0 ? (
            <p className="px-4 py-6 text-center font-sans text-sm text-(--text-muted)">
              {entries.length
                ? 'No lines match.'
                : connected
                  ? 'Nothing logged yet.'
                  : 'Connecting…'}
            </p>
          ) : (
            shown.map((entry) => <LogLine key={entry.seq} entry={entry} />)
          )}
        </div>
      </section>
    </>
  );
}

function LogLine(props: { entry: LogEntryDto }) {
  const { entry } = props;
  const fields = inlineFields(entry);
  const err = errorText(entry);
  const time = new Date(entry.time);
  return (
    <div className="px-4 hover:bg-(--surface-2)">
      <div className="break-words">
        <time dateTime={entry.time} title={time.toLocaleString()} className="text-(--text-muted)">
          {time.toLocaleTimeString([], { hour12: false })}
        </time>{' '}
        <span className="font-semibold uppercase" style={{ color: LEVEL_COLOR[entry.level] }}>
          {entry.level}
        </span>{' '}
        {entry.component && <span className="text-(--text-secondary)">[{entry.component}] </span>}
        <span className="text-(--text-primary)">{entry.msg}</span>
        {fields && <span className="text-(--text-muted)"> {fields}</span>}
      </div>
      {err && (
        <pre className="mb-1 overflow-x-auto whitespace-pre-wrap break-words pl-4 text-(--status-critical)">
          {err}
        </pre>
      )}
    </div>
  );
}
