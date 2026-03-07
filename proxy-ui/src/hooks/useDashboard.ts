import { useState, useEffect, useCallback } from 'react';

export type ServiceStatus = {
    service: string;
    online: boolean;
    message: string;
};

export type MediaEvent = {
    id: string;
    service: string;
    event_type: string;
    title: string;
    message: string;
    timestamp: string;
};

export function useDashboard() {
    const [statuses, setStatuses] = useState<ServiceStatus[]>([]);
    const [logs, setLogs] = useState<string[]>([]);
    const [events, setEvents] = useState<MediaEvent[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchData = useCallback(async () => {
        try {
            // Use relative path which works in prod, or fallback to dev server proxy
            const baseUrl = import.meta.env.DEV ? 'http://localhost:3001' : '';

            const [statusRes, logsRes, eventsRes] = await Promise.all([
                fetch(`${baseUrl}/api/dashboard/status`),
                fetch(`${baseUrl}/api/dashboard/logs`),
                fetch(`${baseUrl}/api/dashboard/events`)
            ]);

            if (statusRes.ok) {
                const data = await statusRes.json();
                setStatuses(data.status);
            }
            if (logsRes.ok) {
                const data = await logsRes.json();
                setLogs(data.logs);
            }
            if (eventsRes.ok) {
                const data = await eventsRes.json();
                setEvents(data.events || []);
            }
        } catch (error) {
            console.error("Failed to fetch dashboard data:", error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 5000); // Polling every 5 seconds
        return () => clearInterval(interval);
    }, [fetchData]);

    return { statuses, logs, events, loading, refresh: fetchData };
}
