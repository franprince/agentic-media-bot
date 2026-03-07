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
                sonarr: { grab: false, download: true }
            })
        });
    });

    it('renders loading state initially', () => {
        // Delay resolution to catch loading state
        mockFetch.mockImplementationOnce(() => new Promise(resolve => setTimeout(resolve, 100)));
        render(<NotificationSettings />);

        // Check loading indicator (lucide Loader2 has class "spinner")
        const spinner = document.querySelector('.spinner');
        expect(spinner).toBeInTheDocument();
    });

    it('renders settings after successful fetch', async () => {
        render(<NotificationSettings />);

        await waitFor(() => {
            expect(screen.getByText('Notification Alerts')).toBeInTheDocument();
            expect(screen.getByText('Radarr (Movies)')).toBeInTheDocument();
            expect(screen.getByText('Sonarr (TV Shows)')).toBeInTheDocument();
        });

        // Check fetched state
        const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
        expect(checkboxes).toHaveLength(4);

        // Radarr Grab (true)
        expect(checkboxes[0].checked).toBe(true);
        // Radarr Download (false)
        expect(checkboxes[1].checked).toBe(false);
        // Sonarr Grab (false)
        expect(checkboxes[2].checked).toBe(false);
        // Sonarr Download (true)
        expect(checkboxes[3].checked).toBe(true);
    });

    it('toggles settings when clicked', async () => {
        const user = userEvent.setup();
        render(<NotificationSettings />);

        await waitFor(() => {
            expect(screen.getByText('Notification Alerts')).toBeInTheDocument();
        });

        const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
        const radarrGrab = checkboxes[0];

        expect(radarrGrab.checked).toBe(true);

        // Click the label/slider to toggle
        await user.click(radarrGrab);

        expect(radarrGrab.checked).toBe(false);
    });

    it('submits correctly on save', async () => {
        const user = userEvent.setup();
        render(<NotificationSettings />);

        await waitFor(() => {
            expect(screen.getByText('Notification Alerts')).toBeInTheDocument();
        });

        // Mock successful save response
        mockFetch.mockResolvedValueOnce({
            ok: true,
            json: async () => ({ success: true })
        });

        const saveButton = screen.getByRole('button', { name: /save changes/i });
        await user.click(saveButton);

        expect(mockFetch).toHaveBeenCalledTimes(2); // 1 for fetch, 1 for save
        expect(mockFetch).toHaveBeenLastCalledWith(
            'http://localhost:3001/api/settings/notifications',
            expect.objectContaining({
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': expect.stringContaining('Bearer')
                },
                body: JSON.stringify({
                    radarr: { grab: true, download: false },
                    sonarr: { grab: false, download: true }
                })
            })
        );
    });
});
