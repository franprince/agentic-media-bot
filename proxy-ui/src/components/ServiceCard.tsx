import { motion } from 'framer-motion';
import { Activity } from 'lucide-react';
import type { ServiceStatus } from '../hooks/useDashboard';

export function ServiceCard({ status }: { status: ServiceStatus }) {
    const { service, online, message } = status;

    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="glass-panel service-card"
        >
            <div className="service-header">
                <h3>{service}</h3>
                {online && <div className="status-dot pulsing" role="status" aria-label="Online" />}
            </div>

            <div className="service-message">
                <Activity size={16} />
                <span>{message}</span>
            </div>

            <div className={`status-pill ${online ? 'online' : 'offline'}`}>
                {online ? 'System Active' : 'System Offline'}
            </div>
        </motion.div>
    );
}
