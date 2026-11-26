module people {
  import lines.* from "./lines"
  type Session = Live({ staff: int, subscription: int, lifetime: int }) |
    Paused({ staff: int, subscription: int, lifetime: int, checkpoint: int }) | Ended(int)
  pure val sessionEdges = Set(("Live", "next", "Ended"), ("Live", "next", "Paused"),
    ("Paused", "next", "Live"))
  pure def live(staff: int, subscription: int, lifetime: int): Session =
    Live({ staff: staff, subscription: subscription, lifetime: lifetime })
  pure def sessionStaff(session: Session, staff: int): bool = match session {
    | Live(state) => state.staff == staff
    | _ => false
  }
  pure def sessionSubscription(session: Session, subscription: int): bool = match session {
    | Live(state) => state.subscription == subscription
    | _ => false
  }
  pure def current(session: Session, staff: int, lifetime: int): bool = match session {
    | Live(state) => state.staff == staff and state.lifetime == lifetime
    | _ => false
  }
  pure def end(session: Session): Session = match session {
    | Live(state) => if (allows(sessionEdges, "Live", "next", "Ended")) Ended(state.lifetime) else session
    | _ => session
  }
  pure def pause(session: Session, checkpoint: int): Session = match session {
    | Live(state) => if (allows(sessionEdges, "Live", "next", "Paused"))
        Paused({ staff: state.staff, subscription: state.subscription, lifetime: state.lifetime, checkpoint: checkpoint })
      else session
    | _ => session
  }
  pure def resume(session: Session, lifetime: int): Session = match session {
    | Paused(state) => if (allows(sessionEdges, "Paused", "next", "Live") and lifetime > state.lifetime)
        live(state.staff, state.subscription, lifetime)
      else session
    | _ => session
  }

  type Staffing = { assignments: int -> int, allowance: int -> int, subscription: int -> int,
                    subscriptionLimit: int -> int, version: int }
  pure def charged(sessions: Set[Session], subscription: int): int =
    sessions.filter(session => sessionSubscription(session, subscription)).size()
  pure def canStart(sessions: Set[Session], staffing: Staffing, staff: int, version: int): bool = {
    val subscription = staffing.subscription.get(staff)
    version == staffing.version and not(sessions.exists(s => sessionStaff(s, staff))) and
      charged(sessions, subscription) < staffing.subscriptionLimit.get(subscription)
  }
  // Each tuple is a live child that serves a role. Both roles can charge the same staff.
  pure def canStartChild(staffing: Staffing, children: Set[(int, int)], role: int): bool = {
    val staff = staffing.assignments.get(role)
    children.filter(child => staffing.assignments.get(child._1) == staff).size() <
      staffing.allowance.get(staff)
  }

  type QueuedReview = { id: int, role: int, entered: int, review: Review }
  pure def reviewStaff(staffing: Staffing, queue: Set[QueuedReview], subject: QueuedReview,
                      host: int, busy: Set[int], fifo: bool): int = {
    val assigned = staffing.assignments.get(subject.role)
    val hasAllowance = staffing.allowance.get(assigned) > 0
    val by = if (hasAllowance) assigned else host
    val hasEarlierEntry = queue.exists(q =>
      q.review == Waiting and q.entered < subject.entered and
      staffing.allowance.get(staffing.assignments.get(q.role)) == 0)
    if (subject.review != Waiting or busy.contains(by) or (fifo and not(hasAllowance) and hasEarlierEntry)) -1 else by
  }

  type Question = Open(int) | Answered({ recipient: int, text: int })
  pure val questionEdges = Set(("Open", "answer", "Answered"))
  pure def answer(question: Question, by: int, text: int, authorize: bool): Question = match question {
    | Open(recipient) => if (allows(questionEdges, "Open", "answer", "Answered") and
                           (not(authorize) or by == recipient))
        Answered({ recipient: by, text: text })
      else question
    | _ => question
  }
}
