---
name: assess
description: Discover a project’s work and draft Aristoteles roles, staffing, and directions for review in the Project journal.
---

# Assess a project

Read `AGENTS.md`, `CLAUDE.md`, existing skills and agent instructions, the README and docs, examples of the outputs, and the recent relevant Git history. Keep the sources and locations for each finding, where you looked for contrary examples, and areas you could not verify. Compare output types topic by topic. Draft shared guidance once and scope the differences. When two credible sources disagree, show both and ask the owner where the choice affects the work.

Use broad roles for actual work. List what each role produces and owns in its responsibility. Put the method, standards and checks in the directions. The owner edits and accepts responsibility proposals. Use the role-fitness skill to match staffing to judgment, and name the evidence for the host’s estimate if there is one.

## Open and draft

The owner opens the project with `work onboard open --file=project.yaml` and starts the page with `work start --detach`. The opening file has `owner`, `host`, `pipeline`, `roles` (work roles), `staff` (the initial staff assigned to the host), and `subscription`. Use the checked records. For example:

```yaml
owner: { _tag: Human, name: Owner }
host: &host
  key: role:host
  name: Host
  responsibility:
    number: 1
    acceptedIn: 1
    value:
      summary: Send scoped work
      introduction: Read the project and establish the scope.
      duties: [Send a task drawn from one accepted stage slice.]
```

Use the same role shape for the pipeline and work roles. The initial staff has `_tag: Staff`, `key`, `name`, its list of assigned `roles` as `{ key: role:host }` references, `subagents`, `model`, `launch`, `why`, and `subscription`. The staff’s `subscription` is a `{ key: subscription:example }` reference. The opening file’s subscription record has a key, provider, account, plan, usage window, a session limit or Unlimited, and an estimate or NoEstimate. The owner launches the staff session with `work session launch <staff-key>`. The launched staff follows the pane prompt to run `work session ack <session-key>` before using its credential.

Keep authored drafts in a local folder such as `.work/drafts/`. Submit each through `work onboard submit "$ARISTOTELES_TOKEN" --on=<read> --file=<draft.yaml>`. The file gives the line, proposal key, move, and input. Open with `move: open` and `input: { value: ..., previous: { _tag: None } }`. For a new version of an accepted direction, give `previous: { _tag: Version, version: ... }` with the complete accepted version. Then use `move: submit` with the exact reviewed candidate in `input.value`.

```yaml
line: Proposal
key: proposal:document
move: submit
input:
  value: <the complete direction>
```

A staffing value uses `_tag: Staffing`, the single subscriptions list, and all staff assignments. Reference the subscription records from their assignments. Assign each role once. When you need the owner’s input, ask a Question about the staffing proposal and its current draft. Use `work question owner` with `owner: { _tag: Proposal, key: ... }` in the input. The draft owns the Question. Wait for its answer before submitting. A responsibility value uses `_tag: Responsibility`, the role record, and the responsibility’s summary, introduction and duties.

## Directions and evidence

A direction has a name, summary, text, source, ordered stages, and standards. Use `{ _tag: Local }` for a local source. For company directions record the repository, merged commit and folder in a Company source. Each stage carries its name, role record, work, and location (Project, File, or Passage). A standard has a scope of Everywhere or Where. Where names AllStages or NamedStages and the matching context facts. Fact names are `System`, `Field`, `Language`, `Repository`, `Audience`, and `Output`. Place a whole-output check at the stage that owns the whole output.

A rule expresses one independently failing condition. Use `{ _tag: Command, text: ... }` for a deterministic test, or `{ _tag: Prompt, question: ..., source: <Quote> }` for a judgment check. An example pairs a Quote or MadeUp excerpt with Holds or Breaks. Preserve genuine examples and distinguish known pre-existing breaks from new failures. Include `knownBreaks: []` when there are none.

```yaml
_tag: Rule
name: Give the rationale
text: State why the change is needed.
verification:
  _tag: Prompt
  question: Does the result explain why this change is needed?
  source: { _tag: Quote, file: docs/format.md, lines: { first: 8, last: 8 }, text: Explain why. }
examples:
  - example: { _tag: MadeUp, text: A shorter queue keeps requests in order. }
    result: Holds
  - example: { _tag: MadeUp, text: The queue changed. }
    result: Breaks
knownBreaks: []
```

## Handoff from an existing app harness

Map instruction documents to directions, broad responsibilities to roles, and each independent validator condition to a rule. Read the validator’s tests and invocation before choosing the rule scope. Include the local command, arguments and expected output for the exact condition. The task runs those commands in ReadyToReview. In the assessment report, name each duplicate check or conflicting retry loop the app harness must hand off, with the file and invocation the owner needs to change. Retain separately owned publishing and other integrations and identify where they run.

Finish with the topics covered and omitted, the proposed roles and staffing reasons, the proposed direction scopes and evidence, and the app-harness changes the owner must make. Use `work onboard status` for the current project and read basis. The page shows the drafts after fresh review and the exact versions after owner acceptance.
