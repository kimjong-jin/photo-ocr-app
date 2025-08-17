export const isMobileDevice = (): boolean => {
  if (typeof window === 'undefined') {
    return false;
  }
  return /Mobi|Android/i.test(navigator.userAgent);
};
