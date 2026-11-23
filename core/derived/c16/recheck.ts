import type { Recorded, RecheckBrief } from '../../schema/index.ts'
import { recheckItems, verOf } from '../../state/c16/reads.ts'
import type { WorkState } from '../../state/c16/state.ts'
import { routeSettled, type RecheckJob } from '../../state/rechecks.ts'
import type { Runtime } from '../../state/worker-runtime.ts'

export const recheckInput = (state: WorkState, taskId: string, events: ReadonlyArray<Recorded> = []) => {
  const task = state.tasks.get(taskId)
  if (state.top.ended || task?.state !== 'Done') return null
  const keys = [...recheckItems(state, task)].sort()
  if (!keys.length) return null
  const previous = [...events].reverse().find(({ event }) => {
    if (event._tag !== 'Work' || event.create._tag !== 'Acted') return false
    const { who, body } = event.create.act
    return who._tag === 'Maker' && state.makers.get(who.id)?.task === taskId && body._tag === 'Report'
  })?.event
  const body = previous?._tag === 'Work' && previous.create._tag === 'Acted' &&
    previous.create.act.body._tag === 'Report' ? previous.create.act.body : null
  const brief: RecheckBrief = {
    goal: task.goal, sections: task.sections, output: body?.output ?? null, files: body?.files ?? [],
    rules: keys.map((item) => {
      const rule = state.items.get(item)
      return {
        item, version: verOf(state.ver, item), says: rule?.says ?? '(removed)',
        reference: rule?.ref ?? null, test: rule?.test ?? null, knownBreaks: rule?.knownBreaks ?? [],
      }
    }),
  }
  return { task: taskId, result: task.resultId, on: state.seq,
    items: brief.rules.map(({ item, version }) => [item, version] as const), brief }
}

export const currentRecheck = (state: WorkState, { queued }: RecheckJob): boolean => {
  const task = state.tasks.get(queued.task)
  if (state.top.ended || task?.state !== 'Done' || task.resultId !== queued.result) return false
  const pending = recheckItems(state, task)
  return pending.length === queued.items.length &&
    queued.items.every(([item, version]) => pending.includes(item) && verOf(state.ver, item) === version)
}

export const readyRecheck = (state: WorkState, runtime: Runtime, jobs: ReadonlyMap<string, RecheckJob>, task: string) =>
  [...jobs.values()].find((job) => job.queued.task === task && !job.cancelled && !job.taken &&
    job.report !== null && routeSettled(job, runtime) && currentRecheck(state, job))
