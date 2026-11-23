// Build the two files used by fixtures that define roles and staffing together.
export function staffedFixture(text) {
  let raw
  try { raw = Bun.YAML.parse(text) } catch { return null }
  if (!raw?.models || !raw.roles || typeof raw.roles !== 'object') return null
  const { models, ...config } = raw
  const roles = {}
  for (const [name, role] of Object.entries(config.roles)) {
    if (!role || role.kind === 'program') continue
    const { model, persistence, ...responsibility } = role
    config.roles[name] = responsibility
    const allowedModels = Object.keys(models)
    roles[name] = {
      account: 'fixture', cli: 'fixture', allowedModels, model,
      persistent: persistence?.persistent, concurrency: 1, subagentAllowance: 0,
      launch: models[model]?.launch ?? 'fixture --session {session}',
    }
  }
  return {
    config: [...text.matchAll(/^#.*$/gm)].map(([line]) => line + '\n').join('') +
      Bun.YAML.stringify(config, null, 2) + '\n',
    staffing: Bun.YAML.stringify({
      clis: { fixture: { backgroundChildren: false, canPark: false } },
      accounts: { fixture: { limits: {} } },
      models, roles,
    }),
  }
}
