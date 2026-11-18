// The flow of a direction as a sequence diagram (Nanda, 2026-11-15: a direction has a flow): a
// lifeline for each actor in the order that it first appears, one numbered arrow for each step
// from one actor to the next, and a box on its own lifeline for an act of one actor. The list
// under it gives each step in words, with the file and line where the project defines it. A step
// that the direction governs is marked (Nanda, 2026-11-15): colored, with a tag of the ids that
// apply there; once a step is marked, the others are gray. Plain SVG with no library; on a narrow
// screen the diagram scrolls inside its own box.
import { html } from 'htm/preact'
import type { FlowView } from '../contract.ts'

type Step = (typeof FlowView.Type)[number]

// Up to 5 lifelines fit the column of the words (about 720 pixels); more scroll.
const SPAN = 580 // the room for the gaps between the lifelines
const HEAD = 40 // the height of a head box
const ROW = 40 // the height of one step
const TAG = 20 // the room of the tag of a marked step, under its arrow
const CHAR = 6.7 // about the width of one letter of a label
const NAME_CHAR = 7.2 // about the width of one letter of a head name

// A text cut to the room that it has, with an ellipsis; the list under the diagram has it whole.
const cut = (text: string, room: number): string =>
  text.length <= room ? text : `${text.slice(0, Math.max(1, room - 1))}…`

const placeOf = (p: NonNullable<Step['place']>): string =>
  `${p.file}${p.line === null ? '' : `:${p.line}`}`
export const whoOf = (s: Pick<Step, 'from' | 'to'>): string =>
  s.from === s.to ? s.from : `${s.from} → ${s.to}`
// marked: the step uses ids; gray: another step does and this one does not.
const markOf = (s: Step, any: boolean): string =>
  s.uses.length ? 'marked' : any ? 'gray' : ''

// id names the arrow head of this diagram, as two diagrams can be on one page.
export function FlowDiagram({ id, flow }: { id: string; flow: ReadonlyArray<Step> }) {
  if (!flow.length) return null
  const lifelines = [...new Set(flow.flatMap((s) => [s.from, s.to]))]
  const gaps = lifelines.length - 1
  const gap = gaps === 0 ? 220 : Math.max(140, Math.min(220, Math.floor(SPAN / gaps)))
  const headBox = Math.min(gap - 12, 168)
  const side = headBox / 2 + 8 // from an edge to the nearest lifeline
  const x = (actor: string) => side + gap * lifelines.indexOf(actor)
  const width = side * 2 + gap * gaps
  const top = HEAD + 18
  const any = flow.some((s) => s.uses.length)
  const tops = flow.map((_, i) => top + flow.slice(0, i).reduce(
    (sum, s) => sum + ROW + (s.uses.length ? TAG : 0), 0))
  const last = flow[flow.length - 1]
  const height = (tops.at(-1) ?? top) + ROW + (last?.uses.length ? TAG : 0) + 8
  const arrowHead = `flow-head-${id}`
  const number = (n: number) => html`<tspan class="flow-n">${n}</tspan> `
  // The tag of a marked step: its ids, from where its label starts, or further left when it does
  // not fit before the right edge.
  const tagOf = (s: Step, y: number, at: number) => {
    if (!s.uses.length) return ''
    const words = cut(s.uses.join(' · '), Math.floor((width - 20) / CHAR))
    const box = words.length * CHAR + 12
    const left = Math.max(4, Math.min(at, width - 4 - box))
    return html`<g class="flow-tag">
      <rect x=${left} y=${y + ROW - 4} width=${box} height="18" rx="9" />
      <text x=${left + 6} y=${y + ROW + 9}>${words}</text>
    </g>`
  }

  const rows = flow.map((s, i) => {
    const y = tops[i] ?? top
    const n = i + 1
    const mark = markOf(s, any)
    if (s.from === s.to) {
      // The box of an act on its own may cover the lifelines beside its own.
      const room = Math.min(width - 12, gap * 2.4) - 20
      const words = cut(s.says, Math.floor(room / CHAR) - String(n).length - 1)
      const box = (words.length + String(n).length + 1) * CHAR + 20
      const left = Math.max(6, Math.min(x(s.from) - box / 2, width - 6 - box))
      return html`<g class=${`flow-act ${mark}`}>
        <rect x=${left} y=${y + 6} width=${box} height="26" rx="5" />
        <text x=${left + box / 2} y=${y + 23} text-anchor="middle">${number(n)}${words}</text>
        ${tagOf(s, y, left)}
      </g>`
    }
    const [a, b] = [x(s.from), x(s.to)]
    const dir = b > a ? 1 : -1
    const [left, right] = [Math.min(a, b), Math.max(a, b)]
    // A label starts at the left end of its arrow; when it does not fit before the right edge of
    // the diagram, it ends at the right end of its arrow and runs to the left, where the room is.
    const letters = (room: number) => Math.floor(room / CHAR) - String(n).length - 1
    const [toRight, toLeft] = [letters(width - left - 24), letters(right - 20)]
    const leftward = s.says.length > toRight && toLeft > toRight
    const words = cut(s.says, leftward ? toLeft : toRight)
    return html`<g class=${`flow-arrow ${mark}`}>
      <text x=${leftward ? right - 10 : left + 10} y=${y + 16}
        text-anchor=${leftward ? 'end' : 'start'}>${number(n)}${words}</text>
      <line x1=${a + 3 * dir} y1=${y + 24} x2=${b - 5 * dir} y2=${y + 24}
        marker-end=${`url(#${arrowHead}${mark === 'gray' ? '-gray' : ''})`} />
      ${tagOf(s, y, left + 10)}
    </g>`
  })
  const heads = lifelines.map((actor) => {
    const box = headBox
    return html`<g class="flow-life">
      <line x1=${x(actor)} y1=${HEAD + 4} x2=${x(actor)} y2=${height - 4} />
      <rect x=${x(actor) - box / 2} y="4" width=${box} height=${HEAD} rx="6" />
      <text x=${x(actor)} y=${HEAD / 2 + 9} text-anchor="middle">${
        cut(actor, Math.floor((box - 14) / NAME_CHAR))}</text>
    </g>`
  })
  return html`<figure class="flow">
    <div class="flow-scroll" tabindex="0" role="group"
      aria-label="The flow of the direction; it scrolls sideways on a narrow screen">
      <svg class="flow-svg" width=${width} height=${height} viewBox=${`0 0 ${width} ${height}`}
        role="img" aria-label="A sequence diagram of the flow; the list under it gives each step">
        <defs>${['', '-gray'].map((k) => html`<marker id=${`${arrowHead}${k}`}
          class=${k ? 'gray' : ''} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7"
          markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" /></marker>`)}
        </defs>
        ${heads}${rows}
      </svg>
    </div>
    <ol class="flow-steps">${flow.map((s) => html`<li class=${markOf(s, any)}>
      <span class="flow-who">${whoOf(s)}</span>: ${s.says}${s.place === null ? '' : ' '}${
        s.place === null ? '' : html`<code class="where">${placeOf(s.place)}</code>`}${
        s.uses.length ? html` <span class="uses-tag">${s.uses.join(' · ')}</span>` : ''}
    </li>`)}</ol>
  </figure>`
}
