export interface FixedStepResult {
    steps: number;
    interpolation: number;
    droppedTime: number;
}

/** Keeps gameplay deterministic while presentation continues at render rate. */
export class FixedStepRunner {
    private accumulator = 0;
    public readonly stepSeconds: number;
    public readonly maxCatchUpSteps: number;

    public constructor(stepSeconds: number = 1 / 30, maxCatchUpSteps: number = 5) {
        this.stepSeconds = stepSeconds;
        this.maxCatchUpSteps = maxCatchUpSteps;
    }

    public advance(deltaSeconds: number, tick: (stepSeconds: number) => void): FixedStepResult {
        const safeDelta = Math.max(0, Math.min(deltaSeconds, 0.25));
        this.accumulator += safeDelta;

        let steps = 0;
        while (this.accumulator >= this.stepSeconds && steps < this.maxCatchUpSteps) {
            tick(this.stepSeconds);
            this.accumulator -= this.stepSeconds;
            steps += 1;
        }

        let droppedTime = 0;
        if (this.accumulator >= this.stepSeconds) {
            droppedTime = this.accumulator - (this.accumulator % this.stepSeconds);
            this.accumulator %= this.stepSeconds;
        }

        return {
            steps,
            interpolation: this.accumulator / this.stepSeconds,
            droppedTime,
        };
    }

    public reset(): void {
        this.accumulator = 0;
    }
}
