import {
    RunCheckpoint,
    RuntimeConfigPort,
    RuntimePorts,
    RuntimeProtocolPort,
    RuntimeStoragePort,
    RuntimeTelemetryPort,
} from "./RuntimePorts";

class CocosConfigPort implements RuntimeConfigPort {
    public load<T>(path: string): Promise<T> {
        return new Promise<T>((resolve, reject) => {
            cc.loader.loadRes(path, cc.JsonAsset, (error: Error, asset: cc.JsonAsset) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(asset.json as T);
            });
        });
    }
}

class MemoryStoragePort implements RuntimeStoragePort {
    private checkpoint: RunCheckpoint | null = null;

    public loadCheckpoint(): Promise<RunCheckpoint | null> {
        return Promise.resolve(this.checkpoint);
    }

    public saveCheckpoint(checkpoint: RunCheckpoint): Promise<void> {
        this.checkpoint = checkpoint;
        return Promise.resolve();
    }

    public clearCheckpoint(): Promise<void> {
        this.checkpoint = null;
        return Promise.resolve();
    }
}

class LocalProtocolPort implements RuntimeProtocolPort {
    public startRun(request: unknown): Promise<unknown> {
        return Promise.resolve({ ok: true, request, runId: "local-demo" });
    }

    public submitCheckpoint(checkpoint: RunCheckpoint): Promise<unknown> {
        return Promise.resolve({ ok: true, checkpoint });
    }

    public settleRun(request: unknown): Promise<unknown> {
        return Promise.resolve({ ok: true, request, rewards: [] });
    }
}

class ConsoleTelemetryPort implements RuntimeTelemetryPort {
    public track(event: string, properties: Record<string, unknown> = {}): void {
        cc.log(`[telemetry] ${event}`, properties);
    }
}

export function createLocalDemoPorts(): RuntimePorts {
    return {
        config: new CocosConfigPort(),
        storage: new MemoryStoragePort(),
        protocol: new LocalProtocolPort(),
        telemetry: new ConsoleTelemetryPort(),
    };
}

