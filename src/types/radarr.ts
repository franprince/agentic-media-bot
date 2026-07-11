export interface RadarrMovie {
	id?: number;
	title: string;
	originalTitle?: string;
	overview?: string;
	year: number;
	tmdbId: number;
	imdbId?: string;
	genres?: string[];
	hasFile?: boolean;
	monitored?: boolean;
	sizeOnDisk?: number;
	images?: Array<{ coverType: string; url: string; remoteUrl?: string }>;
	ratings?: {
		imdb?: { value: number; votes: number };
		tmdb?: { value: number; votes: number };
		metacritic?: { value: number; votes: number };
		rottenTomatoes?: { value: number; votes: number };
	};
	// Additional fields needed for adding
	qualityProfileId?: number;
	rootFolderPath?: string;
	path?: string;
}

export interface RadarrQueueItem {
	id: number;
	movieId: number;
	title: string;
	size: number;
	sizeleft: number;
	status: string;
	trackedDownloadStatus: string;
	trackedDownloadState: string;
	errorMessage?: string;
}

export interface RadarrWebhookPayload {
	eventType: "Grab" | "Download" | "Test";
	movie: {
		id: number;
		title: string;
		year: number;
		tmdbId: number;
		imdbId?: string;
	};
	remoteMovie?: {
		title: string;
		year: number;
		tmdbId: number;
		imdbId?: string;
	};
	release?: {
		quality: string;
		qualityVersion: number;
		releaseGroup?: string;
		releaseTitle: string;
		indexer: string;
		size: number;
	};
	movieFile?: {
		id: number;
		relativePath: string;
		path: string;
		quality:
			| string
			| {
					quality: {
						id: number;
						name: string;
						source?: string;
						resolution?: number;
					};
					revision: {
						version: number;
						real: number | boolean;
						isRepack?: boolean;
					};
			  };
	};
	downloadClient?: string;
	downloadId?: string;
}
