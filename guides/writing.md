# Writing a direction for aristoteles

A direction, each of its standards, and each rule are separate entries in aristoteles. SQL links
them: a rule belongs to a standard, and a standard to a direction. The words of each entry are
any markdown. A model reads an entry in pieces: a brief gives the first paragraph of a rule and
the address of each header inside it, and a model reads one piece with
`work direction show <direction>@<version>#<entry>#<header>`. Write each entry so that one piece
is enough for the model that reads only that piece.

## The three entries

- **Direction**: what the work is for, and what matters most. One idea.
- **Standard**: how the output looks. A standard follows from the words of its direction. A
  standard that its direction does not say needs a change of the direction first.
- **Rule**: one check that a reviewer can do on one result of a maker (its output form in
  `aristoteles.yaml`). One rule is one check, and it carries its evidence: a `test` (a command;
  no output means the result holds, each printed line is a point) and/or a `ref`
  (`file#anchor:lines`). The role that checks it is in the draft (`checkedBy`), or, for a
  company direction, in `aristoteles.lock`.
- `from` names the one or two principles that ground the direction: the ones whose question it
  answers.
  - Logos: can we explain the requirement and its reasoning?
  - Pathos: can the human understand the work, the result, and the trade-offs?
  - Ethos: which tests and checks support this result?
  - Mythos: do our code patterns still fit the company direction?
  - Oikos: how does the team work, review, and argue together?
  - Nomos: which policies and ways of working control the action?
  - Telos: which purpose has the human accepted, and should it change?
  - Kairos: can the work pause and continue in another session or model?
  - Mnēmē: which past attempts and lessons must we keep, with their evidence?
  - Topoi: how can a later task find past lessons, and see if they changed?
  - Aporia: which questions are not answered, and which decisions need the answers?

## The summary

A direction starts with a summary (`summary:` in its file): one or two plain sentences that say
what the direction asks and why it matters, for a person who reads it the first time. The page and
`work direction show` show it before the words. Use plain words: no ids, no file paths, no names
of rules. A draft with no summary is refused. A revise may change it (`summary:` in the edit).

## The flow

A direction has a flow (`flow:` in its file): how it works in the project, from the first act of an
actor down to the output. The page draws it as a sequence diagram under the summary, and
`work direction show` prints it as numbered lines.

- Each step is one act: `from` acts, `to` is the actor or the file that it acts on, and `says` is
  what happens, in one plain line. A step from an actor to the same actor is an act on its own.
- The first step starts the direction; the last step makes or checks the output.
- `place` names where the project defines the step: its `file`, and a `line` in that file. They
  carry the sources, so the words of the direction do not say where it comes from.
- Name each actor the same way in each step; the lifelines are the actors in the order that they
  first appear.
- `uses` marks a step that the direction governs: the ids that apply there (the direction id,
  standard ids, rule ids). The cases that show it followed and broken live on those rules (see
  Cases), never on the step. A flow marks at least one step; the page colors the marked ones.

```yaml
flow:
  - { from: Person, to: architect, says: asks for a TSD of the export feature }
  - { from: architect, to: writer, says: gives each section to a writer, place: { file: CLAUDE.md, line: 12 } }
  - { from: writer, to: writer, says: reads the rule of one heading for each section, place: { file: .claude/skills/writer/SKILL.md, line: 30 } }
  - from: writer
    to: docs/tsd/export.md
    says: fills the template one section at a time
    place: { file: docs/templates/tsd.md, line: 1 }
    uses: [tsd-writing, one-topic]
```

A revise may change the flow (`flow:` in the edit gives the whole new flow).

## Cases

A rule holds its cases in its `evidence` (one format, onboarding and after): what was searched
(`scope`), how it is checked (`check`), the places that break it today (`knownBreaks`), and its
`cases`: outputs that follow it and outputs that break it. The rules each marked step uses hold,
between them, at least one case that follows and one that breaks. A case gives its output, and
the input it answers when there is one: the instruction or file the maker or checker received
(the two cases of a pair share it). A sample is
real (a file, a line, a short excerpt of the file as it is today; stale when the excerpt leaves
the file) or, when the project has none, written: `{ written: <the output> }` (labelled
illustrative on the page).

```yaml
      - id: one-topic
        says: A section keeps to one topic.
        evidence:
          scope: { searched: [docs/tsd], unknown: [] }
          check: { _tag: Absent }
          knownBreaks: []
          cases:
            - { fit: Follows, output: { file: docs/tsd/export.md, line: 7, excerpt: "## Design" } }
            - { fit: Breaks, output: { written: "## Design and rollout" } }
```

Use `replace` in a revise to update the evidence of an existing rule. When
the person accepts an evidence-only draft, `work direction show <id>`
shows the updated cases. Numbered versions keep the evidence they were
made with.

## Write for contextual retrieval

- The first paragraph of an entry says the whole entry. A brief shows only that paragraph and
  the list of headers.
- The text under each header stands alone. Name the subject again; do not write "as above",
  "this one", or "the previous".
- One topic under one header. The name of a header says its topic: Why, Examples, Exceptions,
  How to check.
- Put each example under the header that it belongs to, near the words that it shows.
- In a rule, the check is the first sentence. The reasons and the examples go under headers.
- Use the words that the work uses: the names of files, commands, fields, and flags. A search
  (`work search <words>`) finds entries by these words.

## Write for any model

- Name no AI model and no AI vendor. Write no "you are an AI". The names of the tools of the
  work (for example Consul, Unleash, Kafka) are the words of the work: use them.
- Use concrete words: the exact output, file, field, or command. Avoid vague verbs (handle,
  manage, ensure, properly, clean).
- One reading only. When a sentence can mean two things, write two sentences.
- Say what is. Avoid "not X but Y": write Y.
- Say each thing once, in one entry.

## Where the words go

- A new direction, from a model that is not in the pipeline (the host, `assess`):
  `work direction new [<token>] --file=<direction.yaml> [--by=<model run>]`. The file holds the
  whole direction; `says: |` holds markdown. `work direction new` with no file prints its form.
  The owner accepts it with `work direction accept <draft>`, or rejects it with
  `work direction reject <draft> --reason=<why>`, before a top task is open.
- A change of a direction: `work direction revise [<token>] <direction> --file=<edit.yaml>`.
  The file adds, replaces, or removes standards.
- A change that the pipeline role makes after a raised task: it writes a draft file, a map from
  item keys (`dir:<id>`, `std:<id>`, `rule:<id>`) to the whole record (`says`, `where`, `test`,
  `ref`, `examples`), or `null` to remove one. It sends it with
  `work ship <token> <fix> <file> --on <n>`. Use `work ask-edit --file=<edit.yaml> --on <n>`
  for the person's edit while a top is open.
  An example is `{ fits: follows|breaks, sample: <text> }`. A test must print lines on each
  `breaks` sample and none on a `follows` sample, of its own rule and of the other rules of
  the direction.
- A company direction: a folder in its repo, with one file for each entry:
  `direction.md`, `<standard id>/standard.md`, and `<standard id>/<rule id>.md`. It changes in
  its repo, with a pull request.
