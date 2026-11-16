// tmux as its own machine (plan/model/DESIGN.md section 8). Pure: types and transitions;
// workenv.qnt holds the variable and composes it with the store and the processes.
// - The agents' server (-L aristoteles) holds the panes of the role and the pipeline role
//   (the makers are subagents inside the role's process). It can be killed (every pane ends)
//   or lose its socket (the panes run on, unreachable). The watcher makes a new one; `gen`
//   counts servers, and a process belongs to the server it started in.
// - The host's pane lives in the person's own tmux (another server); it is never killed here.
// - The pump is a control client of the agents' server, owned by the page server. Another
//   client's attach -d detaches it; a page server restart closes it; it must attach again.
// - Each pane has an input line: empty, the person typing, a prompt queued, a prompt waiting
//   for the line to be empty, or a prompt merged with the person's typing.
module tmux {
  type Server = SrvUp | SrvKilled | SrvGone
  type Input = Empty | Typing | Queued | Pending | Garbled
  // pending: the pump was closed or detached and its owner will attach it again.
  type Tmux = { srv: Server, gen: int, pump: bool, pending: bool, input: int -> Input }

  pure def initTmux(panes: Set[int]): Tmux =
    { srv: SrvUp, gen: 0, pump: true, pending: false, input: panes.mapBy(p => Empty) }
  pure def reachable(t: Tmux): bool = t.srv == SrvUp
  // A reboot: every pane of the agents' server ends; the pump's control client ends with it.
  pure def kill(t: Tmux): Tmux = { ...t, srv: SrvKilled, pump: false, pending: true }
  // The socket vanishes: the processes run on, but no client can reach them.
  pure def loseSocket(t: Tmux): Tmux = { ...t, srv: SrvGone, pump: false, pending: true }
  pure def recreate(t: Tmux): Tmux = { ...t, srv: SrvUp, gen: t.gen + 1 }
  // Another client's attach -d. With pumpReattach the owner notices and attaches again.
  pure def stealPump(t: Tmux, reattach: bool): Tmux = { ...t, pump: false, pending: reattach }
  pure def closePump(t: Tmux): Tmux = { ...t, pump: false, pending: true }
  pure def attachPump(t: Tmux): Tmux = { ...t, pump: true, pending: false }
  // The person types into an empty line. A prompt the engine typed is already sent (with
  // Enter): the person's text goes after it, not into it.
  pure def typeInto(t: Tmux, p: int): Tmux =
    { ...t, input: t.input.set(p, if (t.input.get(p) == Empty) Typing else t.input.get(p)) }
  // The person sends or clears its line; a prompt that waited for it is typed now.
  pure def clearLine(t: Tmux, p: int): Tmux =
    { ...t, input: t.input.set(p, if (t.input.get(p) == Pending) Queued else Empty) }
  // The engine types a prompt (a revive). Into a line the person is typing in, it merges,
  // unless waitEmpty: then it waits for the line to be empty.
  pure def queuePrompt(t: Tmux, p: int, waitEmpty: bool): Tmux =
    val now = t.input.get(p)
    { ...t, input: t.input.set(p,
      if (now == Typing) (if (waitEmpty) Pending else Garbled)
      else if (now == Pending) Pending else Queued) }
  pure def consume(t: Tmux, p: int): Tmux = { ...t, input: t.input.set(p, Empty) }
  pure def promptReady(t: Tmux, p: int): bool =
    t.input.get(p) == Queued or t.input.get(p) == Garbled
}
