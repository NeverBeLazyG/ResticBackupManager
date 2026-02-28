import React, { useState, useEffect, useCallback } from 'react';
import { useToast } from '../ToastContext';
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime';
import {
    GetRepositories, StartBackup, CancelBackup, SelectFolders, InitRepository
} from '../../wailsjs/go/main/App';

interface Repo { id: string; name: string; uri: string; password: string; }
interface Progress {
    message_type: string;
    percent_done: number;
    total_files: number;
    files_done: number;
    total_bytes: number;
    bytes_done: number;
    current_files: string[];
    seconds_elapsed: number;
    seconds_remaining: number;
    files_new: number;
    files_changed: number;
    data_added: number;
    snapshot_id: string;
}

function fmt(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}
function fmtTime(s: number): string {
    if (!s || s < 0) return '–';
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}
function speed(bytes: number, secs: number): string {
    if (!secs || secs < 1) return '–';
    return fmt(bytes / secs) + '/s';
}

export default function Backup() {
    const { addToast } = useToast();
    const [repos, setRepos] = useState<Repo[]>([]);
    const [selectedRepo, setSelectedRepo] = useState('');
    const [paths, setPaths] = useState<string[]>([]);
    const [excludes, setExcludes] = useState<string[]>(['node_modules', '.git', '__pycache__']);
    const [excludeInput, setExcludeInput] = useState('');
    const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
    const [progress, setProgress] = useState<Progress | null>(null);
    const [summary, setSummary] = useState<Progress | null>(null);
    const [errMsg, setErrMsg] = useState('');
    const [initializing, setInitializing] = useState(false);

    useEffect(() => {
        GetRepositories().then((r: Repo[]) => {
            setRepos(r || []);
            if (r?.length > 0) setSelectedRepo(r[0].id);
        });
    }, []);

    useEffect(() => {
        EventsOn('backup:progress', (p: Progress) => {
            if (p.message_type === 'status') setProgress(p);
            else if (p.message_type === 'summary') setSummary(p);
        });
        EventsOn('backup:complete', () => { setStatus('done'); });
        EventsOn('backup:error', (msg: string) => { setStatus('error'); setErrMsg(msg); });
        return () => { EventsOff('backup:progress'); EventsOff('backup:complete'); EventsOff('backup:error'); };
    }, []);

    const addPaths = useCallback(async () => {
        try {
            const dirs = await SelectFolders();
            if (dirs && dirs.length > 0) setPaths(p => [...new Set([...p, ...dirs])]);
        } catch (e: unknown) { addToast({ type: 'error', title: 'Error', message: String(e) }); }
    }, [addToast]);

    const addExclude = () => {
        const v = excludeInput.trim();
        if (v && !excludes.includes(v)) setExcludes(p => [...p, v]);
        setExcludeInput('');
    };

    const start = async () => {
        if (!selectedRepo) { addToast({ type: 'warning', title: 'No repository selected' }); return; }
        if (paths.length === 0) { addToast({ type: 'warning', title: 'No source folders selected' }); return; }
        setStatus('running'); setProgress(null); setSummary(null); setErrMsg('');
        try {
            await StartBackup({ repoId: selectedRepo, sourcePaths: paths, excludes, tags: [] });
        } catch (e: unknown) { setStatus('error'); setErrMsg(String(e)); }
    };

    const cancel = async () => {
        await CancelBackup();
        setStatus('idle');
        addToast({ type: 'info', title: 'Backup cancelled' });
    };

    const reset = () => { setStatus('idle'); setProgress(null); setSummary(null); };
    const pct = progress ? Math.round(progress.percent_done * 100) : 0;

    return (
        <div>
            <div className="row" style={{ marginBottom: 20 }}>
                <div className="grow">
                    <h2 style={{ fontSize: 20, fontWeight: 700 }}>Backup</h2>
                    <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>Create a new Restic snapshot</p>
                </div>
            </div>

            {/* Repository */}
            <div className="card section">
                <div className="card-header"><div className="card-title">🗄️ Repository</div></div>
                {repos.length === 0
                    ? <p style={{ color: 'var(--text-3)', fontSize: 13 }}>No repositories configured.</p>
                    : <select value={selectedRepo} onChange={e => setSelectedRepo(e.target.value)} disabled={status === 'running'}>
                        {repos.map(r => <option key={r.id} value={r.id}>{r.name} — {r.uri}</option>)}
                    </select>}
            </div>

            {/* Source paths */}
            <div className="card section">
                <div className="card-header">
                    <div className="card-title">📁 Source Folders</div>
                    <button className="btn btn-secondary btn-sm" onClick={addPaths} disabled={status === 'running'}>
                        + Add Folder
                    </button>
                </div>
                {paths.length === 0
                    ? <p style={{ color: 'var(--text-3)', fontSize: 13 }}>No folders selected yet.</p>
                    : <div className="paths-list">
                        {paths.map(p => (
                            <div key={p} className="path-item">
                                <span>📁 {p}</span>
                                <span className="path-remove" onClick={() => setPaths(ps => ps.filter(x => x !== p))}>✕</span>
                            </div>
                        ))}
                    </div>}
            </div>

            {/* Excludes */}
            <div className="card section">
                <div className="card-header"><div className="card-title">🚫 Excludes</div></div>
                <div className="input-row" style={{ marginBottom: 10 }}>
                    <input placeholder="e.g. *.tmp or node_modules" value={excludeInput}
                        onChange={e => setExcludeInput(e.target.value)}
                        onKeyDown={e => e.key === 'Enter' && addExclude()} disabled={status === 'running'} />
                    <button className="btn btn-secondary btn-sm" onClick={addExclude} disabled={status === 'running'}>
                        Add
                    </button>
                </div>
                <div className="tags-wrap">
                    {excludes.map(ex => (
                        <span key={ex} className="tag-chip">
                            {ex}
                            <span className="tag-remove" onClick={() => setExcludes(p => p.filter(x => x !== ex))}>✕</span>
                        </span>
                    ))}
                </div>
            </div>

            {status === 'idle' && (
                <div className="row">
                    <button className="btn btn-primary btn-lg" onClick={start} disabled={paths.length === 0 || !selectedRepo}>
                        ▶ Start Backup
                    </button>
                </div>
            )}

            {status === 'running' && (
                <div className="status-card">
                    <div className="row" style={{ marginBottom: 12 }}>
                        <div className="grow" style={{ fontWeight: 600 }}>⏳ Backup running... {pct}%</div>
                        <button className="btn btn-danger btn-sm" onClick={cancel}>⏹ Cancel</button>
                    </div>
                    <div className="progress-bar-wrap">
                        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    {progress && (
                        <div className="progress-stats">
                            <div className="stat-item">
                                <div className="stat-val">{progress.files_done.toLocaleString()}</div>
                                <div className="stat-label">Files /{progress.total_files.toLocaleString()}</div>
                            </div>
                            <div className="stat-item">
                                <div className="stat-val">{fmt(progress.bytes_done)}</div>
                                <div className="stat-label">of {fmt(progress.total_bytes)}</div>
                            </div>
                            <div className="stat-item">
                                <div className="stat-val">{speed(progress.bytes_done, progress.seconds_elapsed)}</div>
                                <div className="stat-label">Speed</div>
                            </div>
                            <div className="stat-item">
                                <div className="stat-val">{fmtTime(progress.seconds_remaining)}</div>
                                <div className="stat-label">Remaining</div>
                            </div>
                        </div>
                    )}
                    {progress?.current_files?.[0] && (
                        <div className="current-file">📄 {progress.current_files[0]}</div>
                    )}
                </div>
            )}

            {status === 'done' && summary && (
                <div className="status-card" style={{ borderColor: 'var(--success)' }}>
                    <div style={{ color: 'var(--success)', fontWeight: 700, fontSize: 16, marginBottom: 16 }}>
                        ✅ Backup successful!
                    </div>
                    <div className="progress-stats">
                        <div className="stat-item">
                            <div className="stat-val" style={{ color: 'var(--success)' }}>{summary.files_new}</div>
                            <div className="stat-label">New files</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-val" style={{ color: 'var(--warning)' }}>{summary.files_changed}</div>
                            <div className="stat-label">Changed</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-val">{fmt(summary.data_added)}</div>
                            <div className="stat-label">Data added</div>
                        </div>
                        <div className="stat-item">
                            <div className="stat-val" style={{ fontSize: 13 }}>{summary.snapshot_id}</div>
                            <div className="stat-label">Snapshot ID</div>
                        </div>
                    </div>
                    <div style={{ marginTop: 16 }}>
                        <button className="btn btn-secondary" onClick={reset}>↩ New Backup</button>
                    </div>
                </div>
            )}

            {status === 'error' && (
                <div className="status-card" style={{ borderColor: 'var(--danger)' }}>
                    <div style={{ color: 'var(--danger)', fontWeight: 700, marginBottom: 8 }}>❌ Backup failed</div>
                    <p style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 16 }}>{errMsg}</p>

                    {/* Wenn Repo nicht initialisiert: Initialize-Button direkt anbieten */}
                    {errMsg.includes('not initialized') && (() => {
                        const repo = repos.find(r => r.id === selectedRepo);
                        return repo ? (
                            <div style={{
                                background: 'var(--bg-2)', border: '1px solid var(--border)',
                                borderRadius: 'var(--radius-m)', padding: '12px 14px', marginBottom: 12
                            }}>
                                <div style={{ fontSize: 13, color: 'var(--text-2)', marginBottom: 10 }}>
                                    💡 Would you like to initialize <strong>{repo.name}</strong> now?
                                </div>
                                <button
                                    className="btn btn-primary btn-sm"
                                    disabled={initializing}
                                    onClick={async () => {
                                        setInitializing(true);
                                        try {
                                            await InitRepository(repo);
                                            addToast({ type: 'success', title: '✅ Repository initialized!', message: 'You can now start the backup.' });
                                            reset();
                                        } catch (e: unknown) {
                                            addToast({ type: 'error', title: 'Initialization failed', message: String(e) });
                                        } finally { setInitializing(false); }
                                    }}
                                >
                                    {initializing
                                        ? <><span className="spinner" /> Initializing...</>
                                        : '🆕 Initialize repository now'}
                                </button>
                            </div>
                        ) : null;
                    })()}

                    <button className="btn btn-secondary" onClick={reset}>↩ Back</button>
                </div>
            )}
        </div>
    );
}
