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
  argv.forEach((arg, i) => {
    // The basis of a step is printed as `--on <n>`: the number after it is its value.
    const m = /^--([a-z-]+)(?:=(.*))?$/s.exec(arg)
    if (arg === '--on' && /^\d+$/.test(argv[i + 1] ?? '')) flags.push(['on', argv[i + 1] ?? ''])
    else if ((arg === '--launch' || arg === '--context') && argv[i + 1] && !argv[i + 1]!.startsWith('-')) {
      flags.push([arg.slice(2), argv[i + 1]!])
    }
    else if ((argv[i - 1] === '--launch' || argv[i - 1] === '--context') && !arg.startsWith('-')) return
    else if (i > 0 && argv[i - 1] === '--on' && /^\d+$/.test(arg)) return
    else if (m) flags.push([m[1] ?? '', m[2] ?? true])
    else if (arg.startsWith('--')) broken.push(arg)
    else positional.push(arg)
  })
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

// The token as the CLI reads it: w.<actor>.<epoch>.<secret>. A word of the old form a7.<secret>
// counts too, so that a command refuses it by name.
export const isToken = (word: string | undefined): word is string =>
  /^a\d+\./.test(word ?? '') || /^w\..+\.\d+\.[a-z0-9]+$/.test(word ?? '')

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
  direction: {
    new: ['file', 'answers', 'why', 'why-words', 'by'],
    revise: ['file', 'answers', 'why', 'why-words', 'by'],
    examples: ['file', 'by'],
    accept: [],
    reject: ['reason'],
    show: [],
  },
  role: { fit: ['answers', 'by'], list: [], show: [] },
  assign: [],
  brief: [],
  resume: [],
  reassign: [],
  'top-done': [],
  report: ['output', 'files', 'on'],
  // The acts of the work model (adapters/cli/commands/acts.ts): --on is the basis of the step.
  review: ['points', 'on'],
  accept: ['on'],
  'send-back': ['points', 'on'],
  reject: ['points', 'on'],
  decide: ['on'],
  advance: ['on'],
  rule: ['on', 'fights'],
  'rule-test': ['on'],
  ship: ['on', 'resolves'],
  loop: ['mode', 'on'],
  recheck: ['items', 'on', 'job', 'report'],
  'recheck-helper': { ack: [] },
  'recheck-report': ['file'],
  'recheck-brief': ['on'],
  top: { open: ['name', 'goal', 'sections', 'context'] },
  hook: { stopped: [] },
  ask: ['question', 'text', 'file'],
  answer: ['text', 'file'],
  hear: [],
  'ask-raise': [],
  respond: ['on', 'points'],
  'ask-edit': ['on', 'file'],
  status: ['kind', 'text', 'by'],
  search: [],
  guide: [],
  log: ['last'],
  evaluate: ['summary', 'parts', 'role-draft', 'on'],
  run: { continue: [] },
  send: ['name', 'goal', 'sections', 'role', 'context'],
  wait: ['by', 'seconds', 'launch'],
  worker: { checkpoint: ['credential'], wait: ['seconds', 'abandon'], ack: [], 'child-start': [], 'child-reconcile': ['observation'],
    'child-review': ['on', 'turn'], 'child-ack': [], 'child-review-done': [] },
  activation: { ack: [], resume: [], relaunch: [], rollback: [] },
  forward: {
    end: ['quote'],
    answer: ['text', 'file', 'quote'],
    respond: ['on', 'points', 'quote'],
    'ask-edit': ['on', 'file', 'quote'],
    accept: ['on', 'quote'],
    'send-back': ['points', 'on', 'quote'],
    reject: ['points', 'on', 'quote'],
    decide: ['on', 'quote'],
  },
  // Onboarding, before the store (BUILD.md 1e): the host's acts, then the person's.
  onboard: {
    config: ['file'],
    role: ['file'],
    found: [],
    draft: ['file', 'revision'],
    discovery: ['file'],
    removed: [],
    ask: ['file'],
    company: ['repo', 'path'],
    status: [],
    show: [],
    wait: ['seconds'],
    add: ['principle', 'example', 'url'],
    answer: ['options', 'words', 'revision'],
    accept: [],
    revise: ['words'],
    remove: [],
    'approve-directions': [],
    'accept-role': [],
    'revise-role': ['words'],
    'remove-role': [],
    persistence: ['persistent'],
    'approve-roles': [],
  },
  skill: { install: [] },
}

// The flags that stand alone, with no value.
export const SWITCHES: ReadonlyArray<string> = ['resolves', 'abandon']

// The word that names the act of a command with several acts.
const first = (words: ReadonlyArray<string>) => words[0]
type ActOf = (words: ReadonlyArray<string>) => string | undefined
export const ACT_OF: Readonly<Record<string, ActOf>> = {
  activation: first,
  worker: first,
  'recheck-helper': first,
  top: first,
  hook: first,
  direction: first,
  run: first,
  role: first,
  onboard: first,
  skill: first,
  forward: first,
}

// The flags that a call may carry: undefined when the command takes any flag of no table.
export const knownFlags = (
  name: string,
  act: string | undefined,
): ReadonlyArray<string> | undefined => {
  if (!Object.hasOwn(FLAGS, name)) return undefined
  const table = FLAGS[name]
  if (Array.isArray(table)) return table.includes('on') || ['ask', 'answer', 'hear', 'send', 'assign', 'brief', 'ask-raise', 'resume', 'reassign', 'top-done'].includes(name)
    ? [...table, 'on', 'turn'] : table
  if (act === undefined || table === undefined || !Object.hasOwn(table, act)) return undefined
  return (table as Readonly<Record<string, ReadonlyArray<string>>>)[act]
}

