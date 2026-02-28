import React, { useState, useEffect, useMemo } from 'react';
import { useToast } from '../ToastContext';
import { EventsOn, EventsOff } from '../../wailsjs/runtime/runtime';
import {
    GetRepositories, GetSnapshots,
    ListSnapshotContents, RestoreSelected, SelectRestoreFolder
} from '../../wailsjs/go/main/App';

interface Repo { id: string; name: string; }
interface Snapshot { id: string; short_id: string; time: string; hostname: string; paths: string[]; }
interface FileNode { name: string; type: string; path: string; size: number; mtime: string; }
interface RestoreProgress {
    percent_done: number; total_files: number; files_restored: number;
    total_bytes: number; bytes_restored: number; seconds_elapsed: number;
}

function norm(p: string): string {
    let s = p.replace(/\\/g, '/');
    if (!s.startsWith('/')) s = '/' + s;
    return s;
}
function parentOf(p: string): string {
    const n = norm(p);
    const idx = n.lastIndexOf('/');
    return idx <= 0 ? '' : n.substring(0, idx);
}
function depthOf(p: string): number {
    return norm(p).split('/').filter(Boolean).length;
}
function isVisible(nodePath: string, expanded: Set<string>): boolean {
    if (depthOf(nodePath) === 1) return true;
    let p = parentOf(norm(nodePath));
    while (p) {
        if (!expanded.has(p)) return false;
        p = parentOf(p);
    }
    return true;
}
function fmt(b: number): string {
    if (!b) return '';
    if (b < 1024) return b + ' B';
    if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
    if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
    return (b / 1073741824).toFixed(2) + ' GB';
}
function fmtDate(iso: string) {
    try { return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return iso; }
}

const MAX_VISIBLE = 1000;

