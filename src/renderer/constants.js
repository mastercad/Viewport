export const PRESETS = {
  desktop: { id: 'desktop', label: 'Desktop', w: 1920, h: 1080 },
  laptop:  { id: 'laptop',  label: 'Laptop',  w: 1366, h: 768,  frame: { t: 18, r: 10, b: 46, l: 10 } },
  tablet:  { id: 'tablet',  label: 'Tablet',  w: 768,  h: 1024, frame: { t: 24, r: 16, b: 20, l: 16 } },
  iphone:  { id: 'iphone',  label: 'iPhone',  w: 390,  h: 844,  frame: { t: 44, r: 14, b: 30, l: 14 } },
  android: { id: 'android', label: 'Android', w: 360,  h: 800,  frame: { t: 32, r: 12, b: 26, l: 12 } },
};

export const SNAP_THRESH  = 14;
export const FRAME_HEAD_H = 36;
export const MIN_W        = 200;
export const MIN_H        = 150;
