// The command line, decoded once: the words, the --flags in their order (a --breaks belongs to the
// --point before it), and the words that look like a flag but are not one. The command name is NOT
// in `positional`: runCli takes it off first, so a command reads positional[0] as its act word.
export interface Args {
  readonly positional: ReadonlyArray<string>
  // In order; a flag with no value is true (only a switch may be bare).
  readonly flags: ReadonlyArray<readonly [key: string, value: string | true]>
  readonly broken: ReadonlyArray<string>
  // The last value of a flag, and every value of a flag.
  readonly one: (key: string) => string | true | undefined
  readonly all: (key: string) => ReadonlyArray<string | true>
}

// --key=value flags keep their order; the s flag lets a value hold a newline.
export const parseArgs = (argv: ReadonlyArray<string>): Args => {
  const positional: Array<string> = []
  const flags: Array<readonly [string, string | true]> = []
  // A word that starts with -- but is no flag, such as --max_attempts=1.
  const broken: Array<string> = []
  for (const arg of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/s.exec(arg)
    if (m) flags.push([m[1] ?? '', m[2] ?? true])
    else if (arg.startsWith('--')) broken.push(arg)
    else positional.push(arg)
  }
  return {
    positional,
    flags,
    broken,
    one: (key) => flags.findLast(([k]) => k === key)?.[1],
    all: (key) => flags.filter(([k]) => k === key).map(([, v]) => v),
  }
}

// The words of a flag, or undefined when the flag is absent or bare.
export const textOf = (value: string | true | undefined): string | undefined =>
  typeof value === 'string' ? value : undefined

// The same words with the command name taken off the front.
export const withoutName = (args: Args): Args => ({ ...args, positional: args.positional.slice(1) })

type FlagTable = ReadonlyArray<string> | Readonly<Record<string, ReadonlyArray<string>>>

// The flags that each command reads, for each of its acts where it has several. Any other flag
// is a mistake (a typo, or a flag of another act), so the command is refused before it stores
// anything.
export const FLAGS: Readonly<Record<string, FlagTable>> = {
  task: {
    open: ['file'],
    draft: ['file', 'by'],
    split: ['file', 'review'],
    close: ['reason'],
    remake: ['file', 'reason', 'review'],
    show: [],
    tree: [],
    describe: ['text'],
  },
  direction: {
    new: ['file', 'answers', 'why', 'why-words', 'by'],
    revise: ['file', 'answers', 'why', 'why-words'],
    show: [],
  },
  review: { accept: ['evidence', 'reason'], reject: ['point', 'breaks', 'reason'] },
  // A resolve is its own act: it accepts and rejects nothing.
  resolve: ['resolution', 'evidence'],
  forward: {
    reject: ['point', 'breaks', 'quote', 'channel'],
    accept: ['evidence', 'reason', 'quote', 'channel'],
    resolve: ['evidence', 'quote', 'channel'],
    ask: ['quote', 'channel'],
    answer: ['quote', 'channel'],
    comment: ['quote', 'channel'],
  },
  role: { fit: ['answers', 'as', 'by'], list: [], show: [] },
  assign: ['dry-run', 'max-attempts', 'role'],
  report: ['made-from', 'output'],
  recheck: ['reason'],
  escalate: ['reason', 'result'],
  ask: ['text', 'to'],
  answer: ['text'],
  note: ['text', 'on', 'hope'],
  suggest: ['says'],
  waiting: ['for'],
  search: [],
  guide: [],
  log: ['last'],
  grant: ['act', 'on', 'to', 'until'],
  checkpoint: ['next'],
  evaluate: ['improve', 'level', 'why', 'wrong'],
  evaluation: { show: [] },
  run: { start: ['session'], done: [], close: [], list: [] },
  session: ['id', 'token'],
  problem: ['says', 'fixed'],
  event: ['kind', 'text', 'tries'],
  send: ['text'],
}

// The flags that stand alone, with no value.
export const SWITCHES: ReadonlyArray<string> = ['dry-run', 'token', 'fixed']

// The word that names the act of a command with several acts.
const first = (words: ReadonlyArray<string>) => words[0]
type ActOf = (words: ReadonlyArray<string>) => string | undefined
export const ACT_OF: Readonly<Record<string, ActOf>> =
  {
    task: first,
    direction: first,
    role: first,
    evaluation: first,
    run: first,
    review: (words) => words.find((w) => w === 'accept' || w === 'reject'),
    forward: (words) => words[2],
  }

// The commands whose token sits after the act word (work task open <token> ...).
export const TOKEN_AFTER_ACT: ReadonlyArray<string> = [
  'task',
  'direction',
  'role',
  'evaluation',
  'run',
]

// The flags that a call may carry: undefined when the command takes any flag of no table.
export const knownFlags = (
  name: string,
  act: string | undefined,
): ReadonlyArray<string> | undefined => {
  if (!Object.hasOwn(FLAGS, name)) return undefined
  const table = FLAGS[name]
  if (Array.isArray(table)) return table
  if (act === undefined || table === undefined || !Object.hasOwn(table, act)) return undefined
  return (table as Readonly<Record<string, ReadonlyArray<string>>>)[act]
}

export const USAGE: ReadonlyArray<string> = [
  'work - code and document work under review. Agents pass their token first; a person runs',
  'commands with no token at a terminal.',
  '',
  'agents:  work brief <token>   (your brief lists the commands that you may run)',
  '         work next <token> | report | review | resolve | escalate | ask | answer | recheck | forward ...',
  '         work direction new [<token>] --file=<direction.yaml> [--by=<model run>] (a model drafts a new direction)',
  '         work role fit <role> --answers=<file> --by=<model run> (the host that drafted the roles records their fits)',
  'read:    work status | waiting [--for=<who>] | blockers <result> | task show|tree <task> | evaluation show <ev>',
  '         work direction show <id>[@<n>][#<standard|rule|header>]|<draft> | role list|show <role> | log [--last=<n>]',
  '         work assignment show <a>',
  '         work question show <q> | result show <r> | search <words> (aristoteles)',
  '         work config check (the draft of the roles, as Accept the roles on the page would store it; it writes nothing)',
  '         work guide writing|direction-review|decision-words|roles (how to write a direction, how to review one, the words of a decision, and the checks of the roles)',
  'person:  work start (the UI of this dir, in the browser) | work init | config apply|restore | task open|split|close | assign <task> --role=<role>',
  '         grant --act=approve|review|change --on=<ids> --to=<role> --until=<time> | revoke <x>',
  '         confirm <event> | answer <q> --text=<t> | review <r> reject ... (after its deciders accept it)',
  '         resolve <escalation> --resolution= | review <t> reject ... | review <draft>|<ev> accept --evidence= | reject --reason=',
  '         suggest [<direction|standard|rule>] --says= (a high role writes the draft) | free|finish <a>',
  '         evaluate <stop>|<task> --wrong= --why= --improve= --level= | role fit <role> --answers=<file>',
]
