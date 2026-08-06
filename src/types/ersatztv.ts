export interface ErsatzTVChannel {
	id: string;
	number: string;
	name: string;
	group?: string;
	streamUrl?: string;
	ffmpegProfileId?: number;
	watermarkId?: number;
	mode?: string;
}

export interface ErsatzTVGuideProgram {
	id: string;
	title: string;
	subTitle?: string;
	description?: string;
	start: string;
	end: string;
	durationMinutes: number;
	channelNumber: string;
	channelName: string;
	type: "movie" | "episode" | "music_video" | "other";
	seasonNumber?: number;
	episodeNumber?: number;
}

export interface ErsatzTVChannelGuide {
	id: string;
	number: string;
	name: string;
	programs: ErsatzTVGuideProgram[];
}

export interface ErsatzTVDailyGuide {
	date: string;
	channels: ErsatzTVChannelGuide[];
}

export interface ErsatzTVPlayout {
	id: string;
	channelId: string;
	channelNumber: string;
	channelName: string;
	scheduleId: string;
	scheduleName: string;
	playoutType: string;
	anchor?: string;
}

export interface ErsatzTVSchedule {
	id: string;
	name: string;
	keepMultiPartEpisodesTogether: boolean;
	treatCollectionsAsShows: boolean;
	shuffleScheduleItems: boolean;
}

export interface ContentFilterOptions {
	genres?: string[];
	showTitles?: string[];
	releaseYearRange?: {
		min?: number;
		max?: number;
	};
	tags?: string[];
}

export interface ChannelDirectorParams {
	channelId?: string;
	channelNumber?: string;
	channelName: string;
	contentFilters: ContentFilterOptions;
	scheduleMode: "block" | "chronological" | "random" | "shuffle";
	slotDurationMinutes?: number;
	includeFillers?: boolean;
	watermarkId?: string;
}

export interface ChannelDirectorResult {
	success: boolean;
	channelId: string;
	channelNumber: string;
	channelName: string;
	scheduleId: string;
	playoutId: string;
	message: string;
}
