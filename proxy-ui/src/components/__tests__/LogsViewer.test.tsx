import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { LogsViewer } from '../LogsViewer';

describe('LogsViewer', () => {
    it('displays "No logs available" when empty', () => {
        render(<LogsViewer logs={[]} />);
        expect(screen.getByText('No logs available')).toBeInTheDocument();
    });

    it('renders provided log messages', () => {
        const sampleLogs = [
            "INFO: Bot starting up",
            "ERROR: Connection failed",
            "WARN: High latency"
        ];
        render(<LogsViewer logs={sampleLogs} />);

        sampleLogs.forEach(log => {
            expect(screen.getByText(log)).toBeInTheDocument();
        });
    });
});
