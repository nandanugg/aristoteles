import { Context } from 'effect'

export class Env extends Context.Service<
  Env,
  { readonly vars: Readonly<Record<string, string | undefined>> }
>()('aristoteles/Env') {}
