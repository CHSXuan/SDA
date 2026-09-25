export interface PeakRecord {
  key: string;
  value: number;
  time: number;
  detail?: { stage: string; id?: string };
  playback?: {
    title?: string;
    artist?: string;
    position?: number;
    paused?: boolean;
    playing?: boolean;
    loading?: boolean;
    uncertain?: boolean;
    ageMs?: number;
  };
}

export interface StageRow {
  stage: string;
  id?: string;
  count: number;
  totalMs: number;
  minMs: number;
  maxMs: number;
  units: number;
  unitsPerSecond?: number;
}

export interface ProcessRow {
  name: string;
  pid: number;
  cpuPercent: number | null;
  workingSetBytes: number;
  readBytesPerSecond: number | null;
  writeBytesPerSecond: number | null;
}

export interface Hardware {
  totalMachinePercent?: number | null;
  cpuPercent?: number | null;
  perCoreCpu?: number[];
  workingSetBytes?: number | null;
  readBytesPerSecond?: number | null;
  writeBytesPerSecond?: number | null;
  processes?: ProcessRow[];
  unavailable?: string | string[];
}

export interface Network {
  rxBytesPerSecond?: number | null;
  txBytesPerSecond?: number | null;
  [key: string]: unknown;
}

export interface Snapshot {
  active: boolean;
  starting?: boolean;
  directory?: string;
  dropped?: number;
  time?: number;
  intervalMs?: number;
  mainHeartbeatAgeMs?: number | null;
  nativeHeartbeatAgeMs?: number | null;
  hardware?: Hardware;
  main?: { network?: Network; nativePid?: number; [key: string]: unknown };
  network?: Network | null;
  rows?: StageRow[];
  nativeRows?: StageRow[];
  errors?: string[];
  pending?: { stage: string; waitingMs: number }[];
  cumulative?: StageRow[];
  peakKeys?: string[];
  peakRecords?: Record<string, PeakRecord>;
}

export interface SimulationRow {
  time: number;
  error?: string;
  measured: { sources: number; meanBlockMs: number; blockBudgetMs: number };
  observedMeanBlockMs?: number | null;
  equivalentMeanMs: number;
  equivalentP95Ms: number;
}

export interface SimulationResult {
  error?: string;
  source: { platform: string; arch: string };
  current: { platform: string; arch: string };
  scale: number;
  testedSnapshots: number;
  availableSnapshots: number;
  traceTruncated?: boolean;
  traceDropped?: boolean;
  rows: SimulationRow[];
  limitations: string[];
  path: string;
}

export interface CodecVerifyResult {
  error?: string;
  path: string;
  results: { checkpoint: string; status: string; attempts: number }[];
}

export interface PerformanceMonitorBridge {
  snapshot: () => Promise<Snapshot>;
  action: (action: "export" | "toggle" | "resume" | "start" | "simulate" | "verify-codec") => Promise<unknown>;
}

export interface PerformanceWindowBridge {
  control: (action: "minimize" | "maximize" | "close") => Promise<void>;
  maximized: () => Promise<boolean>;
}

declare global {
  interface Window {
    performanceMonitor?: PerformanceMonitorBridge;
    performanceWindow?: PerformanceWindowBridge;
  }
}
