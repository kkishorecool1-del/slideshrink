import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent, FormEvent } from 'react';
import { ArrowDownToLine, Check, ChevronDown, FileCheck2, FileText, Gauge, HardDrive, LockKeyhole, RefreshCw, ShieldCheck, Sparkles, Trash2, UploadCloud, X, Zap } from 'lucide-react';

type FileResult = {
  original_name: string; original_bytes: number; output_bytes: number; saved_bytes: number;
  saved_percent: number; status: 'queued' | 'processing' | 'complete' | 'error'; message: string;
  stats?: { images_optimized?: number; target_reached?: boolean; attempt_scale?: number };
  download_url?: string | null;
};
type Job = { job_id: string; status: string; progress: number; message: string; files: FileResult[]; error?: string | null };
type Preset = 'high' | 'balanced' | 'smallest';

const MAX_FILES = 10;
const MAX_FILE_BYTES = 100 * 1024 * 1024;
// Backend origin: build-time VITE_API_BASE, overridden at runtime by a URL the
// user saves in the browser (so a deployed site can be re-pointed without a
// rebuild). Empty = same-origin (local Vite proxy / Docker single service).
const BUILD_API_BASE = (import.meta.env.VITE_API_BASE || '').replace(/\/+$/, '');
const API_BASE_KEY = 'slideshrink_api_base';
const readStoredBase = (): string => {
  try { return (window.localStorage.getItem(API_BASE_KEY) || '').replace(/\/+$/, ''); } catch { return ''; }
};
const resolveApiBase = (): string => readStoredBase() || BUILD_API_BASE;
const apiUrl = (path: string) => `${resolveApiBase()}${path}`;
// Accepts "host.tld", "host.tld/path", or a full URL; keeps http:// as-is.
const normalizeBase = (raw: string): string => {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!trimmed) return '';
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};
const storeBase = (raw: string): void => {
  const normalized = normalizeBase(raw);
  try {
    if (normalized) window.localStorage.setItem(API_BASE_KEY, normalized);
    else window.localStorage.removeItem(API_BASE_KEY);
  } catch { /* storage unavailable (private mode): falls back to build-time base */ }
};
const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB']; const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
};

