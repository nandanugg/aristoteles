// Bridge for the live fixture. The command adapter supplies raw answers and wait reads, and
// projects accepted store rows to JournalRow. This bridge derives the taking result from the
// actual suffix of that journal, even when an exact retry or refusal appends no Work.Acted.
import type { RuntimeDriver, WorkerCommand } from './driver.ts'
import { type JournalRow, intakeOf, readJournal } from './journal.ts'
import type { Intake, PermitsRead, WorkerObservation, WorkerRead } from './project.ts'

export interface WorkerRuntimeProbe {
  readonly read: () => Promise<Pick<WorkerRead, 'owed' | 'printed'> & {
    readonly worker: string
    readonly rows: ReadonlyArray<JournalRow>
  }>
  readonly perform: (command: WorkerCommand) => Promise<
    Pick<Intake, 'requested' | 'credential' | 'outcome' | 'refused'> | undefined
  >
}

export const workerDriver = (probe: WorkerRuntimeProbe): RuntimeDriver<WorkerCommand, WorkerObservation> => {
  const capture = async () => {
    const { rows, worker, owed, printed } = await probe.read()
    return { rows, read: readJournal(rows).worker(worker, { owed, printed }) }
  }
  return {
    read: async () => ({ read: (await capture()).read }),
    step: async (command) => {
      const since = (await capture()).rows.at(-1)?.seq ?? 0
      const answer = await probe.perform(command)
      const { rows, read } = await capture()
      if (!answer && rows.some(({ seq, event }) => seq > since && event.kind === 'Work.Acted') &&
        command.kind !== 'offer' && command.kind !== 'withdraw') {
        throw new Error('worker wait or lifecycle operation appended an unexpected C16 act')
      }
      return { read, ...(answer ? { intake: intakeOf(rows, since, answer) } : {}) }
    },
  }
}

export const permitsRead = (
  rows: ReadonlyArray<JournalRow>,
  parent: string,
  job: string | null,
  facts: Pick<PermitsRead, 'protocol' | 'attempts' | 'makerChildren' | 'parkSupported'> & {
    readonly foreground: boolean
  },
): PermitsRead => {
  const { foreground, ...counts } = facts
  const journal = readJournal(rows)
  const online = journal.worker(parent, { owed: [], printed: null }).session === 'Online'
  return {
    ...counts,
    worker: { online, foreground },
    slots: journal.slots,
    job: job === null ? null : journal.job(job),
  }
}
