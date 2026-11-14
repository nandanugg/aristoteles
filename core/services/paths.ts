// The path of a program (git, tmux), found once per process. A spawn by name walks the PATH each
// time, and on a PATH with folders under an automounted root (/home on macOS) each walk costs
// about 60 ms (B1). A program that is not on the PATH keeps its name: its spawn fails as before.
const found = new Map<string, string>()
export const pathOf = (program: 'git' | 'tmux'): string => {
  const known = found.get(program)
  if (known !== undefined) return known
  const path = Bun.which(program, { PATH: process.env.PATH ?? '' }) ?? program
  found.set(program, path)
  return path
}
