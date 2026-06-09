// Physical constants (SI units unless noted).

/** Newtonian gravitational constant, m^3 kg^-1 s^-2. */
export const G = 6.6743e-11;

/** Astronomical unit in meters (IAU 2012 definition). */
export const AU = 1.495978707e11;

/** AU in kilometers. */
export const AU_KM = AU / 1000;

/** Solar mass, kg. */
export const M_SUN = 1.98892e30;

/** Standard gravitational parameter of the Sun, GM_sun (m^3/s^2). */
export const GM_SUN = G * M_SUN;

/** Seconds in a Julian day. */
export const DAY = 86400;

/** Seconds in a Julian year (365.25 days). */
export const YEAR = 365.25 * DAY;

/** Degrees -> radians. */
export const DEG = Math.PI / 180;
