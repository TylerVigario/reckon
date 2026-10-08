/**
 * A trip as the trip form holds it while it is being recorded or changed: a
 * new one starts empty, and a saved one starts as it was saved
 * (#routes/trips/[id]/change).
 */
export type Visit = { entityId: string; siteId: string | null; askedThere: boolean };

export type StopDraft = {
	key: string;
	siteId: string | null;
	address: string | null;
	visits: Visit[];
};

export type TripDraft = {
	clientUuid: string | null;
	day: string;
	driver: string;
	vehicleId: string | null;
	serviceId: string | null;
	startAddress: string | null;
	endAddress: string | null;
	stops: StopDraft[];
	/** Miles as recorded, and who a drive was given to by hand, by #lib/trip-legs driveKey. */
	typed: Record<string, string>;
	given: Record<string, string[]>;
	odometerStart: string;
	odometerEnd: string;
	note: string;
};
