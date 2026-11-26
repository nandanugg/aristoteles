module staffCapacityCase {
  import people.* from "../people"
  const chargeStaff: bool
  pure val initial: Staffing = {
    assignments: Map(0 -> 0, 1 -> 0, 2 -> 1), allowance: Map(0 -> 1, 1 -> 1),
    subscription: Map(0 -> 0, 1 -> 0), subscriptionLimit: Map(0 -> 2), version: 1
  }
  var state: {
    plan: Staffing, sessions: Set[Session], children: Set[(int, int)],
    deniedChild: bool, deniedSession: bool, stale: bool, tryAgain: bool
  }
  action init = state' = {
    plan: initial, sessions: Set(live(0, 0, 1)), children: Set(),
    deniedChild: false, deniedSession: false, stale: false, tryAgain: false
  }
  action startChild = {
    nondet role = Set(0, 1).oneOf()
    val child = (role, 1)
    val canStart = if (chargeStaff) canStartChild(state.plan, state.children, role)
      else not(state.children.contains(child))
    all {
      not(state.children.contains(child)),
      state' = if (canStart) { ...state, children: state.children.union(Set(child)),
        tryAgain: state.tryAgain or state.deniedChild }
      else { ...state, deniedChild: true }
    }
  }
  action finishChild = {
    nondet child = state.children.oneOf()
    state' = { ...state, children: state.children.exclude(Set(child)) }
  }
  action changePlan = all {
    state.plan.version == 1, state.sessions == Set(live(0, 0, 1)),
    state' = { ...state, plan: { ...state.plan, subscriptionLimit: Map(0 -> 1), version: 2 } }
  }
  action startSession = {
    nondet staff = Set(0, 1).oneOf()
    nondet version = Set(1, 2).oneOf()
    all {
      state' = if (canStart(state.sessions, state.plan, staff, version))
        { ...state, sessions: state.sessions.union(Set(live(staff, 0, 2))) }
      else { ...state, deniedSession: true,
        stale: state.stale or (staff == 1 and version != state.plan.version) }
    }
  }
  action step = any { startChild, finishChild, changePlan, startSession, state' = state }
  val Safety = state.children.size() <= 1 and state.plan.assignments.get(0) == state.plan.assignments.get(1) and
    charged(state.sessions, 0) <= state.plan.subscriptionLimit.get(0) and
    state.sessions.filter(s => sessionStaff(s, 0)).size() == 1
  val Success = state.children.size() == 1 and state.sessions.contains(live(1, 0, 2))
  val Fault = state.deniedChild and state.deniedSession and state.stale and state.tryAgain
}
module staffCapacity {
  import staffCapacityCase(chargeStaff = true).* from "./staffCapacity"
}
module staffCapacityMutant {
  import staffCapacityCase(chargeStaff = false).* from "./staffCapacity"
}
