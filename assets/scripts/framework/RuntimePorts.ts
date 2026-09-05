export interface RunCheckpoint {
    runId: string;
    sequence: number;
    payload: unknown;
}

export interface RuntimeConfigPort {
    load<T>(path: string): Promise<T>;
}

export interface RuntimeStoragePort {
    loadCheckpoint(): Promise<RunCheckpoint | null>;
    saveCheckpoint(checkpoint: RunCheckpoint): Promise<void>;
    clearCheckpoint(): Promise<void>;
}

export interface RuntimeProtocolPort {
    startRun(request: unknown): Promise<{ runId: string }>;
    submitCheckpoint(checkpoint: RunCheckpoint): Promise<unknown>;
    settleRun(request: unknown): Promise<unknown>;
}

export interface RuntimeTelemetryPort {
    track(event: string, properties?: Record<string, unknown>): void;
}

export interface RuntimePorts {
    config: RuntimeConfigPort;
    storage: RuntimeStoragePort;
    protocol: RuntimeProtocolPort;
    telemetry: RuntimeTelemetryPort;
}
