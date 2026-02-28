import React, { useState, useEffect } from 'react';
import { useToast } from '../ToastContext';
import { GetRepositories, GetSnapshots, DeleteSnapshot } from '../../wailsjs/go/main/App';

interface Repo { id: string; name: string; uri: string; }
interface Snapshot {
    id: string; short_id: string; time: string;
    hostname: string; username: string;
    paths: string[]; tags: string[];
}

function fmtDate(iso: string) {
    try { return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }); }
    catch { return iso; }
}

export default function Snapshots({ onRestore }: { onRestore: (repoId: string, snapshotId: string) => void }) {
    const { addToast } = useToast();
    const [repos, setRepos] = useState<Repo[]>([]);
    const [selectedRepo, setSelectedRepo] = useState('');
    const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
    const [loading, setLoading] = useState(false);
    const [deleting, setDeleting] = useState<string | null>(null);

    useEffect(() => {
        GetRepositories().then((r: Repo[]) => {
            setRepos(r || []);
            if (r?.length > 0) setSelectedRepo(r[0].id);
        });
    }, []);

    useEffect(() => {
        if (selectedRepo) load();
    }, [selectedRepo]);

    const load = () => {
        setLoading(true);
        setSnapshots([]);
        GetSnapshots(selectedRepo)
            .then((s: Snapshot[]) => setSnapshots(s || []))
            .catch((e: unknown) => addToast({ type: 'error', title: 'Error', message: String(e) }))
            .finally(() => setLoading(false));
    };

    const del = async (snap: Snapshot) => {
        if (!confirm(`Delete snapshot ${snap.short_id}?\nThis cannot be undone.`)) return;
        setDeleting(snap.id);
        try {
            await DeleteSnapshot(selectedRepo, snap.id);
            addToast({ type: 'success', title: `Snapshot ${snap.short_id} deleted` });
            load();
        } catch (e: unknown) { addToast({ type: 'error', title: 'Error', message: String(e) }); }
        finally { setDeleting(null); }
    };

    return (
        <div>
            <div className="row" style={{ marginBottom: 20 }}>
                <div className="grow">
                    <h2 style={{ fontSize: 20, fontWeight: 700 }}>Snapshots</h2>
                    <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>All backups at a glance</p>
                </div>
                <button className="btn btn-secondary" onClick={load} disabled={loading || !selectedRepo}>
                    {loading ? <><span className="spinner" /> Loading...</> : '↻ Refresh'}
                </button>
            </div>

            <div className="card" style={{ marginBottom: 16 }}>
                <div className="repo-select-wrap">
                    <label>Repository:</label>
                    <select value={selectedRepo} onChange={e => setSelectedRepo(e.target.value)} disabled={loading}>
                        {repos.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                </div>
            </div>

            {loading ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {[1, 2, 3, 4, 5].map(i => <div key={i} className="skeleton" style={{ height: 52, borderRadius: 8 }} />)}
                </div>
            ) : snapshots.length === 0 ? (
                <div className="empty-state">
                    <div className="empty-icon">📋</div>
                    <div className="empty-title">No snapshots</div>
                    <div className="empty-subtitle">No backups created yet or repository is empty.</div>
                </div>
            ) : (
                <div className="card" style={{ padding: 0 }}>
                    <div className="table-wrap">
                        <table>
                            <thead>
                                <tr>
                                    <th>ID</th>
                                    <th>Date &amp; Time</th>
                                    <th>Host</th>
                                    <th>Paths</th>
                                    <th>Tags</th>
                                    <th style={{ textAlign: 'right' }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {snapshots.map(s => (
                                    <tr key={s.id}>
                                        <td>{s.short_id}</td>
                                        <td>{fmtDate(s.time)}</td>
                                        <td style={{ color: 'var(--text-2)' }}>{s.hostname}</td>
                                        <td>
                                            {(s.paths || []).map(p => (
                                                <span key={p} className="path-pill" title={p}>
                                                    {p.split(/[/\\]/).pop() || p}
                                                </span>
                                            ))}
                                        </td>
                                        <td>
                                            {(s.tags || []).map(t => (
                                                <span key={t} className="badge badge-info" style={{ marginRight: 4 }}>{t}</span>
                                            ))}
                                        </td>
                                        <td>
                                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                                                <button className="btn btn-secondary btn-sm"
                                                    onClick={() => onRestore(selectedRepo, s.id)}>
                                                    ⬇ Restore
                                                </button>
                                                <button className="btn btn-danger btn-sm"
                                                    disabled={deleting === s.id}
                                                    onClick={() => del(s)}>
                                                    {deleting === s.id ? <span className="spinner" /> : '🗑️'}
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </div>
    );
}
