import type { z } from "zod";
import type { ActionExecutor, ExecutionResult } from "../actions/action-executor.js";

export type VerificationStrategyName = "immediate" | "delayed" | "polling";

/**
 * A registered, executable action. Actions are the ONLY way side effects
 * happen; the LLM cannot create or choose arbitrary actions dynamically.
 */
export interface RegisteredAction {
  name: string;
  description: string;
  inputSchema: z.ZodType;
  /** Human-readable statement of what this action changes in the world. */
  expectedSideEffect: string;
  verificationStrategy: VerificationStrategyName;
  /** Stable key used to make repeated executions idempotent. */
  idempotencyKey: (parameters: unknown) => string;
  executor: ActionExecutor;
}

export class ActionNotRegisteredError extends Error {
  constructor(name: string) {
    super(`Action not registered: ${name}`);
    this.name = "ActionNotRegisteredError";
  }
}

export class ActionRegistry {
  private readonly actions = new Map<string, RegisteredAction>();

  register(action: RegisteredAction): void {
    this.actions.set(action.name, action);
  }

  get(name: string): RegisteredAction {
    const action = this.actions.get(name);
    if (!action) {
      throw new ActionNotRegisteredError(name);
    }
    return action;
  }

  has(name: string): boolean {
    return this.actions.has(name);
  }

  list(): RegisteredAction[] {
    return [...this.actions.values()];
  }
}

// Keep the executor type import used (prevents accidental interface drift).
export type { ActionExecutor, ExecutionResult };
