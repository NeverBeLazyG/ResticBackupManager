import React, { useState, useEffect } from 'react';
import './style.css';
import { ToastProvider } from './ToastContext';
import Repositories from './pages/Repositories';
import Backup from './pages/Backup';
import Snapshots from './pages/Snapshots';
import Restore from './pages/Restore';
import SelectiveRestore from './pages/SelectiveRestore';
import { GetResticVersion, GetResticStatus } from '../wailsjs/go/main/App';

type Page = 'repos' | 'backup' | 'snapshots' | 'restore' | 'selective';

const navItems: { id: Page; icon: string; label: string }[] = [
    { id: 'repos', icon: '🗄️', label: 'Repositories' },
    { id: 'backup', icon: '⬆️', label: 'Backup' },
    { id: 'snapshots', icon: '📋', label: 'Snapshots' },
    { id: 'restore', icon: '⬇️', label: 'Full Restore' },
    { id: 'selective', icon: '🎯', label: 'Selective Restore' },
];

const pageTitles: Record<Page, string> = {
    repos: 'Repository Management',
    backup: 'Create Backup',
    snapshots: 'Snapshot Overview',
    restore: 'Full Restore',
    selective: 'Selective Restore',
};

export default function App() {
    const [page, setPage] = useState<Page>('repos');
    const [restoreParams, setRestoreParams] = useState<{ repoId: string; snapshotId: string } | null>(null);
    const [resticVersion, setResticVersion] = useState('');
    const [resticMissing, setResticMissing] = useState(false);
    const [resticMsg, setResticMsg] = useState('');

    useEffect(() => {
        GetResticVersion().then((v: string) => setResticVersion(v.trim())).catch(() => { });
        GetResticStatus().then((s: Record<string, string>) => {
            if (s.found === 'false') {
                setResticMissing(true);
                setResticMsg(s.message || '');
            } else {
                setResticVersion(s.path || '');
            }
        }).catch(() => { });
    }, []);

    const goToRestore = (repoId: string, snapshotId: string) => {
        setRestoreParams({ repoId, snapshotId });
        setPage('selective');
    };

    return (
        <ToastProvider>
            <div className="app">
                {/* ── Sidebar ── */}
                <aside className="sidebar">
                    <div className="sidebar-logo">
                        <img src="/assets/icon.png" alt="Logo"
                            style={{ width: 38, height: 38, borderRadius: 8, flexShrink: 0 }} />
                        <div>
                            <span>Restic GUI</span>
                            <small>Backup Manager</small>
                        </div>
                    </div>

                    <nav className="sidebar-nav">
                        {navItems.map(item => (
                            <div key={item.id}
                                className={`nav-item ${page === item.id ? 'active' : ''}`}
                                onClick={() => { setPage(item.id); if (item.id !== 'restore' && item.id !== 'selective') setRestoreParams(null); }}>
                                <span className="nav-icon">{item.icon}</span>
                                {item.label}
                            </div>
                        ))}
                    </nav>

                    <div className="sidebar-footer">
                        <div style={{ fontWeight: 600, color: resticMissing ? 'var(--danger)' : 'var(--text-1)', marginBottom: 4, fontSize: 12 }}>
                            Restic Backup Manager v0.9.1
                        </div>
                        <div style={{ fontSize: 11, opacity: 0.6 }}>
                            {resticMissing ? '⚠ restic not found' : (resticVersion ? resticVersion.split('\n')[0] : '...')}
                        </div>
                    </div>
                </aside>

                {/* ── Main ── */}
                <div className="main">
                    <div className="topbar">
                        <div className="topbar-title">{pageTitles[page]}</div>
                    </div>

                    <div className="content">
                        {resticMissing ? (
                            <div style={{ maxWidth: 560, margin: '40px auto' }}>
                                <div className="status-card" style={{ borderColor: 'var(--danger)' }}>
                                    <div style={{ fontSize: 48, textAlign: 'center', marginBottom: 16 }}>⚠️</div>
                                    <div style={{ color: 'var(--danger)', fontWeight: 700, fontSize: 18, marginBottom: 12, textAlign: 'center' }}>
                                        restic not found
                                    </div>
                                    <p style={{ color: 'var(--text-2)', fontSize: 13, marginBottom: 20, textAlign: 'center' }}>
                                        Restic Backup Manager requires <strong>restic.exe</strong> to work.
                                    </p>
                                    <div style={{ background: 'var(--bg-0)', borderRadius: 'var(--radius-m)', border: '1px solid var(--border)', padding: '14px 18px', fontSize: 13, marginBottom: 20 }}>
                                        <div style={{ fontWeight: 600, marginBottom: 10, color: 'var(--text-1)' }}>Choose one of these options:</div>
                                        <div style={{ marginBottom: 8 }}>
                                            📁 <strong>Option A</strong> — Place <code style={{ background: 'var(--bg-2)', padding: '1px 5px', borderRadius: 4 }}>restic.exe</code> in the same folder as <code style={{ background: 'var(--bg-2)', padding: '1px 5px', borderRadius: 4 }}>ResticBackupManager.exe</code>
                                        </div>
                                        <div>
                                            🖥️ <strong>Option B</strong> — Install via <code style={{ background: 'var(--bg-2)', padding: '1px 5px', borderRadius: 4 }}>winget install restic</code> (adds to PATH automatically)
                                        </div>
                                    </div>
                                    <div style={{ textAlign: 'center', marginBottom: 12 }}>
                                        <a href="https://restic.net" target="_blank" rel="noreferrer"
                                            style={{ display: 'inline-block', padding: '10px 24px', background: 'var(--accent)', color: '#fff', borderRadius: 'var(--radius-m)', fontWeight: 600, textDecoration: 'none', fontSize: 14 }}>
                                            🔗 Download restic at restic.net
                                        </a>
                                    </div>
                                    <p style={{ fontSize: 11, color: 'var(--text-3)', textAlign: 'center', margin: 0 }}>
                                        After installing restic, please restart this application.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <>
                                {page === 'repos' && <Repositories />}
                                {page === 'backup' && <Backup />}
                                {page === 'snapshots' && <Snapshots onRestore={goToRestore} />}
                                {page === 'restore' && (
                                    <Restore
                                        initRepoId={restoreParams?.repoId}
                                        initSnapshotId={restoreParams?.snapshotId}
                                    />
                                )}
                                {page === 'selective' && (
                                    <SelectiveRestore
                                        initRepoId={restoreParams?.repoId}
                                        initSnapshotId={restoreParams?.snapshotId}
                                    />
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </ToastProvider>
    );
}
