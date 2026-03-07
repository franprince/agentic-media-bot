import { useDashboard } from './hooks/useDashboard';
import { ServiceCard } from './components/ServiceCard';
import { LogsViewer } from './components/LogsViewer';
import { EventsViewer } from './components/EventsViewer';
import { NotificationSettings } from './components/NotificationSettings';
import { RefreshCw, LayoutDashboard } from 'lucide-react';
import { motion } from 'framer-motion';

function App() {
  const { statuses, logs, events, loading, refresh } = useDashboard();

  return (
    <div className="app-container">
      <header className="glass-panel header">
        <div className="header-title">
          <div className="icon-wrapper">
            <LayoutDashboard size={24} color="var(--accent-color)" />
          </div>
          <h1>Agentic Media Gateway</h1>
        </div>

        <button
          onClick={refresh}
          className="glass-button flex-center"
          disabled={loading}
        >
          <motion.div animate={{ rotate: loading ? 360 : 0 }} transition={{ repeat: loading ? Infinity : 0, ease: "linear", duration: 1 }}>
            <RefreshCw size={16} />
          </motion.div>
          <span>Refresh</span>
        </button>
      </header>

      <main className="main-content">
        <section>
          <div className="section-header">
            <h2>System Status</h2>
            {loading && statuses.length === 0 && (
              <span style={{ fontSize: '0.875rem', color: 'var(--accent-color)', animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite' }}>
                Connecting to Proxy...
              </span>
            )}
          </div>

          <div className="status-grid">
            {statuses.map(status => (
              <ServiceCard key={status.service} status={status} />
            ))}
          </div>
        </section>

        <div className="dashboard-grid">
          <section style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            <EventsViewer events={events} />
            <NotificationSettings />
          </section>

          <section>
            <LogsViewer logs={logs} />
          </section>
        </div>
      </main>
    </div>
  );
}

export default App;