export const USAGE: ReadonlyArray<string> = [
  'work - code and document work under review. Agents pass their token first; a person runs',
  'commands with no token at a terminal.',
  '',
  'setup:   work skill install (links the /aristoteles skill in this dir, out of git; no aristoteles.yaml needed)',
  'host:    work onboard config --file=<draft.yaml> | role <role> --file=<role.yaml> (the config draft, and one role)',
  '         work onboard found <id> | draft <id> --file=<direction.yaml> [--revision=<id>] | ask <id> --file=<questions.yaml>',
  '         work onboard discovery --file=<scope.yaml> | removed <id>',
  '         work onboard company <id> --repo=<repo> --path=<folder> | status | show <id>|<role> | wait [--seconds=<n>]',
  '         (onboarding works on files before any store; it stores nothing until approve-roles)',
  'agents:  work wait <token> (when you have nothing to do: it blocks until you have a step, then prints it)',
  '         the step names its own command, with --on <n> where it has a basis; after an act run work wait again',
  '         work send <token> --name= --goal= --sections=a,b --role=<role> | reassign <token> | ' +
    'top-done <token>',
  '         work assign <token> <task> | review <token> <ask-id> ' +
    'pass|fail|raise-tries|raise-no-rule|raise-misses --points= --on=',
  '         work resume <token> <maker> | brief <token> | report <token> <ask-id> --output= --files=a,b ' +
    '--on=',
  '         work evaluate <token> <task> split|fit|principle|direction|standard --summary= ' +
    '[--parts=<file>] [--role-draft=<file>] --on=',
  '         work advance <token> <fix> | rule <token> <fix> <rule-file> [--fights=rule:a,rule:b] | rule-test <token> ' +
    '<fix> | ship <token> <fix> <draft-file> [--resolves]',
  '         work loop <token> <fix> person|revise --mode=<mode> | recheck <token> <task> holds|fails --items=<id,id,...> (each ' +
    'with --on=<n>)',
  '         work recheck-brief <task> [--on=<n>] (read the exact required items and their versions)',
  '         work ask <token> <actor> --text=<question> | --file=<question.yaml>',
  '         work answer <token> <ask-id> --text=<answer> | --file=<answer.yaml>',
  '         work hear <token> <ask-id> | ask-raise <token> <actor>',
  '         work direction new [<token>] --file=<direction.yaml> [--by=<model run>] (a model drafts a new direction)',
  '         work direction revise [<token>] <direction> --file=<edit.yaml> [--by=<model run>] (a model drafts a change of a direction)',
  '         work direction examples [<token>] <draft> --file=<flow.yaml> [--by=<model run>] (the flow of a company draft and the cases of its rules: { flow, rules: { <rule id>: <evidence> } }, before its accept)',
  '         work direction accept <draft> | reject <draft> --reason=<why> (the owner, before a top is open)',
  '         work role fit <role> --answers=<file> --by=<model run> (the host that drafted the roles records their fits)',
  '         work source <token> <source>@<revision> (a source of the project is read again)',
  '         work run continue (the host, in its own tmux pane)',
  'status:  work status set --kind=working|thinking|applied|feedback|waiting --text=<words> [<token>|--by=<run>] (the AI on the dir pages)',
  'read:    work direction show <id>[@<n>][#<standard|rule|header>]|<draft> | log [--last=<n>]',
  '         work search <words> (aristoteles) | config check (the config draft merged into aristoteles.yaml; it writes nothing)',
  '         work guide writing|direction-review|roles|limits',
  'onboard: work onboard add --principle=<words> [--example=<words>] | add --url=<repo#folder>',
  '         work onboard answer <id> --revision=<id> (--options=A,B,... or --words=<words>) | revise <id> --words=<words>',
  '         work onboard approve-directions | accept-role <role> | revise-role <role> --words=<words> | remove-role <role>',
  '         work onboard persistence <role> --persistent=true|false | approve-roles (the store starts with the accepted result)',
  'person:  work init | config apply|restore | top open --name= --goal= --sections=a,b',
  '         respond <ask-id> accept|send-back|take|again [--points=] --on=',
  '         reject <task> --points= --on= | ask-edit --file=<edit.yaml> --on=',
  '         answer <ask-id> --text=<answer> | --file=<answer.yaml> | end',
  '         role fit <role> --answers=<file> (the fit of a role)',
]

// Every command, so that a name with no command is "unknown".
export const COMMAND_NAMES = [
  'activation',
  'worker',
  'init',
  'config',
  'role',
  'run',
  'send',
  'status',
  'log',
  'search',
  'guide',
  'assign',
  'brief',
  'report',
  'review',
  'recheck',
  'recheck-helper',
  'recheck-report',
  'recheck-brief',
  'ask',
  'answer',
  'hear',
  'ask-raise',
  'respond',
  'ask-edit',
  'evaluate',
  'resume',
  'end',
  'accept',
  'send-back',
  'reject',
  'decide',
  'reassign',
  'top-done',
  'advance',
  'rule',
  'rule-test',
  'rule-run',
  'ship',
  'loop',
  'top',
  'hook',
  'source',
  'direction',
  'forward',
  'wait',
  'onboard',
  'skill',
] as const
export type CommandName = (typeof COMMAND_NAMES)[number]
export const isCommandName = (word: string): word is CommandName =>
  (COMMAND_NAMES as ReadonlyArray<string>).includes(word)
