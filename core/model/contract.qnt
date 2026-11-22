// The contract between the small models (plan/model/DESIGN.md 14), each part written once.
// G1 (the agents' channel): terminals.qnt PROVES it for every agent, with aristoteles as an
// arbitrary adversary; check.qnt ASSUMES it, as its fairness: with A (an agent that hears
// its step takes it) the "hears" of G1 is the agent's step itself.
// G3 (the store): store.qnt proves it; check.qnt assumes it (its acts are atomic, current).
// G4 (the person's channel): browser.qnt proves it; check.qnt's Final assumes it.
// README.md "The small models" gives the arguments each side passes and the composition.
module contract {
  // G1: an agent that owes work is, in the end, alive and hears its step; or it no longer
  // owes it; or the person owes the move that brings it back (the person is told, and is
  // not assumed to act).
  //   always(owes implies eventually(hears or not(owes) or personOwes))
  // is the same as the form below (a point where it does not owe is itself such a point),
  // and the form below is one TLC checks fast: "infinitely often" of a state predicate.
  // `hears` may be an action (check.qnt passes the agent's step): then it reads "the agent
  // takes its step infinitely often, or infinitely often it owes nothing".
  temporal G1(owes: bool, hears: bool, personOwes: bool): bool =
    always(eventually(not(owes) or hears or personOwes))

  // Capacity is external to an owed recheck. If it remains waiting, a
  // compatible admission must eventually be offered; the engine gives that
  // admission to the oldest eligible waiter. Without this assumption a
  // deferred recheck is visible but cannot be required to run.
  temporal CapacityReturns(waiting: bool, offered: bool): bool =
    always(eventually(not(waiting) or offered))

  // G3 (store.qnt proves it; check.qnt assumes it): an act takes effect only if it is fresh.
  // The facts the store knows of an act at its append. A stale act (built on an old view),
  // a recheck whose judged versions moved, a duplicate, an old epoch's token, an act from an
  // old page build, or an accept of a draft that does not wait for the person, is refused.
  // So every act that takes effect is applied once, atomically, to the state it was built
  // on, and the protocol may treat acts as atomic and current. It rests on one fact of the
  // protocol: an act's content that was built from a view is covered by its basis or by
  // `legal` (it reads what it writes); the rest of its effect is computed by the store at
  // the append (README "The small models" maps protocol.qnt's acts).
  type Fresh = { basisCurrent: bool, judgedCurrent: bool, firstTime: bool,
                 currentEpoch: bool, currentBuild: bool, waitsIfAccept: bool }
  pure def G3(f: Fresh): bool =
    f.basisCurrent and f.judgedCurrent and f.firstTime and f.currentEpoch and f.currentBuild
      and f.waitsIfAccept

  // G4 (browser.qnt proves it; check.qnt's Final "waits only on the person" assumes it):
  // every act the person owes is, in the end, shown on the person's page (or no longer
  // owed). The same form as G1, for the person's channel: websocket drops, page server
  // restarts, an old page build, a background tab; the person is never assumed to act.
  // "Shown" while a page is open: with no page open the person is not told by this channel.
  temporal G4(owes: bool, shown: bool): bool = always(eventually(not(owes) or shown))

  // P (an assumption about the person, DESIGN.md 13.2, Nanda: "otherwise I'm the problem"):
  // the person sends one draft back at most this many times. check.qnt assumes it; past it
  // the run still waits only on the person, who is shown it (G4): not a stall of the system.
  pure val PERSON_SEND_BACKS = 3
}
