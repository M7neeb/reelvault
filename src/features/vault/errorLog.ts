/**
 * The last few hundred log lines and errors, kept in memory, so "Report a
 * problem" can send what happened. Plain JS (no native code); installLog()
 * runs once at start.
 */

type Level = 'log' | 'warn' | 'error';

const text = (x: unknown): string => {
  if (x instanceof Error) return `${x.name}: ${x.message}${x.stack ? `\n${x.stack.split('\n').slice(1, 6).join('\n')}` : ''}`;
  if (typeof x === 'string') return x;
  try {
    return JSON.stringify(x) ?? String(x);
  } catch {
    return String(x);
  }
};

const clock = (ms: number) => new Date(ms).toISOString().slice(11, 19);

export function createLog(max = 300) {
  const buf: string[] = [];
  return {
    add(level: Level, args: unknown[], at = Date.now()) {
      const tag = level === 'log' ? '' : `${level.toUpperCase()} `;
      buf.push(`${clock(at)} ${tag}${args.map(text).join(' ')}`.slice(0, 2000));
      if (buf.length > max) buf.splice(0, buf.length - max);
    },
    lines: () => [...buf],
  };
}

export const appLog = createLog();
let installed = false;

/** Copies console output and uncaught errors into appLog (they still go to the console too). */
export function installLog(): void {
  if (installed) return;
  installed = true;
  for (const level of ['log', 'warn', 'error'] as const) {
    const original = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      appLog.add(level, args);
      original(...args);
    };
  }
  const g = globalThis as { ErrorUtils?: { getGlobalHandler: () => (e: unknown, fatal?: boolean) => void; setGlobalHandler: (h: (e: unknown, fatal?: boolean) => void) => void } };
  const eu = g.ErrorUtils;
  if (eu) {
    const before = eu.getGlobalHandler();
    eu.setGlobalHandler((e, fatal) => {
      appLog.add('error', [fatal ? 'Crash:' : 'Uncaught:', e]);
      before(e, fatal);
    });
  }
}

export function reportText(r: { note: string; facts: Record<string, string>; lines: string[]; at: number }): string {
  return [
    'ReelVault problem report',
    new Date(r.at).toISOString(),
    '',
    'What happened:',
    r.note,
    '',
    ...Object.entries(r.facts).map(([k, v]) => `${k}: ${v}`),
    '',
    `Last ${r.lines.length} log lines:`,
    ...r.lines,
    '',
  ].join('\n');
}
