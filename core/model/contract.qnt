// The contract between the two small models (plan/model/DESIGN.md 14): G1, written once.
// terminals.qnt PROVES it for every agent, with aristoteles as an arbitrary adversary.
// core.qnt ASSUMES it, as its fairness: with A (an agent that hears its step takes it) the
// "hears" of G1 is the agent's step itself.
module contract {
  // G1: an agent that owes work is, in the end, alive and hears its step; or it no longer
  // owes it; or the person owes the move that brings it back (the person is told, and is
  // not assumed to act).
  //   always(owes implies eventually(hears or not(owes) or personOwes))
  // is the same as the form below (a point where it does not owe is itself such a point),
  // and the form below is one TLC checks fast: "infinitely often" of a state predicate.
  // `hears` may be an action (core.qnt passes the agent's step): then it reads "the agent
  // takes its step infinitely often, or infinitely often it owes nothing".
  temporal G1(owes: bool, hears: bool, personOwes: bool): bool =
    always(eventually(not(owes) or hears or personOwes))
}
