// // Who did a stored act, as the engine judges it, from its author (actor.ts Author: the old who
// and channel, as one closed union):
//   Agent: the assignment (an agent by its token)
//   Program: the program's assignment (its review)
//   Person, Supervisor: the person by name (the old supervisor wrote as the person)
//   System: the CLI's own assign and finish of a program; the old replay read it as a person
//     named system, and neither act reads who did it
//   Host: a host run before it has an assignment (its task draft), as a run of the host
//   ModelRun: Agent { name, run: <its time> }; Refresh: Agent { name: 'refresh' } (an import's
//     record keeps its commit)
// A forwarded act is the person's; the forward itself (Work.forwards) keeps whether the person
// confirmed it.
import { type Author, human } from '../domain/actor.ts'
import type { By } from '../domain/model.ts'
import type { Work } from '../domain/work.ts'

export const byOf = (_work: Work, author: Author): By => {
  switch (author._tag) {
    case 'Agent':
    case 'Program':
      return author.assignment
    case 'Person':
    case 'Supervisor':
      return human(author.name)
    case 'System':
      return human('system')
    case 'Host':
      return { _tag: 'Agent', name: 'host', run: author.run }
    case 'ModelRun':
      return { _tag: 'Agent', name: author.name, run: author.at }
    case 'Refresh':
      return { _tag: 'Agent', name: 'refresh', run: 'refresh' }
  }
}
