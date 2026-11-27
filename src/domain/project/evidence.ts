import { Schema } from 'effect'
import { CommandExit, CommandText, CommandTextOutput, FilePath, LineNumber, QuoteText } from './values.ts'

export const Lines = Schema.Struct({ first: LineNumber, last: LineNumber })
  .check(Schema.makeFilter(({ first, last }) => first <= last))
export const Quote = Schema.TaggedStruct('Quote', { file: FilePath, lines: Lines, text: QuoteText })
export const Command = Schema.TaggedStruct('Command', { text: CommandText })
export const CommandOutput = Schema.TaggedStruct('CommandOutput', {
  command: Command, exit: CommandExit, stdout: CommandTextOutput, stderr: CommandTextOutput,
})
export const Evidence = Schema.Union([Quote, CommandOutput])
const holds = 'Holds'
const breaks = 'Breaks'
export const outcomeOf = <const Fields extends Schema.Struct.Fields>(fields: Fields) => Schema.Union([
  Schema.TaggedStruct(holds, fields),
  Schema.TaggedStruct(breaks, fields),
])
