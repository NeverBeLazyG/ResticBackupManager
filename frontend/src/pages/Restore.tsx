import React, { useState, useEffect } from 'react';
import { useToast } from '../ToastContext';
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime';
import {
    GetRepositories, GetSnapshots, StartRestore, CancelRestore, SelectRestoreFolder
} from '../../wailsjs/go/main/App';

interface Repo { id: string; name: string; }
interface Snapshot { id: string; short_id: string; time: string; hostname: string; paths: string[]; }
interface Progress {
    message_type: string; percent_done: number;
    total_files: number; files_restored: number;
    total_bytes: number; bytes_restored: number;
    seconds_elapsed: number;
}

function fmt(b: number): string {
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
}
function fmtDate(iso: string) {
    try { return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return iso; }
}

export default function Restore({ initRepoId = '', initSnapshotId = '' }: { initRepoId?: string; initSnapshotId?: string }) {
    const { addToast } = useToast();
    const [repos, setRepos] = useState<Repo[]>([]);
    const [selectedRepo, setSelectedRepo] = useState(initRepoId);
    const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
    const [selectedSnap, setSelectedSnap] = useState(initSnapshotId);
    const [targetPath, setTargetPath] = useState('');
    const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
    const [progress, setProgress] = useState<Progress | null>(null);
    const [errMsg, setErrMsg] = useState('');
    const [loadingSnaps, setLoadingSnaps] = useState(false);

    useEffect(() => {
        GetRepositories().then((r: Repo[]) => {
            setRepos(r || []);
            if (!initRepoId && r?.length > 0) setSelectedRepo(r[0].id);
        });
    }, []);

    useEffect(() => {
        if (selectedRepo) {
            setLoadingSnaps(true);
            GetSnapshots(selectedRepo).then((s: Snapshot[]) => {
                setSnapshots(s || []);
                if (!initSnapshotId && s?.length > 0) setSelectedSnap(s[s.length - 1].id);
            }).finally(() => setLoadingSnaps(false));
        }
    }, [selectedRepo]);

    useEffect(() => {
        EventsOn('restore:progress', (p: Progress) => setProgress(p));
        EventsOn('restore:complete', () => setStatus('done'));
        EventsOn('restore:error', (msg: string) => { setStatus('error'); setErrMsg(msg); });
        return () => { EventsOff('restore:progress'); EventsOff('restore:complete'); EventsOff('restore:error'); };
    }, []);

    const pickFolder = async () => {
        const dir = await SelectRestoreFolder();
        if (dir) setTargetPath(dir);
    };

    const start = async () => {
        if (!selectedRepo) { addToast({ type: 'warning', title: 'Please select a repository' }); return; }
        if (!selectedSnap) { addToast({ type: 'warning', title: 'Please select a snapshot' }); return; }
        if (!targetPath) { addToast({ type: 'warning', title: 'Please select a target folder' }); return; }
        setStatus('running'); setProgress(null); setErrMsg('');
        try { await StartRestore(selectedRepo, selectedSnap, targetPath); }
        catch (e: unknown) { setStatus('error'); setErrMsg(String(e)); }
    };

    const cancel = async () => {
        await CancelRestore();
        setStatus('idle');
        addToast({ type: 'info', title: 'Restore cancelled' });
    };

    const pct = progress ? Math.round(progress.percent_done * 100) : 0;
    const snap = snapshots.find(s => s.id === selectedSnap);

    return (
        <div>
            <div className="row" style={{ marginBottom: 20 }}>
                <div className="grow">
                    <h2 style={{ fontSize: 20, fontWeight: 700 }}>Full Restore</h2>
                    <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>Restore an entire snapshot to a target folder</p>
                </div>
            </div>

            <div className="card section">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label>Repository</label>
                        <select value={selectedRepo} onChange={e => setSelectedRepo(e.target.value)} disabled={status === 'running'}>
                            {repos.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                        </select>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label>Snapshot {loadingSnaps && '(loading...)'}</label>
                        <select value={selectedSnap} onChange={e => setSelectedSnap(e.target.value)}
                            disabled={status === 'running' || loadingSnaps}>
                            {snapshots.map(s => (
                                <option key={s.id} value={s.id}>
                                    {s.short_id} – {fmtDate(s.time)} – {s.hostname}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
                {snap && (
                    <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-3)' }}>
                        Backed-up paths: {snap.paths.join(', ')}
                    </div>
                )}
            </div>

            <div className="card section">
                <div className="card-header"><div className="card-title">📂 Target Folder</div></div>
                <div className="input-row">
                    <input readOnly placeholder="Select target folder..." value={targetPath} style={{ cursor: 'pointer' }}
                        onClick={pickFolder} />
                    <button className="btn btn-secondary" onClick={pickFolder} disabled={status === 'running'}>Browse</button>
                </div>
            </div>

            {status === 'idle' && (
                <button className="btn btn-primary btn-lg" onClick={start}
                    disabled={!selectedRepo || !selectedSnap || !targetPath}>
                    ⬇ Start Restore
                </button>
            )}

            {status === 'running' && (
                <div className="status-card">
                    <div className="row" style={{ marginBottom: 12 }}>
                        <div className="grow" style={{ fontWeight: 600 }}>⏳ Restore running... {pct}%</div>
                        <button className="btn btn-danger btn-sm" onClick={cancel}>⏹ Cancel</button>
                    </div>
                    <div className="progress-bar-wrap">
                        <div className="progress-bar-fill" style={{ width: `${pct}%` }} />
                    </div>
                    {progress && (
                        <div className="progress-stats">
                            <div className="stat-item">
                                <div className="stat-val">{progress.files_restored}</div>
                                <div className="stat-label">Files /{progress.total_files}</div>
                            </div>
                            <div className="stat-item">
                                <div className="stat-val">{fmt(progress.bytes_restored)}</div>
                                <div className="stat-label">of {fmt(progress.total_bytes)}</div>
                            </div>
                            <div className="stat-item">
                                <div className="stat-val">{pct}%</div>
                                <div className="stat-label">Progress</div>
                            </div>
                            <div className="stat-item">
                                <div className="stat-val">{Math.floor(progress.seconds_elapsed)}s</div>
                                <div className="stat-label">Elapsed</div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {status === 'done' && (
                <div className="status-card" style={{ borderColor: 'var(--success)' }}>
                    <div style={{ color: 'var(--success)', fontWeight: 700, fontSize: 16, marginBottom: 8 }}>
                        ✅ Restore complete!
                    </div>
                    <p style={{ fontSize: 13, color: 'var(--text-2)' }}>Files restored to <code>{targetPath}</code>.</p>
                    <div style={{ marginTop: 16 }}>
                        <button className="btn btn-secondary" onClick={() => { setStatus('idle'); setTargetPath(''); }}>
                            ↩ New Restore
                        </button>
                    </div>
                </div>
            )}

            {status === 'error' && (
                <div className="status-card" style={{ borderColor: 'var(--danger)' }}>
                    <div style={{ color: 'var(--danger)', fontWeight: 700, marginBottom: 8 }}>❌ Restore failed</div>
                    <p style={{ fontSize: 13, color: 'var(--text-2)' }}>{errMsg}</p>
                    <div style={{ marginTop: 16 }}>
                        <button className="btn btn-secondary" onClick={() => setStatus('idle')}>↩ Back</button>
                    </div>
                </div>
            )}
        </div>
    );
}
