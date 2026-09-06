import { DemoSession } from "../core/demo/DemoSession";
import type { DemoConfig, DemoSnapshot, ExplorationSave } from "../core/demo/DemoSession";
import { EventBus } from "./EventBus";
import type { RunCheckpoint, RuntimePorts, StoredRunReceipt } from "./RuntimePorts";

export interface SessionReady { readonly session: DemoSession; readonly config: DemoConfig; readonly runId: string; }
export type ResultSubmissionState = "idle" | "submitting" | "retry_pending" | "settled" | "invalid" | "unreadable" | "error";
export interface ResultPendingNotice { readonly checkpoint: RunCheckpoint | null; readonly phase?: StoredRunReceipt["phase"]; readonly recovered: boolean; readonly reason?: string; }
interface PendingDelivery { receipt: StoredRunReceipt; persisted: boolean; active: Promise<void> | null; response?: unknown; }
const deliveryLedger = new Map<string, PendingDelivery>();
const activeRunLeases = new Map<string, ExploreRuntime>();

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
  private failedDelivery: PendingDelivery | null = null;
  private resultInFlight = false;
  private deliveryRevision = 0;
  private resumeStartAfterResult = false;
  private progressPending: Promise<void> = Promise.resolve();
  private progressRevision = -1;
  private nextProgressTime = 0;
  private progressQueued: { save: ExplorationSave; generation: number } | null = null;
  private progressWorking = false;
  private lastProgressKey = "";
  progressState: "idle" | "saving" | "saved" | "error" = "idle";
  resultState: ResultSubmissionState = "idle";

  constructor(ports: RuntimePorts) {
    if (!ports.storage.checkpointScope) throw new Error("Result storage requires a stable checkpoint scope");
    this.ports = ports;
  }

  async start(configPath = this.configPath): Promise<boolean> {
    if (this.state === "disposed") return false;
    if (!this.acquireRunLease()) {
      this.state = "error";
      this.lastError = new Error(`Another exploration runtime is already active for ${this.ports.storage.checkpointScope}`);
      this.events.emit("error", this.lastError);
      return false;
    }
    const generation = ++this.generation;
    let keepLeaseOnFailure = false;
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
      let savedReceipt: unknown;
      try {
        savedReceipt = await this.ports.storage.loadCheckpoint();
      } catch (error) {
        keepLeaseOnFailure = true;
        const reason = error instanceof Error ? error.message : String(error);
        this.resultState = "unreadable";
        this.notifyResultPending(null, true, reason);
        throw new Error(`Stored result checkpoint could not be read and was retained: ${reason}`);
      }
      if (generation !== this.generation) return false;
      keepLeaseOnFailure = savedReceipt !== null;
      if (savedReceipt !== null && !isStoredRunReceipt(savedReceipt)) {
          this.resultState = "invalid";
          this.notifyResultPending(null, true, "Stored result checkpoint is malformed or uses an unsupported legacy format");
          throw new Error("Stored result checkpoint is malformed or uses an unsupported legacy format; it was retained");
      }
      let delivery: PendingDelivery | null;
      try {
        delivery = mergeSavedDelivery(this.ports.storage.checkpointScope, savedReceipt as StoredRunReceipt | null);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.resultState = "invalid";
        this.notifyResultPending(null, true, reason);
        throw error;
      }
      if (delivery) {
        await this.beginResultDelivery(delivery, generation, true, false);
        if (generation !== this.generation) return false;
        if (this.failedDelivery) {
          this.resumeStartAfterResult = true;
          this.state = "error";
          return false;
        }
        keepLeaseOnFailure = false;
      }
      const response = await this.ports.protocol.startRun({ seed: config.seed, configId: config.meta?.id ?? configPath });
      if (generation !== this.generation) return false;
      if (!response || typeof response.runId !== "string" || !response.runId) throw new Error("Run service returned no runId");
      this.config = config;
      this.session = session;
      this.runId = response.runId;
      this.resultStarted = false;
      this.resultPending = null;
      this.failedDelivery = null;
      this.resultInFlight = false;
      this.resumeStartAfterResult = false;
      this.resultState = "idle";
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
      if (!keepLeaseOnFailure && !this.failedDelivery) this.releaseRunLease();
      return false;
    }
  }

  update(deltaSeconds: number): DemoSnapshot | null {
    if (this.state !== "ready" || !this.session) return null;
    this.session.update(deltaSeconds);
    const snapshot = this.session.getSnapshot();
    if (this.config?.session?.persistExploration && (this.session.map.revision !== this.progressRevision || snapshot.elapsedSeconds >= this.nextProgressTime)) void this.flushProgress();
    if (snapshot.result && !this.resultStarted) {
      const checkpoint: RunCheckpoint = { runId: this.runId, sequence: 1, payload: {
        kind: "completed_run", configId: this.config?.meta?.id, result: snapshot.result,
        exploration: { zones: snapshot.exploration.zones, discoveredPoiIds: snapshot.exploration.discoveredPoiIds,
          completedEncounterIds: snapshot.exploration.completedEncounterIds },
      } };
      try {
        this.beginResultDelivery({ receipt: { version: 2, phase: "pending", checkpoint }, persisted: false, active: null }, this.generation, false, false);
        this.resultStarted = true;
      } catch (error) {
        this.lastError = error instanceof Error ? error : new Error(String(error));
        this.resultState = "error";
        this.state = "error";
        this.events.emit("error", this.lastError);
        return snapshot;
      }
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
    if (this.resultInFlight) await this.waitForResult();
    if (generation !== this.generation) return false;
    if (this.failedDelivery) {
      this.resumeStartAfterResult = false;
      await this.beginResultDelivery(this.failedDelivery, generation, false, false);
      if (generation !== this.generation || this.failedDelivery) return false;
    }
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
    if (this.resultInFlight) return this.waitForResult();
    if (!this.failedDelivery || this.state === "disposed") return this.waitForResult();
    return this.beginResultDelivery(this.failedDelivery, this.generation, false, this.resumeStartAfterResult);
  }

  get pendingResult(): Readonly<Pick<RunCheckpoint, "runId" | "sequence">> | null {
    const checkpoint = this.failedDelivery?.receipt.checkpoint;
    return checkpoint ? { runId: checkpoint.runId, sequence: checkpoint.sequence } : null;
  }

  dispose(): void {
    void this.flushProgress();
    this.generation += 1;
    this.state = "disposed";
    this.session = null;
    this.events.clear();
    this.releaseRunLease();
  }

  private acquireRunLease(): boolean {
    const scope = this.ports.storage.checkpointScope;
    const current = activeRunLeases.get(scope);
    if (current && current !== this) return false;
    activeRunLeases.set(scope, this);
    return true;
  }

  private releaseRunLease(): void {
    if (activeRunLeases.get(this.ports.storage.checkpointScope) === this) activeRunLeases.delete(this.ports.storage.checkpointScope);
  }

  private beginResultDelivery(delivery: PendingDelivery, generation: number, recovered: boolean, continueStart: boolean): Promise<void> {
    if (this.resultInFlight && this.resultPending) return this.resultPending;
    registerDelivery(this.ports.storage.checkpointScope, delivery);
    this.failedDelivery = delivery;
    this.resultState = "submitting";
    this.resultInFlight = true;
    const revision = ++this.deliveryRevision;
    const work = Promise.resolve().then(() => this.driveResultDelivery(delivery, generation)).then(async () => {
      if (continueStart && generation === this.generation && this.state !== "disposed" && !this.failedDelivery) {
        this.resumeStartAfterResult = false;
        await this.start(this.configPath);
      }
    });
    const finish = () => { if (revision === this.deliveryRevision) this.resultInFlight = false; };
    const active = work.then(finish, (error) => { finish(); throw error; });
    this.resultPending = active;
    if (recovered) this.notifyResultPending(delivery.receipt.checkpoint, true, undefined, delivery.receipt.phase);
    return active;
  }

  private async driveResultDelivery(delivery: PendingDelivery, generation: number): Promise<void> {
    const checkpoint = delivery.receipt.checkpoint;
    try {
      while (generation === this.generation && deliveryLedger.get(this.ports.storage.checkpointScope) === delivery) {
        await this.joinOrStartSharedDelivery(delivery, generation);
      }
      if (generation !== this.generation || deliveryLedger.get(this.ports.storage.checkpointScope) === delivery) return;
      this.lastError = null;
      this.failedDelivery = null;
      this.resultState = "settled";
      this.events.emit("settled", delivery.response);
      this.ports.telemetry.track("explore_finished", { runId: checkpoint.runId });
    } catch (error) {
      if (generation !== this.generation) return;
      this.resultState = "retry_pending";
      this.lastError = error instanceof Error ? error : new Error(String(error));
      this.notifyResultPending(checkpoint, false, this.lastError.message, delivery.receipt.phase);
      this.events.emit("error", this.lastError);
    }
  }

  private joinOrStartSharedDelivery(delivery: PendingDelivery, generation: number): Promise<void> {
    if (delivery.active) return delivery.active;
    const work = this.deliverSharedPhases(delivery, generation);
    const finish = () => { if (delivery.active === active) delivery.active = null; };
    const active = work.then(finish, (error) => { finish(); throw error; });
    delivery.active = active;
    return active;
  }

  private async deliverSharedPhases(delivery: PendingDelivery, generation: number): Promise<void> {
    const checkpoint = delivery.receipt.checkpoint;
    if (delivery.receipt.phase === "pending") {
      if (!delivery.persisted) {
        await this.ports.storage.saveCheckpoint(delivery.receipt);
        delivery.persisted = true;
      }
      if (generation !== this.generation) return;
      await this.ports.protocol.submitCheckpoint(checkpoint);
      delivery.receipt = { version: 2, phase: "submitted", checkpoint };
      delivery.persisted = false;
      if (generation !== this.generation) return;
    }
    if (delivery.receipt.phase === "submitted") {
      if (!delivery.persisted) {
        await this.ports.storage.saveCheckpoint(delivery.receipt);
        delivery.persisted = true;
      }
      if (generation !== this.generation) return;
      delivery.response = await this.ports.protocol.settleRun({ runId: checkpoint.runId, sequence: checkpoint.sequence, payload: checkpoint.payload });
      delivery.receipt = { version: 2, phase: "settled", checkpoint };
      delivery.persisted = false;
      if (generation !== this.generation) return;
    }
    if (!delivery.persisted) {
      await this.ports.storage.saveCheckpoint(delivery.receipt);
      delivery.persisted = true;
    }
    if (generation !== this.generation) return;
    await this.ports.storage.clearCheckpoint();
    if (deliveryLedger.get(this.ports.storage.checkpointScope) === delivery) deliveryLedger.delete(this.ports.storage.checkpointScope);
  }

  private notifyResultPending(checkpoint: RunCheckpoint | null, recovered: boolean, reason?: string, phase?: StoredRunReceipt["phase"]): void {
    const notice: ResultPendingNotice = { checkpoint, phase, recovered, reason };
    this.events.emit<ResultPendingNotice>("result_pending", notice);
    this.ports.telemetry.track("explore_result_pending", checkpoint ? { runId: checkpoint.runId, sequence: checkpoint.sequence, phase, recovered, reason } : { recovered, reason });
  }
}

