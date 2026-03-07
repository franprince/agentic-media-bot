import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ServiceCard } from '../ServiceCard';

describe('ServiceCard', () => {
    it('renders the service name and message appropriately for an online service', () => {
        render(<ServiceCard status={{ service: 'Radarr', online: true, message: 'Online and healthy' }} />);

        expect(screen.getByText('Radarr')).toBeInTheDocument();
        expect(screen.getByText('Online and healthy')).toBeInTheDocument();
    });

    it('renders correctly for an offline service', () => {
        render(<ServiceCard status={{ service: 'Sonarr', online: false, message: 'Connection refused' }} />);

        expect(screen.getByText('Sonarr')).toBeInTheDocument();
        expect(screen.getByText('Connection refused')).toBeInTheDocument();
    });
});
