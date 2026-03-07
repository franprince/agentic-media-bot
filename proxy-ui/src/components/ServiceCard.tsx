import { motion } from 'framer-motion';
import { CheckCircle2, XCircle, Activity } from 'lucide-react';
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
                {online ? (
                    <CheckCircle2 color="var(--success-color)" size={32} />
                ) : (
                    <XCircle color="var(--danger-color)" size={32} />
                )}
                <h3>{service}</h3>
            </div>

            <div className="service-message">
                <Activity size={16} />
                <span>{message}</span>
            </div>

            <div className="service-bar-container">
                <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: "100%" }}
                    transition={{ repeat: Infinity, duration: online ? 2 : 0, ease: "linear" }}
                    className={`service-bar ${online ? 'online' : 'offline'}`}
                />
            </div>
        </motion.div>
    );
}