function isRunCheckpoint(value: unknown): value is RunCheckpoint {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { runId?: unknown; sequence?: unknown; payload?: unknown };
  return typeof candidate.runId === "string" && candidate.runId.length > 0 &&
    typeof candidate.sequence === "number" && Number.isInteger(candidate.sequence) && candidate.sequence > 0 &&
    Object.prototype.hasOwnProperty.call(candidate, "payload");
}

function isStoredRunReceipt(value: unknown): value is StoredRunReceipt {
  if (!value || typeof value !== "object") return false;
  const candidate = value as { version?: unknown; phase?: unknown; checkpoint?: unknown };
  return candidate.version === 2 && (candidate.phase === "pending" || candidate.phase === "submitted" || candidate.phase === "settled") &&
    isRunCheckpoint(candidate.checkpoint);
}

function mergeSavedDelivery(scope: string, saved: StoredRunReceipt | null): PendingDelivery | null {
  const current = deliveryLedger.get(scope);
  if (!saved) return current || null;
  if (!current) {
    const delivery: PendingDelivery = { receipt: saved, persisted: true, active: null };
    deliveryLedger.set(scope, delivery);
    return delivery;
  }
  if (!sameDeliveryIdentity(current.receipt.checkpoint, saved.checkpoint)) {
    throw new Error(`Stored result receipt conflicts with the active in-process delivery for ${scope}`);
  }
  const savedRank = receiptPhaseRank(saved.phase), currentRank = receiptPhaseRank(current.receipt.phase);
  if (savedRank > currentRank) {
    current.receipt = saved;
    current.persisted = true;
  } else if (savedRank === currentRank) {
    current.persisted = true;
  } else if (current.persisted) {
    throw new Error(`Stored result receipt regressed behind the active in-process delivery for ${scope}`);
  }
  return current;
}

function registerDelivery(scope: string, delivery: PendingDelivery): void {
  const current = deliveryLedger.get(scope);
  if (!current) { deliveryLedger.set(scope, delivery); return; }
  if (current !== delivery) {
    if (!sameDeliveryIdentity(current.receipt.checkpoint, delivery.receipt.checkpoint)) {
      throw new Error(`A different result delivery is already active for ${scope}`);
    }
    throw new Error(`Result delivery state was duplicated for ${scope}`);
  }
}

function sameDeliveryIdentity(first: RunCheckpoint, second: RunCheckpoint): boolean {
  return first.runId === second.runId && first.sequence === second.sequence;
}

function receiptPhaseRank(phase: StoredRunReceipt["phase"]): number {
  return phase === "pending" ? 0 : phase === "submitted" ? 1 : 2;
}
