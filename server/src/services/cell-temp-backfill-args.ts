/**
 * The backfill CLI's arguments, in their own module so they can be tested
 * without executing the job.
 */

export interface BackfillArgs {
  vehicleId?: string;
  from?: Date;
  to?: Date;
  dryRun?: boolean;
  reset?: boolean;
  batchHours?: number;
}

const USAGE =
  'usage: backfill-cell-temps [--vehicle <id>] [--from <ISO>] [--to <ISO>] ' +
  '[--dry-run] [--reset] [--batch-hours <n>]\n';

/** A date argument, rejected rather than silently becoming an Invalid Date. */
function dateArg(arg: string, value: string): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error(`${arg} is not a date: ${value}`);
  return date;
}

/** Parses the command line. Exported so it can be tested without running the job. */
export function parseArgs(argv: readonly string[]): BackfillArgs {
  const args: BackfillArgs = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]!;
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined) throw new Error(`${arg} needs a value`);
      i += 1;
      return v;
    };
    switch (arg) {
      case '--vehicle':
        args.vehicleId = value();
        break;
      case '--from':
        args.from = dateArg(arg, value());
        break;
      case '--to':
        args.to = dateArg(arg, value());
        break;
      case '--batch-hours': {
        const hours = Number(value());
        if (!Number.isInteger(hours) || hours < 1) {
          throw new Error(`${arg} takes a whole number of hours, at least 1`);
        }
        args.batchHours = hours;
        break;
      }
      case '--dry-run':
        args.dryRun = true;
        break;
      case '--reset':
        args.reset = true;
        break;
      case '--help':
      case '-h':
        process.stdout.write(USAGE);
        process.exit(0);
        break;
      default:
        throw new Error(`unknown argument ${arg}\n${USAGE}`);
    }
  }
  if (args.from && args.to && args.from >= args.to) {
    throw new Error('--from must be before --to');
  }
  return args;
}
