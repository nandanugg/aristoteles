// The form of the output that a maker reports (the brief prints it; a report is checked against
// it): <file>#<section>, <repo>@<commit>. Here, not in adapters/words, because the actions may not
// import the words (BUILD.md D2): a brief and a report must agree on it.
import { assignmentAt, taskAt } from '../derived/reads.ts'
import { type AssignmentId, sectionOf, type Task, type Work } from '../schema/index.ts'

// Role words and output forms name the workspace and the context; fill them in. A task that
// needs other tasks reports its whole workspace.
const fillText = (text: string, task: Task): string => {
  const t = task.descriptionAi
  let out = text.replaceAll('<task id>', task.id)
  const only = t.workspace.length === 1 ? t.workspace[0] : undefined
  const section = sectionOf(t.context)
  if (only) {
    if (task.needs.length && section === null) out = out.replaceAll('<file>#<section>', only.path)
    out = out.replaceAll('<file>', only.path).replaceAll('<repo>', only.path)
  }
  if (section !== null) out = out.replaceAll('<section>', section)
  for (const [key, value] of t.context.facts) out = out.replaceAll(`<${key}>`, value)
  return out
}

export const outputForm = (w: Work, id: AssignmentId): string => {
  const a = assignmentAt(w, id)
  const task = taskAt(w, a.task)
  const output = w.config.roles[a.role]?.output
  const workspace = task.descriptionAi.workspace
  const only = workspace.length === 1 ? workspace[0] : undefined
  if (task.needs.length > 0 && only && sectionOf(task.descriptionAi.context) === null) {
    return output?.includes('@') ? `${only.path}@<commit>` : only.path
  }
  return output ? fillText(output, task) : '"<what you made, and where it is>"'
}
