import { DemoSession } from "../core/demo/DemoSession";
import type { DemoConfig, DemoSnapshot } from "../core/demo/DemoSession";
import { EventBus } from "./EventBus";
import type { RunCheckpoint, RuntimePorts } from "./RuntimePorts";

export interface SessionReady { readonly session: DemoSession; readonly config: DemoConfig; readonly runId: string; }

export class ExploreRuntime {
  readonly events = new EventBus();
  session: DemoSession | null = null;
  lastError: Error | null = null;
  state: "idle" | "loading" | "ready" | "error" | "disposed" = "idle";
  private readonly ports: RuntimePorts;
  private generation = 0;
  private configPath = "config/auto_explore/world_demo";
  private config: DemoConfig | null = null;
  private runId = "";
  private resultStarted = false;
  private resultPending: Promise<void> | null = null;
  private failedCheckpoint: RunCheckpoint | null = null;

  constructor(ports: RuntimePorts) { this.ports = ports; }

  async start(configPath = this.configPath): Promise<boolean> {
    if (this.state === "disposed") return false;
    const generation = ++this.generation;
    this.configPath = configPath;
    this.state = "loading";
    this.session = null;
    this.lastError = null;
    this.events.emit("loading", undefined);
    try {
      const config = await this.ports.config.load<DemoConfig>(configPath);
      if (generation !== this.generation) return false;
      const session = new DemoSession(config);
      const response = await this.ports.protocol.startRun({ seed: config.seed, configId: config.meta?.id ?? configPath });
      if (generation !== this.generation) return false;
      if (!response || typeof response.runId !== "string" || !response.runId) throw new Error("Run service returned no runId");
      this.config = config;
      this.session = session;
      this.runId = response.runId;
      this.resultStarted = false;
      this.resultPending = null;
      this.failedCheckpoint = null;
      this.state = "ready";
      this.events.emit<SessionReady>("ready", { session, config, runId: this.runId });
      this.ports.telemetry.track("explore_started", { runId: this.runId, configId: config.meta?.id });
      return true;
    } catch (error) {
      if (generation !== this.generation) return false;
      this.state = "error";
      this.lastError = error instanceof Error ? error : new Error(String(error));
      this.events.emit("error", this.lastError);
      return false;
    }
  }

  update(deltaSeconds: number): DemoSnapshot | null {
    if (this.state !== "ready" || !this.session) return null;
    this.session.update(deltaSeconds);
    const snapshot = this.session.getSnapshot();
    if (snapshot.result && !this.resultStarted) {
      this.resultStarted = true;
      const checkpoint: RunCheckpoint = { runId: this.runId, sequence: 1, payload: {
        kind: "completed_run", configId: this.config?.meta?.id, result: snapshot.result,
        exploration: { zones: snapshot.exploration.zones, discoveredPoiIds: snapshot.exploration.discoveredPoiIds,
          completedEncounterIds: snapshot.exploration.completedEncounterIds },
      } };
      this.resultPending = this.submitResult(checkpoint, this.generation);
      this.events.emit("finished", snapshot.result);
    }
    return snapshot;
  }

  pause(): boolean { return this.session?.pause() ?? false; }
  resume(): boolean { return this.session?.resume() ?? false; }
  restart(): Promise<boolean> { return this.start(this.configPath); }
  waitForResult(): Promise<void> { return this.resultPending ?? Promise.resolve(); }

  retryResult(): Promise<void> {
    if (!this.failedCheckpoint || this.state === "disposed") return this.waitForResult();
    const checkpoint = this.failedCheckpoint;
    this.failedCheckpoint = null;
    this.resultPending = this.submitResult(checkpoint, this.generation);
    return this.resultPending;
  }

  dispose(): void {
    this.generation += 1;
    this.state = "disposed";
    this.session = null;
    this.events.clear();
  }

  private async submitResult(checkpoint: RunCheckpoint, generation: number): Promise<void> {
    try {
      await this.ports.storage.saveCheckpoint(checkpoint);
      await this.ports.protocol.submitCheckpoint(checkpoint);
      const response = await this.ports.protocol.settleRun({ runId: checkpoint.runId, sequence: checkpoint.sequence, payload: checkpoint.payload });
      if (generation !== this.generation) return;
      this.lastError = null;
      this.failedCheckpoint = null;
      this.events.emit("settled", response);
      this.ports.telemetry.track("explore_finished", { runId: checkpoint.runId });
    } catch (error) {
      if (generation !== this.generation) return;
      this.failedCheckpoint = checkpoint;
      this.lastError = error instanceof Error ? error : new Error(String(error));
      this.events.emit("error", this.lastError);
    }
  }
}
