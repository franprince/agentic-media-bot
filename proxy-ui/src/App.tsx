import { useState } from 'react';
import { useDashboard } from './hooks/useDashboard';
import { ServiceCard } from './components/ServiceCard';
import { LogsViewer } from './components/LogsViewer';
import { EventsViewer } from './components/EventsViewer';
import { NotificationSettings } from './components/NotificationSettings';
import { RefreshCw, LayoutDashboard, Bell } from 'lucide-react';
import { motion } from 'framer-motion';

function App() {
  const [view, setView] = useState<'dashboard' | 'settings'>('dashboard');
  const { statuses, logs, events, loading, refresh } = useDashboard();

  return (
    <div className="app-container">
      <header className="glass-panel header">
        <div className="header-title" onClick={() => setView('dashboard')} style={{ cursor: 'pointer' }}>
          <div className="icon-wrapper">
            <LayoutDashboard size={24} color="var(--accent-color)" />
          </div>
          <h1>Agentic Media Gateway</h1>
        </div>

        <div className="header-actions" style={{ display: 'flex', gap: '1rem' }}>
          <button
            onClick={() => setView(view === 'dashboard' ? 'settings' : 'dashboard')}
            className={`glass-button flex-center ${view === 'settings' ? 'active' : ''}`}
          >
            <Bell size={16} />
            <span>{view === 'dashboard' ? 'Settings' : 'Dashboard'}</span>
          </button>

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
        </div>
      </header>

      <main className="main-content">
        {view === 'dashboard' ? (
          <>
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
              </section>

              <section>
                <LogsViewer logs={logs} />
              </section>
            </div>
          </>
        ) : (
          <section className="settings-page" style={{ maxWidth: '800px', margin: '0 auto' }}>
            <NotificationSettings onSaveComplete={() => setTimeout(() => setView('dashboard'), 1500)} />
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
