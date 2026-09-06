import type { ExplorationSave } from "../core/demo/DemoSession";

export interface RunCheckpoint {
    runId: string;
    sequence: number;
    payload: unknown;
}

export type RunReceiptPhase = "pending" | "submitted" | "settled";

export interface StoredRunReceipt {
    version: 2;
    phase: RunReceiptPhase;
    checkpoint: RunCheckpoint;
}

export interface RuntimeConfigPort {
    load<T>(path: string): Promise<T>;
}

export interface RuntimeStoragePort {
    readonly checkpointScope: string;
    loadCheckpoint(): Promise<unknown>;
    saveCheckpoint(receipt: StoredRunReceipt): Promise<void>;
    clearCheckpoint(): Promise<void>;
    loadExploration?(configId: string): Promise<ExplorationSave | null>;
    saveExploration?(configId: string, save: ExplorationSave): Promise<void>;
    clearExploration?(configId: string): Promise<void>;
}

export interface RuntimeProtocolPort {
    // Adapters must resolve or reject within their own bounded timeout and ignore any later transport callback.
    // While an outcome is unknown, the runtime intentionally keeps that checkpoint scope locked instead of retrying.
    startRun(request: unknown): Promise<{ runId: string }>;
    submitCheckpoint(checkpoint: RunCheckpoint): Promise<unknown>;
    settleRun(request: unknown): Promise<unknown>;
}

export function requireRuntimeProtocol(protocol: RuntimeProtocolPort | null | undefined): RuntimeProtocolPort {
    if (protocol) return protocol;
    throw new Error("Exploration requires an explicit protocol adapter");
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
