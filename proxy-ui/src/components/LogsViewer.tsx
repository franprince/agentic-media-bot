import { useRef, useEffect, useState } from 'react';
import { Terminal, Maximize2, Minimize2 } from 'lucide-react';

export function LogsViewer({ logs }: { logs: string[] }) {
    const [isExpanded, setIsExpanded] = useState(false);
    const endRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, [logs]);

    return (
        <div className="glass-panel logs-container">
            <div className="logs-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <Terminal size={20} color="var(--text-secondary)" />
                    <h3 style={{ margin: 0 }}>System Logs</h3>
                </div>
                <button
                    className="icon-button"
                    onClick={() => setIsExpanded(!isExpanded)}
                    title={isExpanded ? "Collapse" : "Expand"}
                >
                    {isExpanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
            </div>
            <div className={`logs-content ${isExpanded ? 'expanded' : ''}`}>
                {logs.length === 0 ? (
                    <div style={{ textAlign: 'center', fontStyle: 'italic', opacity: 0.5, marginTop: '2.5rem' }}>No logs available</div>
                ) : (
                    logs.map((log, index) => {
                        let colorClass = "";
                        if (log.includes("ERROR") || log.includes("Error:") || log.includes("❌")) colorClass = "log-error";
                        else if (log.includes("WARN") || log.includes("⚠️")) colorClass = "log-warn";
                        else if (log.includes("INFO") || log.includes("✅")) colorClass = "log-info";

                        return (
                            <div key={index} className={`log-line ${colorClass}`}>
                                {log}
                            </div>
                        );
                    })
                )}
                <div ref={endRef} />
            </div>
        </div>
    );
}
