import { useState, useEffect } from 'react';
import { Bell, Film, Tv, PlaySquare, Save, Loader2, Check } from 'lucide-react';

interface NotificationConfig {
    grab: boolean;
    download: boolean;
}

interface PlexConfig {
    play: boolean;
    resume: boolean;
    scrobble: boolean;
    library: boolean;
}

interface Settings {
    radarr: NotificationConfig;
    sonarr: NotificationConfig;
    plex: PlexConfig;
    timezone: string;
}

export function NotificationSettings({ onSaveComplete }: { onSaveComplete?: () => void }) {
    const [settings, setSettings] = useState<Settings>({
        radarr: { grab: true, download: true },
        sonarr: { grab: true, download: true },
        plex: { play: true, resume: true, scrobble: true, library: true },
        timezone: 'UTC'
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saveSuccess, setSaveSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const BASE_URL = import.meta.env.DEV ? 'http://localhost:1111' : '';
    const PROXY_SECRET = import.meta.env.VITE_PROXY_SECRET_KEY || 'dev_secret_key';

    useEffect(() => {
        fetchSettings();
    }, []);

    const fetchSettings = async () => {
        try {
            setLoading(true);
            const res = await fetch(`${BASE_URL}/api/settings/notifications`);
            if (!res.ok) throw new Error("Failed to fetch settings");
            const data = await res.json();
            setSettings(data);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error");
        } finally {
            setLoading(false);
        }
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            const res = await fetch(`${BASE_URL}/api/settings/notifications`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "Authorization": `Bearer ${PROXY_SECRET}`
                },
                body: JSON.stringify(settings)
            });

            if (!res.ok) throw new Error("Failed to save settings");

            setSaveSuccess(true);
            if (onSaveComplete) onSaveComplete();

            setTimeout(() => {
                setSaveSuccess(false);
            }, 3000);

        } catch (err) {
            setError("Failed to save settings. Check proxy logs.");
        } finally {
            setSaving(false);
        }
    };

    const toggleSetting = (service: keyof Settings, action: string) => {
        if (service === 'timezone') return;
        setSettings(prev => ({
            ...prev,
            [service]: {
                ...prev[service] as any,
                [action]: !((prev[service] as any)[action])
            }
        }));
    };

    if (loading) {
        return (
            <div className="glass-panel" style={{ padding: '2rem', display: 'flex', justifyContent: 'center' }}>
                <Loader2 className="spinner" size={24} color="var(--accent-color)" />
            </div>
        );
    }

    return (
        <div className="glass-panel">
            <div className="section-header" style={{ padding: '1.5rem', borderBottom: '1px solid var(--panel-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <Bell size={24} color="var(--accent-color)" />
                    <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Notification Alerts</h2>
                </div>
            </div>

            <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                {error && (
                    <div style={{ color: 'var(--danger-color)', padding: '1rem', background: 'rgba(248, 81, 73, 0.1)', borderRadius: '8px' }}>
                        {error}
                    </div>
                )}

                {/* Radarr Settings */}
                <div className="settings-group">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                        <Film size={20} color="#ffc230" />
                        <h3 style={{ margin: 0 }}>Radarr (Movies)</h3>
                    </div>

                    <div className="toggle-row">
                        <span>Notify when a movie is Grabbed</span>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={settings.radarr.grab}
                                onChange={() => toggleSetting('radarr', 'grab')}
                            />
                            <span className="slider"></span>
                        </label>
                    </div>

                    <div className="toggle-row">
                        <span>Notify when a movie is Downloaded</span>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={settings.radarr.download}
                                onChange={() => toggleSetting('radarr', 'download')}
                            />
                            <span className="slider"></span>
                        </label>
                    </div>
                </div>

                {/* Sonarr Settings */}
                <div className="settings-group" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '2rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                        <Tv size={20} color="#0084ff" />
                        <h3 style={{ margin: 0 }}>Sonarr (TV Shows)</h3>
                    </div>

                    <div className="toggle-row">
                        <span>Notify when an episode is Grabbed</span>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={settings.sonarr.grab}
                                onChange={() => toggleSetting('sonarr', 'grab')}
                            />
                            <span className="slider"></span>
                        </label>
                    </div>

                    <div className="toggle-row">
                        <span>Notify when an episode is Downloaded</span>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={settings.sonarr.download}
                                onChange={() => toggleSetting('sonarr', 'download')}
                            />
                            <span className="slider"></span>
                        </label>
                    </div>
                </div>

                {/* Plex Settings */}
                <div className="settings-group" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '2rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                        <PlaySquare size={20} color="#e5a00d" />
                        <h3 style={{ margin: 0 }}>Plex (Streaming)</h3>
                    </div>

                    <div className="toggle-row">
                        <span>Notify on Play</span>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={settings.plex.play}
                                onChange={() => toggleSetting('plex', 'play')}
                            />
                            <span className="slider"></span>
                        </label>
                    </div>

                    <div className="toggle-row">
                        <span>Notify on Resume</span>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={settings.plex.resume}
                                onChange={() => toggleSetting('plex', 'resume')}
                            />
                            <span className="slider"></span>
                        </label>
                    </div>

                    <div className="toggle-row">
                        <span>Notify on Finish (Scrobble)</span>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={settings.plex.scrobble}
                                onChange={() => toggleSetting('plex', 'scrobble')}
                            />
                            <span className="slider"></span>
                        </label>
                    </div>

                    <div className="toggle-row">
                        <span>Notify when New Content is Added</span>
                        <label className="toggle-switch">
                            <input
                                type="checkbox"
                                checked={settings.plex.library}
                                onChange={() => toggleSetting('plex', 'library')}
                            />
                            <span className="slider"></span>
                        </label>
                    </div>
                </div>

                {/* Timezone Settings */}
                <div className="settings-group" style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '2rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
                        <span style={{ fontSize: '1.25rem' }}>🕒</span>
                        <h3 style={{ margin: 0 }}>System Timezone</h3>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                                Select your local timezone
                            </span>
                        </div>
                        <select
                            value={settings.timezone}
                            onChange={(e) => setSettings(prev => ({ ...prev, timezone: e.target.value }))}
                            className="glass-panel"
                            style={{
                                padding: '0.75rem',
                                background: 'rgba(255,255,255,0.02)',
                                border: '1px solid var(--panel-border)',
                                color: 'var(--text-primary)',
                                borderRadius: '8px',
                                outline: 'none',
                                cursor: 'pointer',
                                width: '100%',
                                appearance: 'none'
                            }}
                        >
                            {Intl.supportedValuesOf('timeZone').map(tz => (
                                <option key={tz} value={tz} style={{ background: '#1a1a1a', color: 'white' }}>
                                    {tz.replace(/_/g, ' ')}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1rem' }}>
                    <button
                        className="glass-button flex-center"
                        onClick={handleSave}
                        disabled={saving}
                        style={{ padding: '0.75rem 1.5rem', background: saveSuccess ? 'rgba(63, 185, 80, 0.2)' : undefined }}
                    >
                        {saving ? (
                            <Loader2 className="spinner" size={18} />
                        ) : saveSuccess ? (
                            <Check size={18} color="var(--success-color)" />
                        ) : (
                            <Save size={18} />
                        )}
                        <span>{saveSuccess ? 'Saved' : 'Save Changes'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