export default function SelectiveRestore({
    initRepoId = '', initSnapshotId = ''
}: { initRepoId?: string; initSnapshotId?: string }) {
    const { addToast } = useToast();

    const [repos, setRepos] = useState<Repo[]>([]);
    const [selectedRepo, setSelectedRepo] = useState(initRepoId);
    const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
    const [selectedSnap, setSelectedSnap] = useState(initSnapshotId);
    const [nodes, setNodes] = useState<FileNode[]>([]);
    const [loadingNodes, setLoadingNodes] = useState(false);
    const [loadingSnaps, setLoadingSnaps] = useState(false);
    const [expanded, setExpanded] = useState<Set<string>>(new Set());
    const [checked, setChecked] = useState<Set<string>>(new Set());
    const [targetPath, setTargetPath] = useState('');
    const [restoreMode, setRestoreMode] = useState<'original' | 'custom'>('original');
    const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
    const [progress, setProgress] = useState<RestoreProgress | null>(null);
    const [errMsg, setErrMsg] = useState('');

    useEffect(() => {
        GetRepositories().then((r: Repo[]) => {
            setRepos(r || []);
            if (!initRepoId && r?.length > 0) setSelectedRepo(r[0].id);
        });
    }, []);

    useEffect(() => {
        if (!selectedRepo) return;
        setLoadingSnaps(true);
        setSnapshots([]); setNodes([]); setChecked(new Set()); setExpanded(new Set());
        GetSnapshots(selectedRepo).then((s: Snapshot[]) => {
            setSnapshots(s || []);
            const target = initSnapshotId
                ? s?.find((x: Snapshot) => x.id === initSnapshotId)
                : s?.[s.length - 1];
            if (target) setSelectedSnap(target.id);
        }).finally(() => setLoadingSnaps(false));
    }, [selectedRepo]);

    useEffect(() => {
        if (!selectedRepo || !selectedSnap) return;
        setLoadingNodes(true);
        setNodes([]); setChecked(new Set()); setExpanded(new Set());
        ListSnapshotContents(selectedRepo, selectedSnap)
            .then((n: FileNode[]) => setNodes(n || []))
            .catch((e: unknown) => addToast({ type: 'error', title: 'Failed to load snapshot contents', message: String(e) }))
            .finally(() => setLoadingNodes(false));
    }, [selectedSnap]);

    useEffect(() => {
        EventsOn('restore:progress', (p: RestoreProgress) => setProgress(p));
        EventsOn('restore:complete', () => setStatus('done'));
        EventsOn('restore:error', (msg: string) => { setStatus('error'); setErrMsg(msg); });
        return () => { EventsOff('restore:progress'); EventsOff('restore:complete'); EventsOff('restore:error'); };
    }, []);

    const visibleNodes = useMemo(() =>
        nodes.filter(n => isVisible(n.path, expanded)).slice(0, MAX_VISIBLE),
        [nodes, expanded]
    );

    const toggleExpand = (node: FileNode) => {
        const key = norm(node.path);
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };

    const toggleCheck = (node: FileNode, e: React.MouseEvent | React.ChangeEvent) => {
        e.stopPropagation();
        setChecked(prev => {
            const next = new Set(prev);
            if (next.has(node.path)) {
                next.delete(node.path);
                if (node.type === 'dir') {
                    const prefix = norm(node.path);
                    nodes.forEach(n => { if (norm(n.path).startsWith(prefix + '/')) next.delete(n.path); });
                }
            } else {
                next.add(node.path);
                if (node.type === 'dir') {
                    const prefix = norm(node.path);
                    nodes.forEach(n => { if (norm(n.path).startsWith(prefix + '/')) next.add(n.path); });
                }
            }
            return next;
        });
    };

    const getCheckState = (node: FileNode): 'checked' | 'unchecked' | 'indeterminate' => {
        if (node.type !== 'dir') return checked.has(node.path) ? 'checked' : 'unchecked';
        const prefix = norm(node.path);
        const children = nodes.filter(n => norm(n.path).startsWith(prefix + '/'));
        if (!children.length) return checked.has(node.path) ? 'checked' : 'unchecked';
        const cnt = children.filter(c => checked.has(c.path)).length;
        if (cnt === 0 && !checked.has(node.path)) return 'unchecked';
        if (cnt === children.length) return 'checked';
        return 'indeterminate';
    };

    const selectAll = () => setChecked(new Set(nodes.map(n => n.path)));
    const selectNone = () => setChecked(new Set());

    const pickFolder = async () => {
        const dir = await SelectRestoreFolder();
        if (dir) setTargetPath(dir);
    };

    const startRestore = async () => {
        if (checked.size === 0) { addToast({ type: 'warning', title: 'No entries selected' }); return; }
        if (restoreMode === 'custom' && !targetPath) { addToast({ type: 'warning', title: 'Please select a target folder' }); return; }
        setStatus('running'); setProgress(null); setErrMsg('');
        try {
            await RestoreSelected(selectedRepo, selectedSnap, Array.from(checked), targetPath, restoreMode === 'original');
        } catch (e: unknown) { setStatus('error'); setErrMsg(String(e)); }
    };

    const pct = progress ? Math.round(progress.percent_done * 100) : 0;
    const snap = snapshots.find(s => s.id === selectedSnap);

    return (
        <div>
            <div className="row" style={{ marginBottom: 20 }}>
                <div className="grow">
                    <h2 style={{ fontSize: 20, fontWeight: 700 }}>Selective Restore</h2>
                    <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
                        Restore individual files or folders from a snapshot
                    </p>
                </div>
            </div>

            {/* Repo + Snapshot */}
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

            {/* File tree */}
            <div className="card section">
                <div className="card-header">
                    <div className="card-title">
                        📂 Snapshot Contents
                        {nodes.length > 0 && (
                            <span style={{ color: 'var(--text-3)', fontWeight: 400, marginLeft: 8, fontSize: 13 }}>
                                ({nodes.length.toLocaleString()} entries)
                            </span>
                        )}
                    </div>
                    {nodes.length > 0 && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <button className="btn btn-ghost btn-sm" onClick={selectAll}>All</button>
                            <button className="btn btn-ghost btn-sm" onClick={selectNone}>None</button>
                            <span style={{ fontSize: 12, color: 'var(--accent)', minWidth: 80, textAlign: 'right' }}>
                                {checked.size.toLocaleString()} selected
                            </span>
                        </div>
                    )}
                </div>

                {loadingNodes ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 0', color: 'var(--text-3)' }}>
                        <span className="spinner" style={{ borderTopColor: 'var(--accent)' }} />
                        Loading snapshot contents... (may take a moment for large repos)
                    </div>
                ) : nodes.length === 0 ? (
                    <div style={{ color: 'var(--text-3)', fontSize: 13, padding: '12px 0' }}>
                        {selectedSnap ? 'No files found in snapshot.' : 'Select a snapshot to load its contents.'}
                    </div>
                ) : (
                    <>
                        {visibleNodes.length >= MAX_VISIBLE && (
                            <div style={{
                                background: 'var(--warning-dim)', border: '1px solid var(--warning)',
                                borderRadius: 'var(--radius-s)', padding: '6px 12px', marginBottom: 8,
                                fontSize: 12, color: 'var(--warning)'
                            }}>
                                ⚠ Showing first {MAX_VISIBLE.toLocaleString()} visible entries. Expand folders to navigate deeper.
                            </div>
                        )}
                        <div style={{
                            maxHeight: 400, overflowY: 'auto',
                            border: '1px solid var(--border)',
                            borderRadius: 'var(--radius-m)',
                            background: 'var(--bg-0)',
                        }}>
                            {visibleNodes.map(node => {
                                const isDir = node.type === 'dir';
                                const normKey = norm(node.path);
                                const isExp = expanded.has(normKey);
                                const d = depthOf(node.path);
                                const checkState = getCheckState(node);
                                const isChecked = checkState === 'checked';
                                const isIndet = checkState === 'indeterminate';
                                const hasChildren = isDir && nodes.some(
                                    n => n.path !== node.path && norm(n.path).startsWith(normKey + '/')
                                );

                                return (
                                    <div key={node.path}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 6,
                                            padding: '5px 12px',
                                            paddingLeft: `${(d - 1) * 20 + 12}px`,
                                            borderBottom: '1px solid hsla(222,20%,20%,.5)',
                                            background: isChecked ? 'var(--accent-dim)' : 'transparent',
                                            transition: 'background 100ms',
                                            userSelect: 'none',
                                        }}
                                        onMouseEnter={e => { if (!isChecked) e.currentTarget.style.background = 'var(--bg-2)'; }}
                                        onMouseLeave={e => { e.currentTarget.style.background = isChecked ? 'var(--accent-dim)' : 'transparent'; }}
                                    >
                                        <span
                                            style={{
                                                width: 16, flexShrink: 0, textAlign: 'center',
                                                fontSize: 10, color: 'var(--text-3)',
                                                cursor: hasChildren ? 'pointer' : 'default',
                                                visibility: hasChildren ? 'visible' : 'hidden',
                                            }}
                                            onClick={() => hasChildren && toggleExpand(node)}
                                        >
                                            {isExp ? '▼' : '▶'}
                                        </span>

                                        <input
                                            type="checkbox"
                                            checked={isChecked}
                                            ref={el => { if (el) el.indeterminate = isIndet; }}
                                            onChange={e => toggleCheck(node, e)}
                                            style={{ width: 14, height: 14, cursor: 'pointer', flexShrink: 0, accentColor: 'var(--accent)' }}
                                        />

                                        <span style={{ fontSize: 14, flexShrink: 0 }}>
                                            {isDir ? (isExp ? '📂' : '📁') : '📄'}
                                        </span>

                                        <span
                                            style={{
                                                fontSize: 13, flex: 1,
                                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                color: isChecked ? 'var(--accent)' : isDir ? 'var(--text-1)' : 'var(--text-2)',
                                                cursor: isDir ? 'pointer' : 'default',
                                                fontWeight: isDir ? 500 : 400,
                                            }}
                                            title={node.path}
                                            onClick={() => isDir && hasChildren && toggleExpand(node)}
                                        >
                                            {node.name}
                                        </span>

                                        <span style={{ fontSize: 11, color: 'var(--text-3)', flexShrink: 0 }}>
                                            {!isDir && fmt(node.size)}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}
            </div>

            {/* Restore target */}
            {nodes.length > 0 && status === 'idle' && (
                <div className="card section">
                    <div className="card-title" style={{ marginBottom: 14 }}>🎯 Restore Target</div>

                    <div style={{ display: 'flex', gap: 10, marginBottom: 16 }}>
                        <button
                            className={`btn ${restoreMode === 'original' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setRestoreMode('original')}
                        >
                            🏠 Restore to original path
                        </button>
                        <button
                            className={`btn ${restoreMode === 'custom' ? 'btn-primary' : 'btn-secondary'}`}
                            onClick={() => setRestoreMode('custom')}
                        >
                            📂 Copy to folder
                        </button>
                    </div>

                    {restoreMode === 'original' ? (
                        <div style={{
                            background: 'var(--warning-dim)', border: '1px solid var(--warning)',
                            borderRadius: 'var(--radius-m)', padding: '10px 14px', fontSize: 13
                        }}>
                            <div style={{ fontWeight: 600, color: 'var(--warning)', marginBottom: 4 }}>
                                ⚠ Files will be overwritten
                            </div>
                            <div style={{ color: 'var(--text-2)' }}>
                                Selected files will be written back to their <strong>original location</strong>, potentially overwriting existing files.
                            </div>
                        </div>
                    ) : (
                        <div className="input-row">
                            <input readOnly placeholder="Select target folder..." value={targetPath}
                                style={{ cursor: 'pointer' }} onClick={pickFolder} />
                            <button className="btn btn-secondary" onClick={pickFolder}>Browse</button>
                        </div>
                    )}

                    <div style={{ marginTop: 16 }}>
                        <button
                            className="btn btn-primary btn-lg"
                            onClick={startRestore}
                            disabled={checked.size === 0 || (restoreMode === 'custom' && !targetPath)}
                        >
                            ⬇ Restore {checked.size.toLocaleString()} entr{checked.size === 1 ? 'y' : 'ies'}
                        </button>
                    </div>
                </div>
            )}

            {status === 'running' && (
                <div className="status-card">
                    <div style={{ fontWeight: 600, marginBottom: 12 }}>⏳ Restore running... {pct}%</div>
                    <div className="progress-bar-wrap">
                        <div className="progress-bar-fill" style={{ width: `${Math.max(pct, 3)}%` }} />
                    </div>
                    {progress && (
                        <div className="progress-stats">
                            <div className="stat-item">
                                <div className="stat-val">{progress.files_restored.toLocaleString()}</div>
                                <div className="stat-label">Files /{progress.total_files.toLocaleString()}</div>
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
                    <p style={{ fontSize: 13, color: 'var(--text-2)' }}>
                        {restoreMode === 'original'
                            ? 'Files have been restored to their original location.'
                            : `Files have been copied to "${targetPath}".`}
                    </p>
                    <button className="btn btn-secondary" style={{ marginTop: 16 }}
                        onClick={() => { setStatus('idle'); setChecked(new Set()); }}>
                        ↩ New selection
                    </button>
                </div>
            )}

            {status === 'error' && (
                <div className="status-card" style={{ borderColor: 'var(--danger)' }}>
                    <div style={{ color: 'var(--danger)', fontWeight: 700, marginBottom: 8 }}>❌ Restore failed</div>
                    <p style={{ fontSize: 13, color: 'var(--text-2)' }}>{errMsg}</p>
                    <button className="btn btn-secondary" style={{ marginTop: 16 }}
                        onClick={() => setStatus('idle')}>↩ Back</button>
                </div>
            )}
        </div>
    );
}
