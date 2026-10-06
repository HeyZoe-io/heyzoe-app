/**
 * Client-safe hook. The webhook installs the real gate from wa-send-before-claude.
 * This file must not import node:async_hooks: lib/whatsapp.ts is on the browser graph.
 */
let impl: (action: string) => void = () => {};

export function setPreClaudeOutboundGuard(fn: (action: string) => void): void {
  impl = fn;
}

export function guardPreClaudeOutbound(action: string): void {
  impl(action);
}
