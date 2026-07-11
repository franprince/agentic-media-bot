export interface QBittorrentTorrent {
	hash: string;
	name: string;
	size: number;
	progress: number;
	dlspeed: number;
	upspeed: number;
	priority: number;
	num_seeds: number;
	num_leechs: number;
	num_incomplete: number;
	ratio: number;
	eta: number;
	state: string; // e.g. "downloading", "pausedDL", "stalledDL", "uploading", "pausedUP"
	seq_dl: boolean;
	f_l_piece_prio: boolean;
	category: string;
	super_seeding: boolean;
	force_start: boolean;
	save_path: string;
	added_on: number;
	completion_on: number;
}
