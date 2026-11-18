// The stop hook of a CLI (terminals.qnt idleSeen): when its agent stops at the prompt, the hook
// runs `work hook stopped <token>`, which records the exit of that actor. The launch of the AI
// CLI adds this settings text (Claude Code: --settings '<json>').
export const stopHookSettings = (token: string): string =>
  JSON.stringify({
    hooks: {
      Stop: [{ hooks: [{ type: 'command', command: `work hook stopped ${token}` }] }],
    },
  })
