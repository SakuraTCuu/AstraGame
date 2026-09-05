import {
    RunCheckpoint,
    RuntimeConfigPort,
    RuntimePorts,
    RuntimeProtocolPort,
    RuntimeStoragePort,
    RuntimeTelemetryPort,
} from "./RuntimePorts";
import type { ExplorationSave } from "../core/demo/DemoSession";

class CocosConfigPort implements RuntimeConfigPort {
    public load<T>(path: string): Promise<T> {
        if (cc.sys.isBrowser && typeof window !== "undefined" &&
            ["localhost", "127.0.0.1"].includes(window.location.hostname) &&
            new URLSearchParams(window.location.search).get("reference") === "1") return this.loadReference<T>();
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

    private async loadReference<T>(): Promise<T> {
        for (const name of ["reference-resources", "reference-map"]) {
            if (!cc.assetManager.getBundle(name)) await new Promise<void>((resolve, reject) =>
                cc.assetManager.loadBundle(`./reference-preview/${name}`, (error: Error) => error ? reject(error) : resolve()));
        }
        return new Promise<T>((resolve, reject) => {
            const request = new XMLHttpRequest();
            request.open("GET", "./reference-preview/profile.json");
            request.timeout = 30000;
            request.onload = () => {
                if (request.status !== 200) { reject(new Error("Local reference profile is unavailable")); return; }
                try { resolve(JSON.parse(request.responseText)); } catch (error) { reject(error); }
            };
            request.onerror = request.ontimeout = () => reject(new Error("Local reference profile request failed"));
            request.send();
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

    public loadExploration(configId: string): Promise<ExplorationSave | null> {
        const value = cc.sys.localStorage.getItem(this.progressKey(configId));
        return Promise.resolve(value ? JSON.parse(value) : null);
    }

    public saveExploration(configId: string, save: ExplorationSave): Promise<void> {
        cc.sys.localStorage.setItem(this.progressKey(configId), JSON.stringify(save));
        return Promise.resolve();
    }

    public clearExploration(configId: string): Promise<void> {
        cc.sys.localStorage.removeItem(this.progressKey(configId));
        return Promise.resolve();
    }

    private progressKey(configId: string): string { return `astra.exploration.progress.v1:${encodeURIComponent(configId)}`; }
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
