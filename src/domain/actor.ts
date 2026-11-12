// Who acts. Human, Agent and Actor are the page's types (sharedTypes), tagged so that one cannot
// stand for the other. Author is who wrote a stored event, as the store keeps it: the page says
// "the channel of each act goes to the record of the tool", and Author is that record.
import { Schema } from 'effect'
import { AssignmentId, RunId, Time } from './ids.ts'

// page: Human. One actor on every channel, such as Nanda.
export const Human = Schema.TaggedStruct('Human', { name: Schema.String })
export type Human = typeof Human.Type

// page: Agent. One run of a model (Sol, Terra, Luna) or of a check program; the tool starts it.
// A model run outside any task is one too: { name: 'assess', run: <its time> }.
export const Agent = Schema.TaggedStruct('Agent', { name: Schema.String, run: Schema.String })
export type Agent = typeof Agent.Type

// page: Actor. Two actors are the same when they are one person, or one run.
export const Actor = Schema.Union([Agent, Human])
export type Actor = typeof Actor.Type

export const human = (name: string): Human => ({ _tag: 'Human', name })

// The channel of a person at the tool itself: typed at a terminal, or on the page. A forwarded
// act's channel (chat, github) is its forward's.
export const PersonChannel = Schema.Literals(['terminal', 'ui'])
export type PersonChannel = typeof PersonChannel.Type

// Who wrote a stored event. Was two strings, who and channel, whose kinds the readers told
// apart by the shape of who (bug 7: a person named a1 read as an agent).
export const Author = Schema.Union([
  // An agent by its token.
  Schema.TaggedStruct('Agent', { assignment: AssignmentId }),
  // A check program's review, by the assignment that the CLI gave it.
  Schema.TaggedStruct('Program', { assignment: AssignmentId }),
  // The person at a terminal or on the page.
  Schema.TaggedStruct('Person', { name: Schema.String, channel: PersonChannel }),
  // A host run of the UI, before it has an assignment (its task draft).
  Schema.TaggedStruct('Host', { run: RunId }),
  // A model run outside any task, such as the skill that reads an app.
  Schema.TaggedStruct('ModelRun', { name: Schema.String, at: Time }),
  // The CLI's own assign and finish of a program.
  Schema.TaggedStruct('System', {}),
  // The supervisor of the terminals of the UI (ui/watcher.js), in the UI of the person named:
  // the sessions that it starts, the failures, prompts and closes that it sees, the sends that it
  // writes. The person's Stop and Resume stay the person's.
  Schema.TaggedStruct('Supervisor', { name: Schema.String }),
  // The daily refresh of the company directions.
  Schema.TaggedStruct('Refresh', {}),
]).pipe(Schema.toTaggedUnion('_tag'))
export type Author = typeof Author.Type

// The old who and channel of an author, as work log and the reader tables print them (parity:
// "a3" "agent", "Nanda" "terminal", "system" "program", "refresh" "refresh", "h1" "agent",
// "assess run <time>" "run").
export const whoOf = (author: Author): { readonly who: string; readonly channel: string } => {
  switch (author._tag) {
    case 'Agent':
      return { who: author.assignment, channel: 'agent' }
    case 'Program':
      return { who: author.assignment, channel: 'program' }
    case 'Person':
      return { who: author.name, channel: author.channel }
    case 'Host':
      return { who: author.run, channel: 'agent' }
    case 'ModelRun':
      return { who: `${author.name} run ${author.at}`, channel: 'run' }
    case 'System':
      return { who: 'system', channel: 'program' }
    case 'Refresh':
      return { who: 'refresh', channel: 'refresh' }
    // The old supervisor wrote as the person on the page.
    case 'Supervisor':
      return { who: author.name, channel: 'ui' }
  }
}
