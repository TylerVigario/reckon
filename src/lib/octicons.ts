/**
 * The Octicons reckon draws, from Primer's own package (@primer/octicons,
 * MIT): each icon imported on its own, so the bundle carries these and no
 * others, and read as the path data it draws -- the SVG's own markup is never
 * put into the page. Octicons are drawn at 16px, and the tab bar's at 24px,
 * which Octicons draws again for that size rather than scaling the 16.
 */
import alert from '@primer/octicons/build/svg/alert-16.svg?raw';
import arrowLeft from '@primer/octicons/build/svg/arrow-left-16.svg?raw';
import check from '@primer/octicons/build/svg/check-16.svg?raw';
import checkCircle from '@primer/octicons/build/svg/check-circle-16.svg?raw';
import clock from '@primer/octicons/build/svg/clock-16.svg?raw';
import cloudOffline from '@primer/octicons/build/svg/cloud-offline-16.svg?raw';
import copy from '@primer/octicons/build/svg/copy-16.svg?raw';
import creditCard from '@primer/octicons/build/svg/credit-card-16.svg?raw';
import file from '@primer/octicons/build/svg/file-16.svg?raw';
import gear from '@primer/octicons/build/svg/gear-16.svg?raw';
import graph from '@primer/octicons/build/svg/graph-16.svg?raw';
import home from '@primer/octicons/build/svg/home-16.svg?raw';
import info from '@primer/octicons/build/svg/info-16.svg?raw';
import kebab from '@primer/octicons/build/svg/kebab-horizontal-16.svg?raw';
import location from '@primer/octicons/build/svg/location-16.svg?raw';
import organization from '@primer/octicons/build/svg/organization-16.svg?raw';
import pkg from '@primer/octicons/build/svg/package-16.svg?raw';
import pencil from '@primer/octicons/build/svg/pencil-16.svg?raw';
import people from '@primer/octicons/build/svg/people-16.svg?raw';
import person from '@primer/octicons/build/svg/person-16.svg?raw';
import signOut from '@primer/octicons/build/svg/sign-out-16.svg?raw';
import upload from '@primer/octicons/build/svg/upload-16.svg?raw';
import x from '@primer/octicons/build/svg/x-16.svg?raw';
import apps24 from '@primer/octicons/build/svg/apps-24.svg?raw';
import clock24 from '@primer/octicons/build/svg/clock-24.svg?raw';
import file24 from '@primer/octicons/build/svg/file-24.svg?raw';
import home24 from '@primer/octicons/build/svg/home-24.svg?raw';
import location24 from '@primer/octicons/build/svg/location-24.svg?raw';

/** Each path an Octicon's SVG draws, in order. */
const paths = (svg: string) => [...svg.matchAll(/<path d="([^"]+)"/g)].map((m) => m[1]);

export const OCTICON = {
	kebab: paths(kebab),
	pencil: paths(pencil),
	copy: paths(copy),
	check: paths(check),
	x: paths(x),
	alert: paths(alert),
	checkCircle: paths(checkCircle),
	info: paths(info),
	arrowLeft: paths(arrowLeft),
	home: paths(home),
	clock: paths(clock),
	location: paths(location),
	file: paths(file),
	package: paths(pkg),
	organization: paths(organization),
	people: paths(people),
	graph: paths(graph),
	gear: paths(gear),
	creditCard: paths(creditCard),
	person: paths(person),
	signOut: paths(signOut),
	cloudOffline: paths(cloudOffline),
	upload: paths(upload)
};

/** The tab bar's, at 24px. */
export const OCTICON_24 = {
	home: paths(home24),
	clock: paths(clock24),
	location: paths(location24),
	file: paths(file24),
	apps: paths(apps24)
};

export type OcticonName = keyof typeof OCTICON;
export type Octicon24Name = keyof typeof OCTICON_24;
