import type { RuntimeConfigPort, RuntimePorts, RuntimeProtocolPort, StoredRunReceipt } from "./RuntimePorts";
import type { ExplorationSave } from "../core/demo/DemoSession";

export interface ZhushenStorage {
  getObject(key: string, defaultValue: unknown, useRoleKey: boolean): unknown;
  setObject(key: string, value: unknown, useRoleKey: boolean): void;
  remove(key: string, useRoleKey: boolean): void;
}

export interface ZhushenServices {
  readonly config: RuntimeConfigPort;
  readonly protocol: RuntimeProtocolPort;
  readonly storage: ZhushenStorage;
  readonly roleKey?: string;
  readonly checkpointScope?: string;
  readonly messages: { sendMessage(event: string, ...payload: unknown[]): void };
}

const RESULT_KEY = "astra.exploration.last-result.v2";
const progressKey = (configId: string) => `astra.exploration.progress.v1:${encodeURIComponent(configId)}`;

export function createZhushenPorts(services: ZhushenServices): RuntimePorts {
  if (services.roleKey !== undefined && (typeof services.roleKey !== "string" || !services.roleKey)) throw new Error("A role storage suffix is required");
  const roleKey = services.roleKey;
  const checkpointScope = roleKey ?? services.checkpointScope;
  if (!checkpointScope) throw new Error("Zhushen result storage requires a captured role key or explicit checkpoint scope");
  const key = (value: string) => value + (roleKey ?? "");
  const useRoleKey = roleKey === undefined;
  return {
    config: services.config,
    protocol: services.protocol,
    storage: {
      checkpointScope: `zhushen-storage:${checkpointScope}`,
      loadCheckpoint: () => Promise.resolve(services.storage.getObject(key(RESULT_KEY), null, useRoleKey)),
      saveCheckpoint: (receipt: StoredRunReceipt) => { services.storage.setObject(key(RESULT_KEY), receipt, useRoleKey); return Promise.resolve(); },
      clearCheckpoint: () => { services.storage.remove(key(RESULT_KEY), useRoleKey); return Promise.resolve(); },
      loadExploration: (id) => Promise.resolve(services.storage.getObject(key(progressKey(id)), null, useRoleKey) as ExplorationSave | null),
      saveExploration: (id, save) => { services.storage.setObject(key(progressKey(id)), save, useRoleKey); return Promise.resolve(); },
      clearExploration: (id) => { services.storage.remove(key(progressKey(id)), useRoleKey); return Promise.resolve(); },
    },
    telemetry: { track: (event, properties) => services.messages.sendMessage(`auto_explore:${event}`, properties) },
  };
}
