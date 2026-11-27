module questionAnswerCase {
  import people.* from "../people"
  const recipientOnly: bool
  var state: { question: Question, session: Session, wrong: bool, duplicate: bool, accepted: int }
  action init = state' = { question: Open(2), session: live(2, 2, 1),
    wrong: false, duplicate: false, accepted: 0 }
  action replace = all {
    current(state.session, 2, 1),
    state' = { ...state, session: live(2, 2, 2) }
  }
  action submitAnswer = {
    nondet actor = Set(1, 2).oneOf()
    nondet message = Set(10, 11).oneOf()
    val question = answer(state.question, actor, message, recipientOnly)
    val applied = question != state.question
    state' = { ...state, question: question, accepted: state.accepted + (if (applied) 1 else 0),
      wrong: state.wrong or (state.question == Open(2) and actor == 1),
      duplicate: state.duplicate or (state.question != Open(2) and actor == 2) }
  }
  action step = any { replace, submitAnswer, state' = state }
  val Safety = state.accepted <= 1 and match state.question {
    | Open(recipient) => recipient == 2
    | Answered(value) => value.recipient == 2
  }
  val Success = state.question == Answered({ recipient: 2, text: 10 })
  val Fault = state.wrong and state.duplicate and current(state.session, 2, 2) and state.accepted == 1
}
module questionAnswer {
  import questionAnswerCase(recipientOnly = true).* from "./questionAnswer"
}
module questionAnswerMutant {
  import questionAnswerCase(recipientOnly = false).* from "./questionAnswer"
}
