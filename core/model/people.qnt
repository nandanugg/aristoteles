module people {
  import lines.* from "./lines"
  type SessionPhase[live, paused, ended] = Live(live) | Paused(paused) | Ended(ended)
  type Session = SessionPhase[{ staff: int, subscription: int, lifetime: int },
    { staff: int, subscription: int, lifetime: int, checkpoint: int }, int]
  type SessionKey = SessionPhase[PhaseKey, PhaseKey, PhaseKey]
  type SessionMove = | SessionNext
  pure val sessionLine: Line[SessionKey, SessionMove] = Map(
    Live(NoPayload) -> { owes: Engine, moves: Set((SessionNext, Ended(NoPayload)), (SessionNext, Paused(NoPayload))) },
    Paused(NoPayload) -> { owes: Engine, moves: Set((SessionNext, Live(NoPayload))) },
    Ended(NoPayload) -> { owes: NoDuty, moves: Set() }
  )
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
    | Live(state) => if (allows(sessionLine, Live(NoPayload), SessionNext, Ended(NoPayload))) Ended(state.lifetime) else session
    | _ => session
  }
  pure def pause(session: Session, checkpoint: int): Session = match session {
    | Live(state) => if (allows(sessionLine, Live(NoPayload), SessionNext, Paused(NoPayload)))
        Paused({ staff: state.staff, subscription: state.subscription, lifetime: state.lifetime, checkpoint: checkpoint })
      else session
    | _ => session
  }
  pure def resume(session: Session, lifetime: int): Session = match session {
    | Paused(state) => if (allows(sessionLine, Paused(NoPayload), SessionNext, Live(NoPayload)) and lifetime > state.lifetime)
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

  type QuestionPhase[open, answered] = Open(open) | Answered(answered)
  type Question = QuestionPhase[int, { recipient: int, text: int }]
  type QuestionKey = QuestionPhase[PhaseKey, PhaseKey]
  type QuestionMove = | GiveAnswer
  pure val questionLine: Line[QuestionKey, QuestionMove] = Map(
    Open(NoPayload) -> { owes: Recipient, moves: Set((GiveAnswer, Answered(NoPayload))) },
    Answered(NoPayload) -> { owes: NoDuty, moves: Set() }
  )
  pure def answer(question: Question, by: int, text: int, authorize: bool): Question = match question {
    | Open(recipient) => if (allows(questionLine, Open(NoPayload), GiveAnswer, Answered(NoPayload)) and
                           (not(authorize) or by == recipient))
        Answered({ recipient: by, text: text })
      else question
    | _ => question
  }
}
