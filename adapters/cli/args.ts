// The command line, decoded once, with the rules that belong to the adapter (BUILD.md N3 and the
// CLI forms of finding I4). The words, the --flags in their order (a
// --breaks pairs with the --point before it), and the words that look like a flag but are not
// one. The command name is NOT in `positional` after withoutName; the token (a7.<secret>) is
// taken out of it wherever it stands, so a command reads its words without the token.
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

// The words of a flag, or undefined when the flag is absent, bare or blank (I4: a blank flag value
// counts as absent).
export const textOf = (value: string | true | undefined): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value : undefined

// The words of a flag as typed, blank ones too: the action refuses blank words with a Write choice.
export const wordsOf = (value: string | true | undefined): string =>
  typeof value === 'string' ? value : ''

// The token as the CLI reads it: a7.<secret>.
export const isToken = (word: string | undefined): word is string => /^a\d+\./.test(word ?? '')

// N3: the first token wherever it stands among the words, taken out of them.
export const takeToken = (
  words: ReadonlyArray<string>,
): { readonly token: string | null; readonly rest: ReadonlyArray<string> } => {
  const at = words.findIndex((w) => isToken(w))
  return at < 0
    ? { token: null, rest: words }
    : { token: words[at] ?? null, rest: words.filter((_, i) => i !== at) }
}

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
    revise: ['file', 'answers', 'why', 'why-words', 'by'],
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
  role: {
    fit: ['answers', 'as', 'by'],
    draft: ['file', 'by'],
    accept: [],
    reject: ['reason'],
    list: [],
    show: [],
  },
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
  run: { start: [], continue: ['quote'], done: [], close: [], list: [] },
  session: ['id', 'token'],
  problem: ['says', 'fixed'],
  event: ['kind', 'text', 'tries'],
  send: ['text'],
  wait: ['by', 'seconds'],
}

// The flags that stand alone, with no value.
export const SWITCHES: ReadonlyArray<string> = ['dry-run', 'token', 'fixed']

// The word that names the act of a command with several acts.
const first = (words: ReadonlyArray<string>) => words[0]
type ActOf = (words: ReadonlyArray<string>) => string | undefined
export const ACT_OF: Readonly<Record<string, ActOf>> = {
  task: first,
  direction: first,
  role: first,
  evaluation: first,
  run: first,
  review: (words) => words.find((w) => w === 'accept' || w === 'reject'),
  forward: (words) => words[1],
}

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
  '         work direction revise [<token>] <direction> --file=<edit.yaml> [--by=<model run>] (a model drafts a change of a direction)',
  '         work role fit <role> --answers=<file> --by=<model run> (the host that drafted the roles records their fits)',
  '         work role draft [<token>] <role> --file=<words.yaml> [--by=<model run>] (new words of a role; the person accepts or rejects them)',
  "         work start --detach | run start | run continue <run> --quote=<the person's words> (the host, in its own tmux pane)",
  '         work wait <token> | wait --by=<run> [--seconds=<n>] (when you have nothing to do:',
  '         it blocks until you have work, then prints your next steps)',
  'read:    work status | waiting [--for=<who>] | blockers <result> | task show|tree <task> | evaluation show <ev>',
  '         work direction show <id>[@<n>][#<standard|rule|header>]|<draft> | role list|show <role> | log [--last=<n>]',
  '         work assignment show <a>',
  '         work question show <q> | result show <r> | search <words> (aristoteles)',
  '         work config check (the draft of the roles, as Accept the roles on the page would store it; it writes nothing)',
  '         work guide writing|direction-review|decision-words|roles|limits (how to write a direction, how to review one, the words of a decision, the checks of the roles, and the action when work passes a limit)',
  'person:  work start (the UI of this dir, in the browser) | work init | config apply|restore | task open|split|close | assign <task> --role=<role>',
  '         grant --act=approve|review|change --on=<ids> --to=<role> --until=<time> | revoke <x>',
  '         confirm <event> | answer <q> --text=<t> | review <r> reject ... (after its deciders accept it)',
  '         resolve <escalation> --resolution= | review <t> reject ... | review <draft>|<ev> accept --evidence= | reject --reason=',
  '         suggest [<direction|standard|rule>] --says= (a high role writes the draft) | free|finish <a>',
  '         evaluate <stop>|<task> --wrong= --why= --improve= --level= | role fit <role> --answers=<file>',
  '         role show <draft> | role accept <draft> | role reject <draft> --reason= (new words of a role)',
]

// Every command, so that a name with no command is "unknown".
export const COMMAND_NAMES = [
  'init',
  'config',
  'role',
  'run',
  'problem',
  'event',
  'send',
  'session',
  'status',
  'waiting',
  'blockers',
  'next',
  'log',
  'search',
  'guide',
  'question',
  'result',
  'assignment',
  'evaluation',
  'task',
  'assign',
  'free',
  'finish',
  'brief',
  'report',
  'review',
  'recheck',
  'escalate',
  'resolve',
  'ask',
  'answer',
  'note',
  'evaluate',
  'checkpoint',
  'resume',
  'source',
  'direction',
  'suggest',
  'grant',
  'revoke',
  'forward',
  'confirm',
  'wait',
] as const
export type CommandName = (typeof COMMAND_NAMES)[number]
export const isCommandName = (word: string): word is CommandName =>
  (COMMAND_NAMES as ReadonlyArray<string>).includes(word)
