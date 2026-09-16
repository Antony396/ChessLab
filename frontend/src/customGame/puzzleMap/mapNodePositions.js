// Pixel positions (as % of /puzzle-map/map-background.png's own width/
// height) for each of the 50 route nodes, so they sit directly on the
// dotted path painted into the artwork. Derived once, offline, from the
// image itself: the artwork has 30 hand-painted waypoint circles along its
// path (traced by eye, crop by crop, to get their true left-to-right
// drawing order rather than guessing from raw pixel distance, which cuts
// across the path's own loops); these 50 positions are then evenly
// resampled along that same traced route by cumulative arc length, so the
// 50 game nodes read as a smooth, evenly-spaced progression rather than
// clumping wherever the original 30 decorative circles happened to be.
// Index 0 here is node 1, index 49 is node 50 (the Hydra finale).
export const MAP_NODE_POSITIONS = [
  { x: 26.87, y: 31.31 },
  { x: 28.81, y: 37.42 },
  { x: 24.37, y: 38.13 },
  { x: 19.93, y: 38.84 },
  { x: 15.49, y: 39.55 },
  { x: 18.05, y: 43.31 },
  { x: 22.35, y: 43.58 },
  { x: 26.79, y: 42.89 },
  { x: 31.23, y: 42.11 },
  { x: 35.61, y: 42.34 },
  { x: 39.85, y: 43.39 },
  { x: 43.89, y: 40.23 },
  { x: 47.92, y: 41.86 },
  { x: 51.88, y: 43.54 },
  { x: 55.65, y: 39.56 },
  { x: 58.98, y: 34.63 },
  { x: 62.53, y: 30.17 },
  { x: 66.6, y: 27.16 },
  { x: 70.48, y: 28.56 },
  { x: 73.18, y: 34.22 },
  { x: 75.34, y: 40.73 },
  { x: 78.34, y: 46.18 },
  { x: 81.5, y: 51.43 },
  { x: 84.65, y: 56.69 },
  { x: 81.38, y: 61.57 },
  { x: 77.05, y: 63.31 },
  { x: 72.74, y: 61.64 },
  { x: 68.5, y: 59.49 },
  { x: 65.14, y: 54.62 },
  { x: 62.15, y: 49.13 },
  { x: 61.58, y: 49.94 },
  { x: 63.13, y: 56.91 },
  { x: 64.67, y: 63.88 },
  { x: 64.27, y: 68.78 },
  { x: 59.83, y: 69.37 },
  { x: 55.38, y: 69.97 },
  { x: 50.94, y: 70.56 },
  { x: 50.85, y: 72.14 },
  { x: 55.05, y: 74.55 },
  { x: 59.5, y: 74.3 },
  { x: 60.5, y: 73.36 },
  { x: 56.2, y: 71.37 },
  { x: 51.91, y: 69.38 },
  { x: 47.61, y: 67.39 },
  { x: 43.32, y: 66.06 },
  { x: 39.12, y: 68.48 },
  { x: 35.53, y: 72.9 },
  { x: 32.54, y: 78.39 },
  { x: 28.37, y: 80.29 },
  { x: 23.97, y: 81.46 },
];
