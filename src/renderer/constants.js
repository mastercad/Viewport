export const DEVICE_UA = {
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  laptop:  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  tablet:  'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/122.0.0.0 Mobile/15E148 Safari/604.1',
  iphone:  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  android: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36',
};

export const PRESETS = {
  desktop: { id: 'desktop', label: 'Desktop', w: 1920, h: 1080, mobile: false },
  laptop:  { id: 'laptop',  label: 'Laptop',  w: 1366, h: 768,  frame: { t: 18, r: 10, b: 46, l: 10 }, mobile: false },
  tablet:  { id: 'tablet',  label: 'Tablet',  w: 768,  h: 1024, frame: { t: 24, r: 16, b: 20, l: 16 }, mobile: true  },
  iphone:  { id: 'iphone',  label: 'iPhone',  w: 390,  h: 844,  frame: { t: 44, r: 14, b: 30, l: 14 }, mobile: true  },
  android: { id: 'android', label: 'Android', w: 360,  h: 800,  frame: { t: 32, r: 12, b: 26, l: 12 }, mobile: true  },
};

export const SNAP_THRESH  = 14;
export const FRAME_HEAD_H = 36;
export const MIN_W        = 200;
export const MIN_H        = 150;
