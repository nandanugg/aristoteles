# Project implementation

The `work` CLI and the Project page use checked schemas from
[`core/schema/project.ts`](core/schema/project.ts). Commands and page submissions
supply a line address, a move, checked input, and a read position. The engine
establishes actor authority from the owner terminal, the bound host session, or a
live staff session and review assignment.

## Journal

A format-18 SQLite journal stores ordered events. Each write reads the current
projection inside a transaction, checks the actor and read position, and appends
the event. The phase transitions fold those events into one Project projection.
CLI and page views derive their next steps from that projection. The page loads a
snapshot and reads later events by position to stay current through reconnects.

## Lines

- A submitted proposal goes to a fresh reviewer who reports facts. The owner
  accepts the reviewed version, sends it back, or removes it. An answered
  Question belongs to its staffing draft and closes when the draft advances.
  Each Project, Proposal, or Task keeps its own question map. A question move
  addresses the owner and the question’s key within that map.
- Accepted staffing assigns every role, with session limits per subscription and
  subagent capacity per staff. The journal reserves a Starting session before
  spawn. Its pane proves authority to become Live. Session loss retires its
  authority and gives the affected task or review a checked recovery path.
- Activation pins the approved instruction inventory and binds one acknowledged
  host. The host binding comes from the live staff session. The owner starts
  work on the activation line. Recovery reconciles launch
  material and file markers against the journal.
- The host sends a leaf task with accepted versions pinned. A staff report can
  record a result or raise a problem such as WrongTask. The engine records command
  outcomes, and a fresh reviewer supplies the assigned prompt evidence. Checked
  outcomes determine completion, retry with feedback, or Raised. The host
  decides how to re-split work raised as WrongTask.

## Adapters

The CLI and loopback page use the same submission and projection contracts.
The local adapters own process launches, credential delivery, command capture,
and instruction-file changes. Credentials stay in private launch and session
material. Journal events and page responses carry only the state required for
review and coordination.

The [Project model](core/model/README.md) checks the registered transition
properties. Conformance witnesses replay success, fault, and mutant paths
against the current journal, including its browser projection.
