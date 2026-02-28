import React, { useState, useEffect } from 'react';
import { useToast } from '../ToastContext';
import {
    GetRepositories, AddRepository, UpdateRepository,
    DeleteRepository, TestRepository, InitRepository
} from '../../wailsjs/go/main/App';

interface Repo { id: string; name: string; uri: string; password: string; sourceFolders: string[]; excludes: string[]; }
const empty = (): Repo => ({ id: '', name: '', uri: '', password: '', sourceFolders: [], excludes: [] });

export default function Repositories() {
    const { addToast } = useToast();
    const [repos, setRepos] = useState<Repo[]>([]);
    const [loading, setLoading] = useState(true);
    const [modal, setModal] = useState(false);
    const [editRepo, setEditRepo] = useState<Repo>(empty());
    const [isEdit, setIsEdit] = useState(false);
    const [testing, setTesting] = useState(false);
    const [saving, setSaving] = useState(false);
    const [showPass, setShowPass] = useState(false);

    const load = () => {
        setLoading(true);
        GetRepositories().then((r: Repo[]) => { setRepos(r || []); setLoading(false); }).catch(() => setLoading(false));
    };
    useEffect(load, []);

    const openAdd = () => { setEditRepo(empty()); setIsEdit(false); setShowPass(false); setModal(true); };
    const openEdit = (r: Repo) => { setEditRepo({ ...r }); setIsEdit(true); setShowPass(false); setModal(true); };

    const save = async () => {
        if (!editRepo.name || !editRepo.uri || !editRepo.password) {
            addToast({ type: 'warning', title: 'Please fill in all fields.' }); return;
        }
        setSaving(true);
        try {
            if (isEdit) await UpdateRepository(editRepo);
            else await AddRepository(editRepo);
            addToast({ type: 'success', title: isEdit ? 'Repository updated' : 'Repository added' });
            setModal(false); load();
        } catch (e: unknown) {
            addToast({ type: 'error', title: 'Error', message: String(e) });
        } finally { setSaving(false); }
    };

    const del = async (id: string, name: string) => {
        if (!confirm(`Delete repository "${name}"?`)) return;
        try {
            await DeleteRepository(id);
            addToast({ type: 'success', title: 'Repository deleted' });
            load();
        } catch (e: unknown) { addToast({ type: 'error', title: 'Error', message: String(e) }); }
    };

    const test = async () => {
        if (!editRepo.name || !editRepo.uri || !editRepo.password) {
            addToast({ type: 'warning', title: 'Please fill in all fields.' }); return;
        }
        setTesting(true);
        try {
            if (isEdit) {
                const msg = await TestRepository(editRepo.id);
                addToast({ type: 'success', title: msg });
            } else {
                addToast({ type: 'info', title: 'Tip', message: 'Save the repository first to test the connection.' });
            }
        } catch (e: unknown) { addToast({ type: 'error', title: 'Connection failed', message: String(e) }); }
        finally { setTesting(false); }
    };

    const initRepo = async () => {
        if (!editRepo.name || !editRepo.uri || !editRepo.password) {
            addToast({ type: 'warning', title: 'Please fill in all fields.' }); return;
        }
        setSaving(true);
        try {
            await InitRepository(editRepo);
            addToast({ type: 'success', title: 'Repository initialized!', message: editRepo.uri });
        } catch (e: unknown) { addToast({ type: 'error', title: 'Initialization failed', message: String(e) }); }
        finally { setSaving(false); }
    };

    return (
        <div>
            <div className="row" style={{ marginBottom: 20 }}>
                <div className="grow">
                    <h2 style={{ fontSize: 20, fontWeight: 700 }}>Repositories</h2>
                    <p style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>Manage your Restic repositories</p>
                </div>
                <button className="btn btn-primary" onClick={openAdd}>+ New</button>
            </div>

            {loading ? (
                <div className="repo-grid">
                    {[1, 2, 3].map(i => <div key={i} className="skeleton" style={{ height: 110, borderRadius: 14 }} />)}
                </div>
            ) : (
                <div className="repo-grid">
                    {repos.map(r => (
                        <div key={r.id} className="repo-card" onClick={() => openEdit(r)}>
                            <div className="row" style={{ marginBottom: 8 }}>
                                <span style={{ fontSize: 20 }}>🗄️</span>
                                <div className="grow">
                                    <div className="repo-name">{r.name}</div>
                                </div>
                            </div>
                            <div className="repo-uri">{r.uri}</div>
                            <div className="repo-actions" onClick={e => e.stopPropagation()}>
                                <button className="btn btn-ghost btn-sm" onClick={() => openEdit(r)}>✏️ Edit</button>
                                <button className="btn btn-danger btn-sm" onClick={() => del(r.id, r.name)}>🗑️</button>
                            </div>
                        </div>
                    ))}
                    <div className="repo-card repo-card-add" onClick={openAdd}>
                        <span className="add-icon">＋</span>
                        <span>Add repository</span>
                    </div>
                </div>
            )}

            {repos.length === 0 && !loading && (
                <div className="empty-state">
                    <div className="empty-icon">🗄️</div>
                    <div className="empty-title">No repositories yet</div>
                    <div className="empty-subtitle">Add your first Restic repository to get started</div>
                    <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={openAdd}>+ Add Repository</button>
                </div>
            )}

            {modal && (
                <div className="modal-overlay" onClick={() => setModal(false)}>
                    <div className="modal" onClick={e => e.stopPropagation()}>
                        <div className="modal-header">
                            <div className="modal-title">{isEdit ? 'Edit Repository' : 'New Repository'}</div>
                            <span className="modal-close" onClick={() => setModal(false)}>✕</span>
                        </div>

                        <div className="form-group">
                            <label>Name</label>
                            <input placeholder="e.g. Proxmox Backup" value={editRepo.name}
                                onChange={e => setEditRepo(p => ({ ...p, name: e.target.value }))} />
                        </div>
                        <div className="form-group">
                            <label>Repository URI</label>
                            <input placeholder="sftp:root@192.168.178.96:/backup" value={editRepo.uri}
                                onChange={e => setEditRepo(p => ({ ...p, uri: e.target.value }))} />
                        </div>
                        <div className="form-group">
                            <label>Password</label>
                            <div className="input-row">
                                <input type={showPass ? 'text' : 'password'} placeholder="Repository password"
                                    value={editRepo.password}
                                    onChange={e => setEditRepo(p => ({ ...p, password: e.target.value }))} />
                                <button className="btn btn-secondary btn-sm" style={{ whiteSpace: 'nowrap' }}
                                    onClick={() => setShowPass(p => !p)}>
                                    {showPass ? '🙈' : '👁️'}
                                </button>
                            </div>
                        </div>

                        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                            <button className="btn btn-ghost btn-sm" onClick={test} disabled={testing}>
                                {testing ? <><span className="spinner" />Testing...</> : '🔌 Test connection'}
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={initRepo} disabled={saving}>
                                🆕 Initialize repository
                            </button>
                        </div>

                        <div className="modal-footer">
                            <button className="btn btn-secondary" onClick={() => setModal(false)}>Cancel</button>
                            <button className="btn btn-primary" onClick={save} disabled={saving}>
                                {saving ? <><span className="spinner" />Saving...</> : '💾 Save'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