export default function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [preset, setPreset] = useState<Preset>('balanced');
  const [targetEnabled, setTargetEnabled] = useState(false);
  const [targetMb, setTargetMb] = useState('10');
  const [job, setJob] = useState<Job | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'processing'>('idle');
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [health, setHealth] = useState<'checking' | 'online' | 'offline'>('checking');
  const [apiDraft, setApiDraft] = useState('');
  const [healthNonce, setHealthNonce] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const pollRef = useRef<number | null>(null);

  const checkHealth = useCallback(() => {
    setHealth('checking');
    fetch(apiUrl('/api/health')).then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(() => setHealth('online')).catch(() => setHealth('offline'));
  }, []);

  useEffect(() => {
    checkHealth();
    return () => { if (pollRef.current) window.clearInterval(pollRef.current); };
  }, [checkHealth, healthNonce]);

  // Save a backend origin at runtime so a deployed build can be re-pointed
  // without rebuilding, then immediately re-test the connection.
  const saveBackendUrl = (event: FormEvent) => {
    event.preventDefault();
    storeBase(apiDraft);
    setApiDraft('');
    setError('');
    setHealthNonce(n => n + 1);
  };

  const addFiles = useCallback((incoming: FileList | File[]) => {
    setError('');
    const list = Array.from(incoming);
    const invalid = list.find(f => !f.name.toLowerCase().endsWith('.pptx'));
    if (invalid) { setError(`${invalid.name}: only .pptx files are supported. Save legacy .ppt files as .pptx first.`); return; }
    const tooLarge = list.find(f => f.size > MAX_FILE_BYTES);
    if (tooLarge) { setError(`${tooLarge.name} exceeds the 100 MB per-file limit.`); return; }
    setFiles(previous => {
      const combined = [...previous];
      for (const f of list) if (!combined.some(old => old.name === f.name && old.size === f.size && old.lastModified === f.lastModified)) combined.push(f);
      if (combined.length > MAX_FILES) { setError(`A maximum of ${MAX_FILES} files can be processed in one batch.`); return previous; }
      return combined;
    });
    setJob(null);
  }, []);

  const onInput = (event: ChangeEvent<HTMLInputElement>) => { if (event.target.files) addFiles(event.target.files); event.target.value = ''; };
  const onDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); if (event.dataTransfer.files) addFiles(event.dataTransfer.files); };

  const pollJob = (jobId: string) => {
    if (pollRef.current) window.clearInterval(pollRef.current);
    const poll = async () => {
      try {
        const response = await fetch(apiUrl(`/api/jobs/${jobId}`));
        const data = await response.json();
        if (!response.ok) throw new Error(data.detail || 'Unable to get job status.');
        setPhase('processing');
        setJob(data as Job);
        if (['complete', 'error'].includes(data.status)) {
          setBusy(false);
          setPhase('idle');
          if (pollRef.current) window.clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not refresh progress.');
        setBusy(false);
        setPhase('idle');
        if (pollRef.current) window.clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
    void poll();
    pollRef.current = window.setInterval(poll, 1000);
  };

  const startCompression = () => {
    if (!files.length || busy) return;
    if (targetEnabled && (!Number.isFinite(Number(targetMb)) || Number(targetMb) <= 0)) { setError('Enter a target size greater than 0 MB.'); return; }
    setError(''); setBusy(true); setJob(null); setUploadPct(0); setPhase('uploading');
    const body = new FormData(); files.forEach(file => body.append('files', file));
    body.append('preset', preset);
    if (targetEnabled) body.append('target_mb', targetMb);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', apiUrl('/api/jobs'));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        setUploadPct(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      }
    };
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        if (xhr.status < 200 || xhr.status >= 300) throw new Error(data.detail || 'Upload failed.');
        setUploadPct(100);
        setPhase('processing');
        pollJob(data.job_id);
      } catch (e) {
        setBusy(false); setPhase('idle'); setError(e instanceof Error ? e.message : 'Could not start compression.');
      }
    };
    xhr.onerror = () => { setBusy(false); setPhase('idle'); setError('Could not start compression. Check the backend connection.'); };
    xhr.send(body);
  };

  const reset = async () => {
    if (job?.job_id) { try { await fetch(apiUrl(`/api/jobs/${job.job_id}`), { method: 'DELETE' }); } catch { /* best-effort cleanup */ } }
    if (pollRef.current) window.clearInterval(pollRef.current);
    pollRef.current = null; setJob(null); setFiles([]); setError(''); setBusy(false); setUploadPct(0); setPhase('idle');
  };

  const completed = job?.files.filter(f => f.status === 'complete') ?? [];
  const originalTotal = completed.reduce((sum, f) => sum + f.original_bytes, 0);
  const outputTotal = completed.reduce((sum, f) => sum + f.output_bytes, 0);
  const savedTotal = Math.max(0, originalTotal - outputTotal);
  const savedPct = originalTotal ? Math.round(savedTotal / originalTotal * 100) : 0;

  return <main className="app-shell">
    <header className="topbar">
      <a className="brand" href="#top" aria-label="SlideShrink home"><span className="brand-icon"><FileCheck2 size={21} /></span><span>SlideShrink<span className="brand-dot">.</span><small>POWERPOINT COMPRESSOR</small></span></a>
      <div className="topbar-right"><span className={`status-dot ${health}`} /> <span>{health === 'online' ? 'Local engine ready' : health === 'offline' ? 'Backend offline' : 'Checking engine'}</span><span className="privacy-pill"><LockKeyhole size={13}/> Local processing</span></div>
    </header>

    <section className="hero" id="top">
      <div className="eyebrow"><Sparkles size={14}/> A lighter way to present</div>
      <h1>Big ideas.<br/><span>Smaller files.</span></h1>
      <p className="hero-copy">Reduce PowerPoint file sizes without rebuilding your slides. Your files stay on your Mac or trusted local network.</p>
      <div className="trust-row"><span><ShieldCheck size={16}/> Original files stay untouched</span><span><Zap size={16}/> Batch-ready</span><span><HardDrive size={16}/> No cloud upload</span></div>
    </section>

    <section className="workspace">
      <div className="section-heading"><div><span className="step-label">01 / ADD FILES</span><h2>Choose your presentations</h2><p>Upload PPTX files you want to make smaller.</p></div><span className="file-limit">Up to {MAX_FILES} files · 100 MB each</span></div>
      <div className={`dropzone ${dragging ? 'is-dragging' : ''}`} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={onDrop} onClick={() => fileInput.current?.click()} role="button" tabIndex={0} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInput.current?.click(); }}>
        <input ref={fileInput} type="file" accept=".pptx,application/vnd.openxmlformats-officedocument.presentationml.presentation" multiple hidden onChange={onInput}/>
        <div className="upload-icon"><UploadCloud size={28}/></div><h3>Drop your PowerPoint files here</h3><p>or <span>browse from your Mac</span></p><small>PowerPoint Open XML · .pptx only</small>
      </div>

      {files.length > 0 && <div className="file-list"><div className="file-list-header"><strong>{files.length} {files.length === 1 ? 'file' : 'files'} selected</strong><button className="text-button" onClick={e => { e.stopPropagation(); setFiles([]); setError(''); }} disabled={busy}>Remove all</button></div>{files.map((file, i) => <div className="file-row" key={`${file.name}-${file.size}-${i}`}><div className="file-type-icon"><FileText size={20}/></div><div className="file-info"><strong title={file.name}>{file.name}</strong><small>{formatBytes(file.size)}</small></div><button className="icon-button" aria-label={`Remove ${file.name}`} disabled={busy} onClick={() => setFiles(prev => prev.filter((_, index) => index !== i))}><X size={17}/></button></div>)}</div>}

      <div className="section-heading settings-heading"><div><span className="step-label">02 / TUNE COMPRESSION</span><h2>Find your file-size sweet spot</h2><p>Choose a quality preset, then optionally set a target size.</p></div></div>
      <div className="preset-grid">
        <button className={`preset-card ${preset === 'high' ? 'selected' : ''}`} onClick={() => setPreset('high')} disabled={busy}><span className="preset-symbol"><ShieldCheck size={20}/></span><span className="preset-name">High quality</span><span className="preset-desc">Prioritize image detail</span>{preset === 'high' && <Check className="selected-check" size={17}/>}</button>
        <button className={`preset-card ${preset === 'balanced' ? 'selected' : ''}`} onClick={() => setPreset('balanced')} disabled={busy}><span className="preset-symbol"><Gauge size={20}/></span><span className="preset-name">Balanced</span><span className="preset-desc">Quality meets savings</span><span className="recommended">RECOMMENDED</span>{preset === 'balanced' && <Check className="selected-check" size={17}/>}</button>
        <button className={`preset-card ${preset === 'smallest' ? 'selected' : ''}`} onClick={() => setPreset('smallest')} disabled={busy}><span className="preset-symbol"><Zap size={20}/></span><span className="preset-name">Smallest size</span><span className="preset-desc">Prioritize file reduction</span>{preset === 'smallest' && <Check className="selected-check" size={17}/>}</button>
      </div>
      <button className={`target-toggle ${targetEnabled ? 'open' : ''}`} onClick={() => setTargetEnabled(!targetEnabled)} disabled={busy}><span className="target-left"><span className="target-icon"><HardDrive size={18}/></span><span><strong>Try to reach a target size</strong><small>The app will make stronger optimization attempts if needed.</small></span></span><ChevronDown size={18} className={targetEnabled ? 'rotate' : ''}/></button>
      {targetEnabled && <div className="target-panel"><label htmlFor="target-size">Target size (MB)</label><div className="target-input-wrap"><input id="target-size" type="number" min="0.1" max="10000" step="0.5" value={targetMb} onChange={e => setTargetMb(e.target.value)} disabled={busy}/><span>MB</span></div><p>Target size is a best-effort goal, not a guarantee. If it cannot be reached, the smallest validated result is returned.</p></div>}

      {error && <div className="error-banner" role="alert"><X size={18}/><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error"><X size={15}/></button></div>}
      {health === 'offline' && <div className="warning-banner" role="alert"><RefreshCw size={17}/><div className="banner-body">
        <span>Cannot reach the backend{resolveApiBase() ? <> at <strong>{resolveApiBase()}</strong></> : <> (requests go to this site itself)</>}. Deploy the FastAPI backend, then paste its address below — or start it locally and open this page from the same machine.</span>
        <form className="backend-form" onSubmit={saveBackendUrl}>
          <input type="text" inputMode="url" placeholder="https://your-backend.example.com" value={apiDraft} onChange={e => setApiDraft(e.target.value)} aria-label="Backend base URL" />
          <button type="submit" disabled={!apiDraft.trim()}>Connect</button>
          {resolveApiBase() && <button type="button" className="ghost" onClick={() => { storeBase(''); setApiDraft(''); setHealthNonce(n => n + 1); }}>Reset</button>}
        </form>
        <small>The address is remembered in this browser only. The backend must allow this origin (<code>SLIDESHRINK_CORS_ORIGINS</code>).</small>
      </div></div>}
      <button className="primary-button" onClick={startCompression} disabled={!files.length || busy || health !== 'online'}>{busy ? <><RefreshCw className="spin" size={18}/> Compressing your files…</> : <>Compress PowerPoint files <ArrowDownToLine size={18}/></>}<span>{files.length > 0 && !busy ? `${files.length} ${files.length === 1 ? 'file' : 'files'}` : ''}</span></button>
      {busy && <div className="compress-progress" aria-live="polite">
        <div className="compress-progress-top">
          <span>{phase === 'uploading' ? 'Uploading files…' : `Compressing… ${job?.message || 'Working on your files'}`}</span>
          <strong>{phase === 'uploading' ? `${uploadPct}%` : `${job?.progress ?? 0}%`}</strong>
        </div>
        <div className="compress-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={phase === 'uploading' ? uploadPct : (job?.progress ?? 0)}>
          <div className={`compress-progress-fill ${phase === 'uploading' && uploadPct <= 0 ? 'indeterminate' : ''}`} style={phase === 'uploading' && uploadPct <= 0 ? undefined : { width: `${phase === 'uploading' ? uploadPct : (job?.progress ?? 0)}%` }} />
        </div>
      </div>}
      <p className="safe-note"><LockKeyhole size={13}/> Files are processed by your local backend and automatically cleaned up after the retention period.</p>
    </section>

    {job && <section className="results-section" aria-live="polite"><div className="section-heading"><div><span className="step-label">03 / RESULTS</span><h2>{job.status === 'processing' ? 'Making your files lighter' : job.status === 'error' ? 'Processing needs attention' : 'Your results are ready'}</h2><p>{job.message}</p></div>{job.status === 'complete' && <button className="secondary-button" onClick={reset}><Trash2 size={16}/> Start over</button>}</div>
      {job.status === 'processing' && <div className="progress-card"><div className="progress-top"><span>Processing batch</span><strong>{job.progress}%</strong></div><div className="progress-track"><div className="progress-fill" style={{ width: `${job.progress}%` }}/></div><small>{job.message}</small></div>}
      {completed.length > 0 && <div className="summary-grid"><div className="summary-card"><span>Original size</span><strong>{formatBytes(originalTotal)}</strong></div><div className="summary-card"><span>Compressed size</span><strong>{formatBytes(outputTotal)}</strong></div><div className="summary-card savings"><span>Total saved</span><strong>{formatBytes(savedTotal)}</strong><small>{savedPct}% smaller across successful files</small></div></div>}
      <div className="result-list">{job.files.map((result, i) => <div className="result-row" key={`${result.original_name}-${i}`}><div className={`result-file-icon ${result.status}`}><FileText size={20}/></div><div className="result-main"><strong title={result.original_name}>{result.original_name}</strong><div className="result-meta">{result.status === 'complete' ? <><span>{formatBytes(result.original_bytes)} <span className="arrow">→</span> {formatBytes(result.output_bytes)}</span><span className={result.saved_bytes > 0 ? 'saved-text' : ''}>{result.saved_bytes > 0 ? `−${result.saved_percent}%` : 'No reduction'}</span></> : <span className={result.status === 'error' ? 'error-text' : ''}>{result.message}</span>}</div>{result.status === 'complete' && result.stats?.target_reached === false && targetEnabled && <small className="target-warning">Target not reached; best validated result returned.</small>}</div>{result.status === 'complete' && result.download_url ? <a className="download-button" href={apiUrl(result.download_url)} download><ArrowDownToLine size={16}/> Download</a> : result.status === 'error' ? <span className="failed-label">Failed</span> : <span className="processing-label">{result.status}</span>}</div>)}</div>
      {job.status === 'complete' && completed.length > 1 && <a className="download-all" href={apiUrl(`/api/jobs/${job.job_id}/download-all`)}><ArrowDownToLine size={18}/> Download all successful files (.zip)</a>}
      {job.status === 'complete' && <p className="validation-note"><ShieldCheck size={15}/> Output packages were integrity-checked. We recommend opening important presentations in PowerPoint to confirm visual appearance, animations, and embedded content.</p>}
    </section>}

    <section className="how-section"><div className="section-heading"><div><span className="step-label">MADE FOR YOUR WORKFLOW</span><h2>Less file weight. Same big idea.</h2></div></div><div className="benefit-grid"><article><span><LockKeyhole size={19}/></span><h3>Private by design</h3><p>Runs on your Mac or trusted local network. No third-party file hosting is required.</p></article><article><span><Sparkles size={19}/></span><h3>Smart optimization</h3><p>Targets supported raster images while keeping other presentation assets unchanged.</p></article><article><span><FileCheck2 size={19}/></span><h3>Keep control</h3><p>Original files are never overwritten. Download a separate optimized copy and compare sizes.</p></article></div></section>
    <footer><a className="footer-brand" href="#top">SlideShrink<span>.</span></a><span>Local-first PowerPoint optimization</span><span className="footer-version">v1.0 · PPTX only</span></footer>
  </main>;
}
