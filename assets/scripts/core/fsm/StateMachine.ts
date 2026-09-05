export type TransitionGuard<TContext> = (context: TContext) => boolean;

export interface Transition<TState extends string, TContext> {
  readonly from: TState;
  readonly to: TState;
  readonly when?: TransitionGuard<TContext>;
}

export class StateMachine<TState extends string, TContext> {
  private currentState: TState;
  private readonly transitions: Transition<TState, TContext>[] = [];

  constructor(initialState: TState) {
    this.currentState = initialState;
  }

  get state(): TState {
    return this.currentState;
  }

  allow(from: TState, to: TState, when?: TransitionGuard<TContext>): this {
    this.transitions.push({ from, to, when });
    return this;
  }

  canTransition(to: TState, context: TContext): boolean {
    return this.transitions.some((transition) =>
      transition.from === this.currentState &&
      transition.to === to &&
      (transition.when?.(context) ?? true),
    );
  }

  transition(to: TState, context: TContext): boolean {
    if (!this.canTransition(to, context)) return false;
    this.currentState = to;
    return true;
  }

  force(state: TState): void {
    this.currentState = state;
  }
}
