import { Schema } from 'effect'
import { Rule } from './direction.ts'
import type { ProposalValue } from './proposal.ts'
import { FilePath, LineNumber, Name, QuoteText, VersionNumber } from './values.ts'

const assess = FilePath.make('skills/assess/SKILL.md')
const roleFitness = FilePath.make('skills/role-fitness/SKILL.md')
const source = (file: typeof FilePath.Type, line: typeof LineNumber.Type, text: typeof QuoteText.Type) =>
  ({ _tag: 'Quote', file, lines: { first: line, last: line }, text } as const)
const fromAssess = (line: number, text: string) => source(assess, LineNumber.make(line), QuoteText.make(text))
const fromRoleFitness = (line: number, text: string) => source(roleFitness, LineNumber.make(line), QuoteText.make(text))
const checkedRule = Schema.decodeUnknownSync(Rule)
const prompt = (name: string, question: string, quote: ReturnType<typeof source>, holds: string, breaks: string) => checkedRule({
  _tag: 'Rule', name, text: question,
  verification: { _tag: 'Prompt', question, source: quote }, knownBreaks: [],
  examples: {
    holds: [{ _tag: 'MadeUp', text: holds }],
    breaks: [{ _tag: 'MadeUp', text: breaks }],
  },
})

export const proposalReviewDirection = {
  name: Name.make('Proposal review'),
  version: VersionNumber.make(1),
  rules: {
    Direction: [
      prompt('D1 Grounded', 'Does every standard and rule quote a source in the project that says it?',
        fromAssess(8, 'Keep the sources and locations for each finding'),
        'Both the standard and its rule cite docs/style.md lines 8–10, where the project requires a reason.',
        'The new rule demands a reason and gives no source for that requirement.'),
      prompt('D2 One condition', 'Can this rule fail for only one reason?',
        fromAssess(68, 'each independent validator condition to a rule'),
        'The rule only checks whether the output states a release date.',
        'The rule fails if either the release date or the maintainer name is missing.'),
      prompt('D3 Examples teach', 'Do the examples really hold and break when the question is applied to them?',
        fromAssess(48, 'The `holds` and `breaks` example lists each require a Quote or MadeUp excerpt.'),
        'For “Does this name a date?”, the holds excerpt gives 8 May and the breaks excerpt gives no date.',
        'The breaks excerpt gives 8 May and the only question asks whether the excerpt gives a date.'),
      prompt('D4 The right check', 'Is every condition a program can decide written as a Command, and only real judgment as a Prompt?',
        fromAssess(48, 'for a deterministic test'),
        'A command parses the JSON and a prompt judges whether the summary explains the decision.',
        'A prompt asks whether the JSON parses even though a parser can decide it.'),
      prompt('D5 The right scope', 'Does each standard apply only to the stages and facts its source names, and does a whole-output check sit at the stage that owns the whole output?',
        fromAssess(46, 'Where names AllStages or NamedStages and the matching context facts.'),
        'The source requires inventory totals for public catalogs and the standard checks them at Assemble catalog with Audience Public.',
        'The public catalog total is checked while writing each private inventory row.'),
      prompt('D6 Stages follow the work', 'Do the stages list the real steps, in order, each with the role doing it?',
        fromAssess(46, 'ordered stages, and standards.'),
        'Draft, verify and publish follow the project workflow and name the writer, verifier and publisher.',
        'Publishing precedes verification and the verification stage names no role.'),
      prompt('D7 Conflicts shown', 'Where two sources disagree, does the draft show both and ask the owner?',
        fromAssess(8, 'Keep conflicting sources together with the owner’s decision or open question.'),
        'The README requires JSON and the release guide requires YAML. The draft quotes both and asks which release format to use.',
        'The draft picks JSON and omits the release guide’s YAML requirement.'),
      prompt('D8 Known breaks honest', 'Are existing failures recorded as known breaks without being hidden or counted as new?',
        fromAssess(48, 'Put baseline failures in `knownBreaks` with their source locations.'),
        'The draft records the missing date already present in old.md at line 4 as a known break.',
        'The draft omits that baseline failure or attributes it to the first task under the new direction.'),
      prompt('D9 Coverage', 'Are the topics the draft leaves out named, so the owner sees the gaps?',
        fromAssess(70, 'topics covered and omitted'),
        'The draft covers format and cites deployment and localization as omitted.',
        'The draft only describes format and leaves the missing deployment and localization coverage implicit.'),
    ],
    Responsibility: [
      prompt('R1 Wide', 'Does the role say what kind of work it does as a verb and its object, as widely as possible?',
        fromRoleFitness(10, 'Identify the concrete work and output the role owns.'),
        'Write documentation covers the documentation work across products.',
        'Update the search FAQ on Tuesdays describes a single narrow assignment.'),
      prompt('R2 No method', 'Is every “how” left out of the role and placed in directions?',
        fromRoleFitness(10, 'Put the method and independent checks in the direction.'),
        'The responsibility says Maintain the release notes. The direction describes the editor and template.',
        'The role requires running a named script and editing a particular template.'),
      prompt('R3 Owns its output', 'Does it name what the role produces and is answerable for?',
        fromRoleFitness(10, 'Identify the concrete work and output the role owns.'),
        'Publish release notes. Own the published notes and corrections.',
        'Help with releases gives no output or accountability.'),
    ],
    Staffing: [
      prompt('S1 Judgment fit', 'Does each staff’s model match the judgment its roles need, with the reason stated?',
        fromRoleFitness(12, 'Compare the judgment required with the staff model and available sessions and subagents.'),
        'The draft assigns a model with strong interpretive judgment to resolving policy conflicts and explains the choice.',
        'The draft assigns the cheapest model to every role without explaining how it handles policy conflicts.'),
      prompt('S2 Honest estimate', 'Is each usage estimate backed by named evidence, or “No estimate”?',
        fromAssess(30, 'an estimate or NoEstimate'),
        'The estimate cites last week’s observed session hours for the same release workload.',
        'The draft says to expect 35% usage and gives no source or observation.'),
    ],
  },
} as const

export const proposalReviewRules = (kind: ProposalValue['_tag']): readonly typeof Rule.Type[] =>
  proposalReviewDirection.rules[kind]
