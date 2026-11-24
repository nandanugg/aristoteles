// The lines of two texts as a diff (' ', '-', '+'), by the longest common subsequence.
export const lineDiff = (before: string, after: string): ReadonlyArray<string> => {
  const a = before === '' ? [] : before.split('\n')
  const b = after === '' ? [] : after.split('\n')
  const same = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  const at = (i: number, j: number) => same[i]?.[j] ?? 0
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      const row = same[i] as number[]
      row[j] = a[i] === b[j] ? at(i + 1, j + 1) + 1 : Math.max(at(i + 1, j), at(i, j + 1))
    }
  }
  const lines: string[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      lines.push(` ${a[i++]}`)
      j++
    } else if (i < a.length && (j === b.length || at(i + 1, j) >= at(i, j + 1))) {
      lines.push(`-${a[i++]}`)
    } else lines.push(`+${b[j++]}`)
  }
  return lines
}
