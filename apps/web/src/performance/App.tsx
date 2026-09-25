import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Minus, Square, Copy, X } from "lucide-react";
import type { PeakRecord, SimulationResult, Snapshot, StageRow, CodecVerifyResult } from "./bridge";
import { CardGrid, Value, type CardDef, type Highlighted } from "./components";
import { GlassRefraction } from "../components/GlassRefraction";
import { categoryLabels, stageDefinition, stageSource } from "./stages";
import { finite, ms, num, peakAmount, peakName, size, songTime, work } from "./format";
import "./performance.css";

type Scope = "second" | "session";
type Category = string;

const emptySnapshot: Snapshot = { active: false };

export default function App() {
  const [snapshot, setSnapshot] = useState<Snapshot>(emptySnapshot);
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshotAge, setSnapshotAge] = useState<number | null>(null);
  const [scope, setScope] = useState<Scope>("second");
  const [category, setCategory] = useState<Category>("all");
  const [filter, setFilter] = useState("");
  const [busyAction, setBusyAction] = useState<"simulate" | "verify-codec" | null>(null);
  const [simulationText, setSimulationText] = useState<string[] | null>(null);
  const [maximized, setMaximized] = useState(false);
  const [peakRecords, setPeakRecords] = useState<PeakRecord[] | null>(null);
  const peakDialog = useRef<HTMLDialogElement>(null);
  const coreDialog = useRef<HTMLDialogElement>(null);

  const action = useCallback(async (name: "export" | "toggle" | "resume" | "start" | "simulate" | "verify-codec") => {
    await window.performanceMonitor?.action(name);
  }, []);

  // One poll per second keeps every card in sync with the collector.
  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const next = await window.performanceMonitor?.snapshot();
        if (cancelled) return;
        setSnapshotError(null);
        if (next) {
          setSnapshot(next);
          setSnapshotAge(next.time ? Math.max(0, Math.round((Date.now() - next.time) / 1000)) : null);
        }
      } catch (error) {
        if (!cancelled) setSnapshotError(String(error).slice(0, 120));
      }
    };
    void tick();
    const timer = setInterval(tick, 1000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  useEffect(() => {
    void window.performanceWindow?.maximized?.().then(setMaximized).catch(() => {});
    const onResize = () => void window.performanceWindow?.maximized?.().then(setMaximized).catch(() => {});
    window.addEventListener("resize", onResize, { passive: true });
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Same scroll-scrim behaviour as the app's SheetHeading: fade the heading
  // backdrop in as the dialog content scrolls underneath it.
  useEffect(() => {
    const dialogs = [coreDialog.current, peakDialog.current];
    const cleanups = dialogs.map(dialog => {
      if (!dialog) return () => {};
      const heading = dialog.querySelector<HTMLElement>(".perf-sheet-heading");
      if (!heading) return () => {};
      let frame = 0;
      const update = () => {
        frame = 0;
        heading.style.setProperty("--sheet-scroll", String(Math.min(1, Math.max(0, dialog.scrollTop) / 32)));
      };
      const onScroll = () => { if (!frame) frame = requestAnimationFrame(update); };
      dialog.addEventListener("scroll", onScroll, { passive: true });
      update();
      return () => { dialog.removeEventListener("scroll", onScroll); cancelAnimationFrame(frame); };
    });
    return () => cleanups.forEach(cleanup => cleanup());
  }, []);

  const control = (name: "minimize" | "maximize" | "close") => void window.performanceWindow?.control(name);

  const runDiagnostics = async (kind: "simulate" | "verify-codec") => {
    setBusyAction(kind);
    setSimulationText([kind === "simulate" ? "正在用当前渲染器模拟计算负载，不会播放声音…" : "正在隔离进程中构造测试包并执行当前解析器，不读取或播放歌曲…"]);
    try {
      const result = await window.performanceMonitor?.action(kind) as SimulationResult | CodecVerifyResult | undefined;
      if (!result) { setSimulationText(null); return; }
      if (result.error) { setSimulationText([result.error]); return; }
      const lines: string[] = [];
      if (kind === "simulate") {
        const s = result as SimulationResult;
        lines.push(`原机 ${s.source.platform} / ${s.source.arch} → 本机 ${s.current.platform} / ${s.current.arch}。原机等效耗时倍率 ${s.scale.toFixed(2)}（估算）。`);
        lines.push(`抽样 ${s.testedSnapshots} / ${s.availableSnapshots} 个负载快照${s.traceTruncated ? "；日志已截断，仅覆盖最近部分" : ""}${s.traceDropped ? "；采集中存在丢失事件" : ""}。`);
        for (const row of s.rows) {
          lines.push(row.error
            ? `${new Date(row.time).toLocaleTimeString()}：未完成，${row.error}`
            : `${new Date(row.time).toLocaleTimeString()}：${row.measured.sources} 路声音，原日志实测 ${row.observedMeanBlockMs == null ? "未记录" : row.observedMeanBlockMs.toFixed(2) + " ms"}（与合成负载不完全等价）；每块本机 ${row.measured.meanBlockMs.toFixed(2)} ms，原机等效平均 ${row.equivalentMeanMs.toFixed(2)} ms / P95 ${row.equivalentP95Ms.toFixed(2)} ms；实时预算 ${row.measured.blockBudgetMs.toFixed(2)} ms。`);
        }
        s.limitations.forEach(line => lines.push(line));
      } else {
        const v = result as CodecVerifyResult;
        lines.push("解码错误路径验证 · 使用人工生成数据");
        const names: Record<string, string> = {
          "matching-failure-signature": "命中检查点及错误指纹", "checkpoint-only": "仅命中检查点，未确认相同错误",
          "not-reproduced": "未复现，不能据此认定已修复", unsupported: "尚无对应的合成用例",
        };
        const checkpoints: Record<string, string> = {
          "auto.sync_not_found": "格式识别：找不到同步头", "ac4.truncated_sync_frame": "AC-4：输入结束时帧不完整",
          "mpegh.mhas.packet_too_large": "360RA / MPEG-H：包长度超限", "iamf.leb.unterminated": "IAMF：整数编码未结束",
          "iamf.leb.overflow": "IAMF：整数溢出",
        };
        for (const row of v.results) lines.push(`${checkpoints[row.checkpoint] ?? row.checkpoint}：${names[row.status] ?? row.status}（${row.attempts} 个测试输入）。`);
        lines.push("命中错误路径不代表已重现原歌曲的全部缺陷。测试不包含原始音频、驱动或播放输出。");
      }
      lines.push(`结果：${result.path}`);
      setSimulationText(lines);
    } catch (error) {
      setSimulationText([String(error)]);
    } finally {
      setBusyAction(null);
    }
  };

  const h = snapshot.hardware ?? {};
  const n = snapshot.network ?? {};
  const recent: StageRow[] = snapshot.active ? [...(snapshot.rows ?? []), ...(snapshot.nativeRows ?? [])] : [];

  const highlight = (text: string, ...keys: string[]): Highlighted => ({
    text,
    peak: snapshot.active && keys.some(key => snapshot.peakKeys?.includes(key)),
    records: keys.map(key => snapshot.peakRecords?.[key]).filter(Boolean) as PeakRecord[],
    onShowPeak: records => { setPeakRecords(records); peakDialog.current?.showModal(); },
  });

  const hardwareCards: CardDef[] = [
    {
      label: "CPU",
      value: highlight(finite(h.totalMachinePercent) ? num(h.totalMachinePercent) + "%" : finite(h.cpuPercent) ? num(h.cpuPercent) + "%（单核）" : "等待采样", "cpu"),
      hint: "包含音频、界面与采集进程 · 点击查看各核心",
      onClick: () => coreDialog.current?.showModal(),
    },
    { label: "内存", value: highlight(size(h.workingSetBytes), "memory"), hint: "所有 SDA 进程工作集之和" },
    { label: "网络 接收 / 发送", value: highlight(`${size(n.rxBytesPerSecond)} / ${size(n.txBytesPerSecond)}`, "rx", "tx"), hint: "每秒传输；完整统计范围见下方说明" },
    { label: "读取 / 写入", value: highlight(`${size(h.readBytesPerSecond)} / ${size(h.writeBytesPerSecond)}`, "read", "write"), hint: "每秒文件与设备传输量" },
  ];

  const selectStage = (stage: string) => recent.filter(row => row.stage === stage);
  const maxOf = (stage: string) => {
    const rows = selectStage(stage);
    return rows.length ? Math.max(...rows.map(row => row.maxMs)) : null;
  };
  const decoded = selectStage("decode.output_audio").reduce((total, row) => total + row.units, 0) * 1000 / (snapshot.intervalMs || 1000);
  const gaps = selectStage("output.underrun_frames").reduce((total, row) => total + row.units, 0);
  const hrtfRows = recent.filter(row => row.stage.startsWith("hrtf.object."));
  const slowestHrtf = hrtfRows.length ? hrtfRows.reduce((a, b) => (a.maxMs > b.maxMs ? a : b)) : null;

  const flowCards: CardDef[] = [
    { label: "解码产出", value: highlight(`${num(decoded)} 秒音频 / 秒`, "decode"), hint: decoded ? "提前解码时可超过 1 秒" : "本秒无产出；可能暂停、等待或已有缓存" },
    { label: "对象双耳计算", value: highlight(slowestHrtf ? ms(slowestHrtf.maxMs) : "尚无对象计算", "hrtf"), hint: slowestHrtf ? `本秒单次最慢：${stageSource(slowestHrtf)}` : "开启对象渲染并播放后显示" },
    {
      label: "3D 绘制", value: highlight(ms(maxOf("3d.cpu_submit")), "3d"),
      hint: recent.some(row => row.stage === "3d.gpu_batch_elapsed")
        ? `CPU 单帧最高 · GPU 批次：${ms(maxOf("3d.gpu_batch_elapsed"))}（非单帧）`
        : `CPU 单帧最高 · GPU：${ms(maxOf("3d.gpu_elapsed"))}`,
    },
    { label: "房间应用", value: highlight(ms(maxOf("room.apply_including_queue")), "room"), hint: "本秒完成的任务，包含排队等待" },
    { label: "解码到双耳输出", value: highlight(ms(maxOf("decode.to_binaural_callback_estimate")), "latency"), hint: "本秒最高估算，不含蓝牙及耳机延迟" },
    {
      label: "音频缺口",
      value: gaps
        ? highlight(`${num(gaps / 48)} ms`, "gaps")
        : snapshot.nativeHeartbeatAgeMs == null ? "尚无输出数据" : snapshot.nativeHeartbeatAgeMs > 3000 ? "输出数据停止更新" : "本秒未记录缺口",
      hint: "仅表示原生输出队列是否缺少音频",
    },
  ];

  const alerts: string[] = [];
  if ((snapshot.mainHeartbeatAgeMs ?? 0) > 3000) alerts.push("主进程已超过 3 秒未更新");
  if (snapshot.main?.nativePid && (snapshot.nativeHeartbeatAgeMs ?? 0) > 3000) alerts.push("原生音频采样已超过 3 秒未更新");
  if (h.unavailable && !Array.isArray(h.unavailable)) alerts.push(`系统资源采样暂不可用：${h.unavailable}`);
  if (snapshot.errors?.length) alerts.push("采集出现异常，详细原因已写入日志");
  if (snapshot.dropped) alerts.push(`主进程采集丢失 ${snapshot.dropped} 条记录`);
  if (gaps) alerts.push("本秒出现音频断供，请查看输出与解码耗时");

  const tableRows = useMemo(() => {
    const base = scope === "session" ? (snapshot.cumulative ?? []) : recent;
    const needle = filter.toLowerCase();
    return base
      .filter(row => !row.stage.endsWith(".begin") && !row.stage.endsWith(".heartbeat"))
      .filter(row => (category === "all" || stageDefinition(row.stage)[1] === category))
      .filter(row => `${stageDefinition(row.stage)[0]} ${stageSource(row)} ${row.stage} ${row.id}`.toLowerCase().includes(needle));
  }, [scope, category, filter, snapshot, recent]);

  const status = snapshotError
    ? `窗口连接异常：${snapshotError}`
    : snapshot.active
      ? `后台记录中 · 每秒更新${snapshotAge != null ? ` · 快照 ${snapshotAge} 秒前` : ""}`
      : snapshot.starting ? "正在启动采集进程…" : "记录已暂停";

  return (
    <>
      <div className="window-titlebar" onDoubleClick={() => control("maximize")}>
        <span className="window-caption">SDA 性能监视器</span>
        <div className="window-actions">
          <button title="最小化" aria-label="最小化" onClick={() => control("minimize")}><Minus size={15} /></button>
          <button title={maximized ? "还原窗口" : "最大化"} aria-label={maximized ? "还原窗口" : "最大化"} onClick={() => control("maximize")}>
            {maximized ? <Copy size={13} /> : <Square size={13} />}
          </button>
          <button className="window-close" title="关闭窗口" aria-label="关闭窗口" onClick={() => control("close")}><X size={17} /></button>
        </div>
      </div>

      <header className="perf-header">
        <h1>SDA 性能监视器</h1>
        <span className="perf-status">{status}</span>
        <button onClick={() => void action(snapshot.active ? "toggle" : "resume")}>{snapshot.active ? "暂停记录" : "继续记录"}</button>
        <button disabled={busyAction !== null} onClick={() => void runDiagnostics("verify-codec")}>验证解码故障</button>
        <button disabled={busyAction !== null} onClick={() => void runDiagnostics("simulate")}>导入日志模拟</button>
        <button onClick={() => void action("export")}>导出日志</button>
      </header>

      <main className="perf-main">
        <div className={"perf-notice" + (alerts.length ? " warning" : "")}>
          {alerts.length
            ? alerts.join("；")
            : snapshot.active
              ? "正在收集性能数据。复现卡顿后点击“导出日志”即可，无需选择保存位置。"
              : snapshot.starting
                ? "正在启动采集进程，几秒后开始记录。"
                : "记录未开启。点击“继续记录”开始采集，或在主窗口按 Ctrl+Alt+Shift+D 开启。"}
        </div>
        <p className="perf-path">自动保存：{snapshot.directory ?? "等待目录"}</p>

        {simulationText && (
          <section className="perf-notice" style={{ marginBottom: 12 }}>
            {simulationText.map((line, index) => <p key={index}>{line}</p>)}
          </section>
        )}

        <h2>电脑资源 · SDA 及其子进程</h2>
        <CardGrid cards={hardwareCards} />

        <h2>声音与画面 · 最近一秒</h2>
        <CardGrid cards={flowCards} />
        <div className="perf-notice warning" style={{ display: (snapshot.pending ?? []).length ? undefined : "none", marginTop: 12 }}>
          {(snapshot.pending ?? []).map(pending => `${stageDefinition(pending.stage)[0]}：已等待 ${num(pending.waitingMs / 1000, 1)} 秒`).join("；")}
        </div>

        <h2>每个处理步骤用了多久</h2>
        <div className="perf-toolbar">
          <select value={scope} onChange={event => setScope(event.target.value as Scope)} aria-label="统计期间">
            <option value="second">最近一秒</option>
            <option value="session">整个记录期间</option>
          </select>
          <select value={category} onChange={event => setCategory(event.target.value)} aria-label="处理类别">
            {Object.entries(categoryLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input value={filter} onChange={event => setFilter(event.target.value)} placeholder="查找步骤、对象或声道" aria-label="查找处理步骤" />
        </div>
        <p className="perf-hint">红色数字表示达到本次监测峰值，回落后恢复；不等于发生故障。点击旁边的 i 查看当时的歌曲与播放时间，回落后仍可查看。最低 / 平均 / 最高是单次处理时间；累计是选定期间所有调用的总和。双耳定位滤波即 HRTF。没有经过的路径不产生测量值。</p>
        <div className="perf-table-wrap">
          <table>
            <thead><tr><th>处理步骤</th><th>对象 / 声道</th><th>调用次数</th><th>最低</th><th>平均</th><th>最高</th><th>累计</th><th>处理量</th></tr></thead>
            <tbody>
              {tableRows.length === 0 ? (
                <tr><td colSpan={8} className="perf-empty">该期间尚无对应数据。播放音频或操作对应功能后会显示。</td></tr>
              ) : tableRows.map(row => {
                const [, , unit] = stageDefinition(row.stage);
                const counter = ["byte", "triangle", "unavailable", "gap", "audio"].includes(unit) && row.totalMs === 0;
                const cell = (value: string, key?: string): string | Highlighted => (counter ? "—" : key ? highlight(value, key) : value);
                return (
                  <tr key={row.stage + ":" + (row.id ?? "")}>
                    <td>{stageDefinition(row.stage)[0]}</td>
                    <td>{stageSource(row)}</td>
                    <td>{num(row.count, 0)}</td>
                    <td><Value value={cell(ms(row.minMs))} /></td>
                    <td><Value value={cell(ms(row.totalMs / row.count))} /></td>
                    <td><Value value={cell(ms(row.maxMs), "stage:" + row.stage + ":" + (row.id ?? ""))} /></td>
                    <td><Value value={cell(ms(row.totalMs))} /></td>
                    <td><Value value={cell(work(row, unit), "work:" + row.stage + ":" + (row.id ?? ""))} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <details>
          <summary>查看各进程占用</summary>
          <div className="perf-table-wrap">
            <table>
              <thead><tr><th>进程</th><th>进程编号</th><th>CPU（单核）</th><th>内存</th><th>读取 / 秒</th><th>写入 / 秒</th></tr></thead>
              <tbody>
                {(h.processes ?? []).length === 0 ? (
                  <tr><td colSpan={6} className="perf-empty">等待采样</td></tr>
                ) : (h.processes ?? []).map(process => (
                  <tr key={process.pid}>
                    <td>{process.name}</td>
                    <td>{process.pid}</td>
                    <td>{finite(process.cpuPercent) ? num(process.cpuPercent) + "%" : "等待采样"}</td>
                    <td>{size(process.workingSetBytes)}</td>
                    <td>{size(process.readBytesPerSecond)}</td>
                    <td>{size(process.writeBytesPerSecond)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
        <details>
          <summary>这些数字能说明什么？</summary>
          <p>解码速度表示这一秒产出了多少秒音频。提前解码、暂停或已有缓存时，数值可能很高或为零，不单独代表卡顿。音频缺口表示输出回调没有拿到足够的数据，需要结合计算耗时和等待时间判断原因。</p>
          <p>“解码到双耳输出”是软件回调时间估算，不包含驱动、蓝牙和耳机真正发声的延迟。3D 数字是每帧耗时，不是显卡整体占用率。多个步骤可能相互包含或并行执行，不能把所有累计时间直接相加。</p>
          <p>网络显示主进程 TCP、Chromium HTTP 和已上报的 WebRTC / 原生传输统计，不是系统抓包，回环通信可能重复计数。Windows 读取/写入包含进程的文件与设备传输，不等于物理硬盘吞吐。</p>
          <p>采集器独立运行；主界面卡住时仍写日志。监控本身也有开销，精细计时不是零成本。未支持、尚未测量或停止更新的指标会标明，不用零伪装正常。日志保存在程序目录的 outlogs，目录不可写会自动换到用户数据目录并提示。</p>
        </details>
      </main>

      <dialog ref={coreDialog} className="perf-dialog" onClick={event => { if (event.target === coreDialog.current) coreDialog.current?.close(); }}>
        <div className="perf-sheet-heading">
          <h2>各核心占用</h2>
          <button className="perf-sheet-close" onClick={() => coreDialog.current?.close()} aria-label="关闭各核心占用">
            <GlassRefraction strength={10} />
            <X size={20} />
          </button>
        </div>
        <div>
          <p className="perf-hint">
            {finite(h.totalMachinePercent) ? `总 CPU ${num(h.totalMachinePercent)}% · ` : ""}
            {(h.perCoreCpu?.length ?? 0)} 个逻辑核心 · 采样来自系统调度器 · 每秒刷新
          </p>
          <div>
            {(h.perCoreCpu ?? []).map((pct, index) => (
              <div className="core-row" key={index}>
                <span className="core-label">核心 {index}</span>
                <div className="core-track"><div className="core-fill" style={{ width: Math.min(100, pct).toFixed(1) + "%", background: pct > 80 ? "var(--bar-fill-hot)" : pct > 50 ? "var(--bar-fill-warn)" : "var(--bar-fill)" }} /></div>
                <span className="core-pct">{num(pct)}%</span>
              </div>
            ))}
          </div>
        </div>
      </dialog>

      <dialog ref={peakDialog} className="perf-dialog" onClick={event => { if (event.target === peakDialog.current) peakDialog.current?.close(); }}>
        <div className="perf-sheet-heading">
          <h2>峰值发生在哪里</h2>
          <button className="perf-sheet-close" onClick={() => peakDialog.current?.close()} aria-label="关闭峰值详情">
            <GlassRefraction strength={10} />
            <X size={20} />
          </button>
        </div>
        <div>
          {(peakRecords ?? []).map((record, index) => {
            const playback = record.playback;
            const note = !playback
              ? "这次峰值没有可靠的歌曲上下文，不会套用当前歌曲。"
              : playback.uncertain
                ? `播放进度在峰值前 ${num((playback.ageMs ?? 0) / 1000, 1)} 秒最后更新，只能作为参考，无法确认精确歌曲位置。`
                : "这是峰值发生时的播放位置，约 1 秒采样精度；解码和渲染可能提前处理后面的音频。切歌不会更改这条记录。";
            return (
              <section key={index} className="perf-peak-section">
                <h3 style={{ fontSize: 15 }}>{peakName(record)}</h3>
                <dl>
                  {([
                    ["歌曲", playback?.title || "当时未收到歌曲信息"],
                    ["歌手", playback?.artist || "未提供"],
                    ["歌曲位置", playback ? songTime(playback.position ?? NaN) : "无法确定"],
                    ["发生时刻", new Date(record.time).toLocaleString("zh-CN", { hour12: false })],
                    ["峰值", peakAmount(record)],
                    ["当时状态", playback ? (playback.loading ? "正在加载" : playback.paused ? "已暂停" : playback.playing ? "播放中" : "未播放") : "未知"],
                  ] as const).map(([label, value]) => (
                    <Fragment key={label}><dt>{label}</dt><dd>{value}</dd></Fragment>
                  ))}
                </dl>
                <p className="perf-hint">{note}</p>
              </section>
            );
          })}
        </div>
      </dialog>
    </>
  );
}
