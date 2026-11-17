// Regressions as quint tests (`quint test`). PageOffersPersonObs holds by the page's own
// definition (personWhats offers what the view owes), so it is a regression check, not a
// safety property: it guards a later change of the page code in the model.
module pageTest {
  import cfgs.* from "./workenv"
  import workenv(CFG = FIXED, ENV = { ...CALM, starts: DEEP }).* from "./workenv"
  run pageOffersTest = init.then(40.reps(_ => step.expect(PageOffersPersonObs)))
}
