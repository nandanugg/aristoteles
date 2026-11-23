// What several commands share: the form of a flow in each template that asks for one.

// The flow: key of a file, in each template that asks for a flow (Nanda, 2026-11-15). The cases
// live on the rules (pass 3b): RULE_EVIDENCE_FORM. A template indents it under its own first line.
export const FLOW_FORM = `flow:   # how it works, from the first act of an actor down to the output
  - { from: <an actor>, to: <an actor, or the file that it acts on>, says: <what happens, in one plain line>, place: { file: <path>, line: <n> } }   # place: only where the project defines the step; line: only with its file
  - from: <an actor>   # a step that the direction governs: mark it; its cases go on the rules it uses
    to: <an actor, or the file that it acts on>
    says: <what happens>
    uses: [<the ids that apply there: the direction's id, standard ids, rule ids>]`
// A rule's evidence (one format, onboarding and after): the rules each marked step uses hold, between
// them, a case that follows and one that breaks.
export const RULE_EVIDENCE_FORM = `evidence:
  scope: { searched: [<paths searched>], unknown: [<areas not searched>] }
  check: { _tag: Absent }   # or Command { result }, Reference { checker, result }, Unknown { question }
  knownBreaks: []   # places that break it today: { file, line, excerpt }
  cases:
    - fit: Follows | Breaks   # the output follows the rule, or breaks it
      input: { file: <path>, line: <n>, excerpt: <a short part of it> }   # only for a step that checks or decides
      output: { file: <a real result>, line: <n>, excerpt: <a short part of it as it is now> }
    - { fit: Breaks, output: { written: <the output in your words, when the project has none> } }`
