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
            cc.resources.load(path, cc.JsonAsset, (error: Error, asset: cc.JsonAsset) => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(asset.json as T);
            });
        });
    }
}

class LocalResultStoragePort implements RuntimeStoragePort {
    private readonly key = "astra.exploration.last-result.v1";

    public loadCheckpoint(): Promise<RunCheckpoint | null> {
        const value = cc.sys.localStorage.getItem(this.key);
        return Promise.resolve(value ? JSON.parse(value) as RunCheckpoint : null);
    }

    public saveCheckpoint(checkpoint: RunCheckpoint): Promise<void> {
        cc.sys.localStorage.setItem(this.key, JSON.stringify(checkpoint));
        return Promise.resolve();
    }

    public clearCheckpoint(): Promise<void> {
        cc.sys.localStorage.removeItem(this.key);
        return Promise.resolve();
    }
}

class LocalProtocolPort implements RuntimeProtocolPort {
    private sequence = 0;
    public startRun(request: unknown): Promise<{ runId: string }> {
        return Promise.resolve({ runId: `local-${Date.now()}-${++this.sequence}` });
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
        storage: new LocalResultStoragePort(),
        protocol: new LocalProtocolPort(),
        telemetry: new ConsoleTelemetryPort(),
    };
}
