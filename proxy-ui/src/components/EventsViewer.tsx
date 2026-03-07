import { useState } from 'react';
import { motion } from 'framer-motion';
import { Film, Tv, PlaySquare, Clock, Maximize2, Minimize2 } from 'lucide-react';
import type { MediaEvent } from '../hooks/useDashboard';

export function EventsViewer({ events }: { events: MediaEvent[] }) {
    const [isExpanded, setIsExpanded] = useState(false);
    const getIcon = (service: string) => {
        switch (service.toLowerCase()) {
            case 'radarr': return <Film size={20} />;
            case 'sonarr': return <Tv size={20} />;
            case 'plex': return <PlaySquare size={20} />;
            default: return <Clock size={20} />;
        }
    };

    const formatTime = (isoString: string) => {
        const date = new Date(isoString);
        return date.toLocaleString(undefined, {
            month: 'short', day: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });
    };

    return (
        <div className="glass-panel">
            <div className="section-header" style={{ padding: '1rem', borderBottom: '1px solid var(--panel-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h2 style={{ margin: 0 }}>Latest Events</h2>
                <button
                    className="icon-button"
                    onClick={() => setIsExpanded(!isExpanded)}
                    title={isExpanded ? "Collapse" : "Expand"}
                >
                    {isExpanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                </button>
            </div>
            <div className={`events-list ${isExpanded ? 'expanded' : ''}`}>
                {events.length === 0 ? (
                    <div style={{ textAlign: 'center', opacity: 0.5, padding: '2rem' }}>No recent events found.</div>
                ) : (
                    events.map((event, index) => (
                        <motion.div
                            key={event.id || index}
                            initial={{ opacity: 0, x: -10 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: index * 0.05 }}
                            className="event-card"
                        >
                            <div className={`event-icon ${event.service.toLowerCase()}`}>
                                {getIcon(event.service)}
                            </div>
                            <div className="event-content">
                                <div className="event-header">
                                    <span className="event-title">{event.title}</span>
                                    <span className="event-time">{formatTime(event.timestamp)}</span>
                                </div>
                                <div className="event-message">{event.message}</div>
                            </div>
                        </motion.div>
                    ))
                )}
            </div>
        </div>
    );
}
