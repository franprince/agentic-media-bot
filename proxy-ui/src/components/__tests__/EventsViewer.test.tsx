import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "bun:test";
import type { MediaEvent } from "../../hooks/useDashboard";
import { EventsViewer } from "../EventsViewer";

describe("EventsViewer", () => {
	it('displays "No recent events found." when empty', () => {
		render(<EventsViewer events={[]} />);
		expect(screen.getByText("No recent events found.")).toBeInTheDocument();
	});

	it("renders provided events", () => {
		const sampleEvents: MediaEvent[] = [
			{
				id: "1",
				service: "Radarr",
				event_type: "Grab",
				title: "Deadpool 3",
				message: "Downloaded successfully",
				timestamp: "2026-03-07T12:00:00Z",
			},
			{
				id: "2",
				service: "Sonarr",
				event_type: "Added",
				title: "The Boys",
				message: "Added to monitored list",
				timestamp: "2026-03-07T13:00:00Z",
			},
		];

		render(<EventsViewer events={sampleEvents} />);

		expect(screen.getByText("Deadpool 3")).toBeInTheDocument();
		expect(screen.getByText("Downloaded successfully")).toBeInTheDocument();

		expect(screen.getByText("The Boys")).toBeInTheDocument();
		expect(screen.getByText("Added to monitored list")).toBeInTheDocument();
	});
});
