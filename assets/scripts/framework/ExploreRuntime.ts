import { DemoSession } from "../core/demo/DemoSession";
import type { DemoConfig, DemoSnapshot, ExplorationSave } from "../core/demo/DemoSession";
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
  private progressPending: Promise<void> = Promise.resolve();
  private progressRevision = -1;
  private nextProgressTime = 0;
  private progressQueued: { save: ExplorationSave; generation: number } | null = null;
  private progressWorking = false;
  private lastProgressKey = "";
  progressState: "idle" | "saving" | "saved" | "error" = "idle";

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
      this.config = config;
      const session = new DemoSession(config);
      if (config.session?.persistExploration) {
        if (!this.ports.storage.loadExploration || !this.ports.storage.saveExploration || !this.ports.storage.clearExploration) throw new Error("Exploration persistence requires a storage adapter");
        const save = await this.ports.storage.loadExploration(config.meta?.id ?? "default");
        if (generation !== this.generation) return false;
        if (save) session.restoreExploration(save);
      }
      const response = await this.ports.protocol.startRun({ seed: config.seed, configId: config.meta?.id ?? configPath });
      if (generation !== this.generation) return false;
      if (!response || typeof response.runId !== "string" || !response.runId) throw new Error("Run service returned no runId");
      this.config = config;
      this.session = session;
      this.runId = response.runId;
      this.resultStarted = false;
      this.resultPending = null;
      this.failedCheckpoint = null;
      this.progressRevision = session.map.revision;
      this.nextProgressTime = session.world.elapsedSeconds + 4;
      this.progressState = "idle";
      this.lastProgressKey = "";
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
    if (this.config?.session?.persistExploration && (this.session.map.revision !== this.progressRevision || snapshot.elapsedSeconds >= this.nextProgressTime)) void this.flushProgress();
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

  pause(): boolean {
    const changed = this.session?.pause() ?? false;
    if (changed) void this.flushProgress();
    return changed;
  }
  resume(): boolean { return this.session?.resume() ?? false; }
  async restart(): Promise<boolean> {
    if (this.state === "disposed") return false;
    this.state = "loading";
    const generation = this.generation;
    await this.progressPending;
    if (generation !== this.generation) return false;
    if (this.config?.session?.persistExploration) await this.ports.storage.clearExploration!(this.config.meta?.id ?? "default");
    if (generation !== this.generation) return false;
    return this.start(this.configPath);
  }
  waitForResult(): Promise<void> { return this.resultPending ?? Promise.resolve(); }

  flushProgress(): Promise<void> {
    if (!this.session || !this.config?.session?.persistExploration || !this.ports.storage.saveExploration) return this.progressPending;
    const key = `${this.runId}:${this.session.map.revision}:${this.session.world.elapsedSeconds}`;
    if (key === this.lastProgressKey && this.progressState !== "error") return this.progressPending;
    this.lastProgressKey = key;
    const save = this.session.saveExploration();
    const generation = this.generation;
    this.progressRevision = this.session.map.revision;
    this.nextProgressTime = this.session.world.elapsedSeconds + 4;
    this.progressState = "saving";
    this.progressQueued = { save, generation };
    if (this.progressWorking) return this.progressPending;
    this.progressWorking = true;
    this.progressPending = Promise.resolve().then(async () => {
      try {
        while (this.progressQueued) {
          const pending = this.progressQueued;
          this.progressQueued = null;
          try {
            await this.ports.storage.saveExploration!(pending.save.configId, pending.save);
            if (pending.generation === this.generation) this.progressState = this.progressQueued ? "saving" : "saved";
          } catch (error) {
            if (pending.generation !== this.generation) continue;
            this.progressState = "error";
            this.nextProgressTime = (this.session?.world.elapsedSeconds ?? 0) + 4;
            this.ports.telemetry.track("explore_save_failed", { message: error instanceof Error ? error.message : String(error) });
            this.events.emit("progress_error", error);
          }
        }
      } finally { this.progressWorking = false; }
    });
    return this.progressPending;
  }

  retryResult(): Promise<void> {
    if (!this.failedCheckpoint || this.state === "disposed") return this.waitForResult();
    const checkpoint = this.failedCheckpoint;
    this.failedCheckpoint = null;
    this.resultPending = this.submitResult(checkpoint, this.generation);
    return this.resultPending;
  }

  dispose(): void {
    void this.flushProgress();
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
