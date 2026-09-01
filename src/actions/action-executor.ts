/**
 * Action executors perform approved side effects. They run only after the
 * policy engine has authorized the action — executor output is a result, never
 * an authorization.
 */
export interface ExecutionResult {
  /** Whether the executor believes the side effect was carried out. */
  executed: boolean;
  /** Reference to the created/changed entity, e.g. a purchase order id. */
  referenceId?: string;
  details: Record<string, unknown>;
}

export interface ActionExecutor {
  /**
   * @param parameters        validated action parameters
   * @param idempotencyKey    stable key; executors must be safe to retry
   */
  execute(parameters: unknown, idempotencyKey: string): Promise<ExecutionResult>;
}
