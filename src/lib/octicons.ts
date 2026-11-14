/**
 * The Octicons reckon draws, from Primer's own package (@primer/octicons,
 * MIT): each 16px icon imported on its own, so the bundle carries these and
 * no others, and read as the path data it draws -- the SVG's own markup is
 * never put into the page.
 */
import alert from '@primer/octicons/build/svg/alert-16.svg?raw';
import check from '@primer/octicons/build/svg/check-16.svg?raw';
import checkCircle from '@primer/octicons/build/svg/check-circle-16.svg?raw';
import copy from '@primer/octicons/build/svg/copy-16.svg?raw';
import info from '@primer/octicons/build/svg/info-16.svg?raw';
import kebab from '@primer/octicons/build/svg/kebab-horizontal-16.svg?raw';
import pencil from '@primer/octicons/build/svg/pencil-16.svg?raw';
import x from '@primer/octicons/build/svg/x-16.svg?raw';

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
	info: paths(info)
};

export type OcticonName = keyof typeof OCTICON;
