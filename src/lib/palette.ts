/** Colours for several series drawn together (compare lines, best buys). Readable on both themes. */
export const SERIES = ['#22c7e8', '#a78bfa', '#f5b942', '#f472b6', '#60a5fa', '#fb923c', '#34d399', '#e879f9'];

export const seriesColour = (i: number): string => SERIES[i % SERIES.length]!;
