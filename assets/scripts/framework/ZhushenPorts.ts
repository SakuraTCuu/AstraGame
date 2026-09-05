import type { RunCheckpoint, RuntimeConfigPort, RuntimePorts, RuntimeProtocolPort } from "./RuntimePorts";

export interface ZhushenStorage {
  getObject(key: string, defaultValue: unknown, useRoleKey: boolean): unknown;
  setObject(key: string, value: unknown, useRoleKey: boolean): void;
  remove(key: string, useRoleKey: boolean): void;
}

export interface ZhushenServices {
  readonly config: RuntimeConfigPort;
  readonly protocol: RuntimeProtocolPort;
  readonly storage: ZhushenStorage;
  readonly messages: { sendMessage(event: string, ...payload: unknown[]): void };
}

const RESULT_KEY = "astra.exploration.last-result.v1";

export function createZhushenPorts(services: ZhushenServices): RuntimePorts {
  return {
    config: services.config,
    protocol: services.protocol,
    storage: {
      loadCheckpoint: () => Promise.resolve(services.storage.getObject(RESULT_KEY, null, true) as RunCheckpoint | null),
      saveCheckpoint: (checkpoint) => { services.storage.setObject(RESULT_KEY, checkpoint, true); return Promise.resolve(); },
      clearCheckpoint: () => { services.storage.remove(RESULT_KEY, true); return Promise.resolve(); },
    },
    telemetry: { track: (event, properties) => services.messages.sendMessage(`auto_explore:${event}`, properties) },
  };
}
