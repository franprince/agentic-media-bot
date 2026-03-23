import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NotificationSettings } from '../NotificationSettings';

// Mock fetch globally
const mockFetch = vi.fn();
window.fetch = mockFetch;

describe('NotificationSettings', () => {
    beforeEach(() => {
        mockFetch.mockReset();
        // Default success response for fetchSettings
        mockFetch.mockResolvedValue({
            ok: true,
            json: async () => ({
                radarr: { grab: true, download: false },
                sonarr: { grab: false, download: true },
                plex: { play: true, resume: false, scrobble: true, library: false }
            })
        });

        // Mock import.meta.env
        vi.stubGlobal('import', {
            meta: {
                env: {
                    DEV: true,
                    VITE_PROXY_SECRET_KEY: 'test_secret'
                }
            }
        });
    });

    it('renders loading state initially', () => {
        mockFetch.mockImplementationOnce(() => new Promise(resolve => setTimeout(resolve, 100)));
        render(<NotificationSettings />);
        const spinner = document.querySelector('.spinner');
        expect(spinner).toBeInTheDocument();
    });

    it('renders settings after successful fetch', async () => {
        render(<NotificationSettings />);

        await waitFor(() => {
            expect(screen.getByText('Notification Alerts')).toBeInTheDocument();
            expect(screen.getByText('Radarr (Movies)')).toBeInTheDocument();
            expect(screen.getByText('Sonarr (TV Shows)')).toBeInTheDocument();
            expect(screen.getByText('Plex (Streaming)')).toBeInTheDocument();
        });

        const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
        expect(checkboxes).toHaveLength(8);

        // Radarr
        expect(checkboxes[0].checked).toBe(true); // Grab
        expect(checkboxes[1].checked).toBe(false); // Download
        // Sonarr
        expect(checkboxes[2].checked).toBe(false); // Grab
        expect(checkboxes[3].checked).toBe(true); // Download
        // Plex
        expect(checkboxes[4].checked).toBe(true); // Play
        expect(checkboxes[5].checked).toBe(false); // Resume
        expect(checkboxes[6].checked).toBe(true); // Scrobble
        expect(checkboxes[7].checked).toBe(false); // Library
    });

    it('toggles settings when clicked', async () => {
        const user = userEvent.setup();
        render(<NotificationSettings />);

        await waitFor(() => {
            expect(screen.getByText('Notification Alerts')).toBeInTheDocument();
        });

        const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
        const plexResume = checkboxes[5];

        expect(plexResume.checked).toBe(false);
        await user.click(plexResume);
        expect(plexResume.checked).toBe(true);
    });

    it('submits correctly on save', async () => {
        const user = userEvent.setup();
        render(<NotificationSettings />);

        await waitFor(() => {
            expect(screen.getByText('Notification Alerts')).toBeInTheDocument();
        });

        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true })
        });

        const saveButton = screen.getByRole('button', { name: /save changes/i });
        await user.click(saveButton);

        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(mockFetch).toHaveBeenLastCalledWith(
            'http://localhost:1111/api/settings/notifications',
            expect.objectContaining({
                method: 'POST',
                body: JSON.stringify({
                    radarr: { grab: true, download: false },
                    sonarr: { grab: false, download: true },
                    plex: { play: true, resume: false, scrobble: true, library: false }
                })
            })
        );
    });
});
