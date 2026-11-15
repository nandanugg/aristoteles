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
  `aristoteles.yaml`), and give evidence for. One rule is one check. The role that checks it is
  in the draft (`checkedBy`), or, for a company direction, in `aristoteles.lock`.
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
- `file` and `line` name where the project defines the step. They carry the sources, so the
  words of the direction do not say where it comes from.
- Name each actor the same way in each step; the lifelines are the actors in the order that they
  first appear.

```yaml
flow:
  - { from: Person, to: architect, says: asks for a TSD of the export feature }
  - { from: architect, to: writer, says: gives each section to a writer, file: CLAUDE.md, line: 12 }
  - { from: writer, to: writer, says: reads the rule of one heading for each section, file: .claude/skills/writer/SKILL.md, line: 30 }
  - { from: writer, to: docs/tsd/export.md, says: fills the template one section at a time, file: docs/templates/tsd.md, line: 1 }
```

A revise may change the flow (`flow:` in the edit gives the whole new flow).

## Cases

A new direction has at least 3 cases (`cases:` in its file). A case is a ladder from the direction
down to a real output of the project, so that the person can follow the direction to a result.

- The output is the bottom of the ladder: a result of the work, never an instruction. A document,
  code, a test fixture, or a golden file is an output. A line that only says the rule again is
  not.
- Each rung is a step between the direction and the output, from the top down: a place that
  passes the direction on. Give each rung a short name that says what the place is: Instruction,
  Writer skill, Validator, Template, or another short name.
- Each place is a file, a line, and a short excerpt of the file as it is today. A case is stale
  when the excerpt of a rung or of the output is no longer in its file.
- `fit` is about the output: `Follows` or `Breaks`.

A direction about how instructions are written goes down to a real document:

```yaml
cases:
  - fit: Follows
    via:
      - { name: Instruction, file: CLAUDE.md, line: 12, excerpt: Each section of a TSD says one thing. }
      - { name: Writer skill, file: .claude/skills/writer/SKILL.md, line: 30, excerpt: Write one heading for each section. }
    output: { file: docs/tsd/export.md, line: 7, excerpt: "## Design" }
```

A direction about code needs no rung; the short form `{ file, line, excerpt, fit }` is a case with
`via: []`:

```yaml
  - { file: src/export/handler.go, line: 41, excerpt: os.Getenv("EXPORT_LIMIT"), fit: Breaks }
```

A direction that no file of the project shows a result of gets no case: do not draft it, and do
not name it anywhere.

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

- A new direction: `work direction new [<token>] --file=<direction.yaml> [--by=<model run>]`.
  The file holds the whole direction; `says: |` holds markdown. `work direction new` with no
  file prints its form.
- A change of a direction: `work direction revise <token> <direction> --file=<edit.yaml>
  --answers=<the Rejects and suggestions that it answers> --why=<reason> --why-words="<fact>"`.
  The file adds, replaces, or removes standards.
- The reason (`--why`) names what a draft corrects. It is one of five: `Correct the rule`,
  `Correct the standard`, `Correct the direction`, `Correct the reviewer` (the role that
  checks a rule), `Shorten`. `--why-words` gives the fact behind it. Both show at the end of
  `work direction show <draft>`, where the deciders read the draft. `work direction new` takes
  them too.
- A company direction: a folder in its repo, with one file for each entry:
  `direction.md`, `<standard id>/standard.md`, and `<standard id>/<rule id>.md`. It changes in
  its repo, with a pull request.
