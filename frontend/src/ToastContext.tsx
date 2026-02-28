import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export interface Toast {
    id: number;
    type: 'success' | 'error' | 'info' | 'warning';
    title: string;
    message?: string;
}

interface ToastCtx {
    toasts: Toast[];
    addToast: (t: Omit<Toast, 'id'>) => void;
    removeToast: (id: number) => void;
}

const ToastContext = createContext<ToastCtx>({ toasts: [], addToast: () => { }, removeToast: () => { } });

let _id = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const addToast = useCallback((t: Omit<Toast, 'id'>) => {
        const id = ++_id;
        setToasts(p => [...p, { ...t, id }]);
        setTimeout(() => setToasts(p => p.filter(x => x.id !== id)), 5000);
    }, []);

    const removeToast = useCallback((id: number) => {
        setToasts(p => p.filter(x => x.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={{ toasts, addToast, removeToast }}>
            {children}
            <ToastContainer toasts={toasts} removeToast={removeToast} />
        </ToastContext.Provider>
    );
}

export function useToast() { return useContext(ToastContext); }

const icons: Record<string, string> = { success: '✓', error: '✕', info: 'ℹ', warning: '⚠' };

function ToastContainer({ toasts, removeToast }: { toasts: Toast[]; removeToast: (id: number) => void }) {
    return (
        <div className="toast-container">
            {toasts.map(t => (
                <div key={t.id} className={`toast toast-${t.type}`}>
                    <span style={{ fontSize: 16, flexShrink: 0 }}>{icons[t.type]}</span>
                    <div className="toast-body">
                        <div className="toast-title">{t.title}</div>
                        {t.message && <div style={{ fontSize: 12, opacity: .85 }}>{t.message}</div>}
                    </div>
                    <button className="btn btn-ghost btn-sm" style={{ padding: '2px 6px' }} onClick={() => removeToast(t.id)}>✕</button>
                </div>
            ))}
        </div>
    );
}
