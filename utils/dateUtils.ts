import { LeaveType } from '../types';

// Malaysian Public Holidays for 2025 (fallback)
export const MALAYSIAN_PUBLIC_HOLIDAYS_2025 = [
  '2025-01-01', // New Year's Day
  '2025-01-28', // Thaipusam
  '2025-02-01', // Federal Territory Day
  '2025-02-10', // Chinese New Year
  '2025-02-11', // Chinese New Year (2nd day)
  '2025-02-12', // Chinese New Year (3rd day)
  '2025-03-23', // Nuzul Al-Quran
  '2025-04-14', // Good Friday
  '2025-05-01', // Labour Day
  '2025-05-22', // Wesak Day
  '2025-06-07', // Yang di-Pertuan Agong's Birthday
  '2025-06-16', // Hari Raya Aidilfitri
  '2025-06-17', // Hari Raya Aidilfitri (2nd day)
  '2025-08-31', // National Day
  '2025-09-16', // Malaysia Day
  '2025-09-25', // Hari Raya Aidiladha
  '2025-10-05', // Awal Muharram
  '2025-12-25', // Christmas Day
];

// Cache for public holidays loaded from Firebase (date -> name mapping)
let publicHolidaysCache: Map<string, string> | null = null;
let cachedYear: number | null = null;
// Cache for multiple years (year -> Map<date, name>)
let multiYearCache: Map<number, Map<string, string>> = new Map();
// Promise cache to avoid loading the same year multiple times simultaneously
let loadingPromises: Map<number, Promise<void>> = new Map();

// Day names in English
export const DAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'
];

// Day names in Malay (optional)
export const DAY_NAMES_MALAY = [
  'Ahad', 'Isnin', 'Selasa', 'Rabu', 'Khamis', 'Jumaat', 'Sabtu'
];

/**
 * Set public holidays cache from Firebase
 */
export function setPublicHolidaysCache(holidays: { date: string; name: string }[], year?: number): void {
  if (year) {
    // Store in multi-year cache
    const yearCache = new Map<string, string>();
    holidays.forEach(holiday => {
      yearCache.set(holiday.date, holiday.name);
    });
    multiYearCache.set(year, yearCache);
  }
  
  // Also set as primary cache (for backward compatibility)
  publicHolidaysCache = new Map();
  holidays.forEach(holiday => {
    publicHolidaysCache!.set(holiday.date, holiday.name);
  });
  cachedYear = year || null;
}

/**
 * Load holidays for a specific year (async)
 * This function will be called from React components when needed
 */
export async function ensureHolidaysLoadedForYear(year: number): Promise<void> {
  // If already cached, return immediately
  if (multiYearCache.has(year)) {
    return;
  }
  
  // If already loading, wait for that promise
  if (loadingPromises.has(year)) {
    return loadingPromises.get(year)!;
  }
  
  // Start loading
  const loadPromise = (async () => {
    try {
      // Dynamic import to avoid circular dependency
      const { getDefaultPublicHolidaySet } = await import('../services/firebaseService');
      const defaultSet = await getDefaultPublicHolidaySet(year);
      
      if (defaultSet && defaultSet.holidays && Array.isArray(defaultSet.holidays)) {
        const holidays = defaultSet.holidays.map((h: any) => {
          if (typeof h === 'string') {
            return { date: h, name: 'Public Holiday' };
          }
          return h;
        });
        
        const yearCache = new Map<string, string>();
        holidays.forEach((holiday: { date: string; name: string }) => {
          if (!holiday.date || !holiday.date.match(/^\d{4}-\d{2}-\d{2}$/)) {
            return;
          }
          yearCache.set(holiday.date, holiday.name);
        });
        
        multiYearCache.set(year, yearCache);
        
        // If this is the current year, also update primary cache
        const currentYear = new Date().getFullYear();
        if (year === currentYear) {
          publicHolidaysCache = yearCache;
          cachedYear = year;
        }
      }
    } catch (error) {
      console.error(`Error loading holidays for year ${year}:`, error);
    } finally {
      loadingPromises.delete(year);
    }
  })();
  
  loadingPromises.set(year, loadPromise);
  return loadPromise;
}

/**
 * Convert a Date object to YYYY-MM-DD string without timezone issues
 */
function formatDateToYYYYMMDD(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get the year from a date string
 */
function getYearFromDate(dateString: string): number {
  const date = new Date(dateString);
  return date.getFullYear();
}

/**
 * Clear public holidays cache (fallback to hardcoded)
 */
export function clearPublicHolidaysCache(): void {
  publicHolidaysCache = null;
}

/**
 * Get day name from date string
 */
export function getDayName(dateString: string, useMalay: boolean = false): string {
  const date = new Date(dateString);
  const dayIndex = date.getDay();
  return useMalay ? DAY_NAMES_MALAY[dayIndex] : DAY_NAMES[dayIndex];
}

/**
 * Check if a date is a weekend (Saturday or Sunday)
 */
export function isWeekend(dateString: string, payGroup: string = '5'): boolean {
  const date = new Date(dateString);
  const day = date.getDay();
  if (day === 0) return true; // Sunday = 0
  if (day === 6) return payGroup !== '6'; // Saturday is working day for paygroup 6
  return false;
}

/**
 * Normalize date string to YYYY-MM-DD format
 */
function normalizeDateString(dateString: string): string | null {
  if (!dateString) return null;
  
  // If already in YYYY-MM-DD format, return as is
  if (dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
    return dateString;
  }
  
  // Try to parse and reformat
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    return null;
  }
  
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Check if a date is a public holiday
 * Uses Firebase cache if available and year matches, otherwise falls back to hardcoded holidays
 * Note: This is synchronous. For dates from years not yet loaded, call ensureHolidaysLoadedForYear() first.
 */
export function isPublicHoliday(dateString: string): boolean {
  // Normalize date string to ensure YYYY-MM-DD format
  const normalizedDate = normalizeDateString(dateString);
  if (!normalizedDate) {
    return false;
  }
  
  const dateYear = getYearFromDate(normalizedDate);
  
  // Check multi-year cache first
  const yearCache = multiYearCache.get(dateYear);
  if (yearCache) {
    return yearCache.has(normalizedDate);
  }
  
  // Check primary cache (backward compatibility)
  if (publicHolidaysCache && (cachedYear === null || cachedYear === dateYear)) {
    return publicHolidaysCache.has(normalizedDate);
  }
  
  // Fallback to hardcoded holidays (only for 2025)
  if (dateYear === 2025) {
    return MALAYSIAN_PUBLIC_HOLIDAYS_2025.includes(normalizedDate);
  }
  return false;
}

/**
 * Get public holiday name for a date
 * Returns the holiday name if it's a public holiday, null otherwise
 * Note: This is synchronous. For dates from years not yet loaded, call ensureHolidaysLoadedForYear() first.
 */
export function getPublicHolidayName(dateString: string): string | null {
  // Normalize date string to ensure YYYY-MM-DD format
  const normalizedDate = normalizeDateString(dateString);
  if (!normalizedDate) {
    return null;
  }
  
  const dateYear = getYearFromDate(normalizedDate);
  
  // Check multi-year cache first
  const yearCache = multiYearCache.get(dateYear);
  if (yearCache) {
    return yearCache.get(normalizedDate) || null;
  }
  
  // Check primary cache (backward compatibility)
  if (publicHolidaysCache && (cachedYear === null || cachedYear === dateYear)) {
    return publicHolidaysCache.get(normalizedDate) || null;
  }
  
  // Fallback: check if it's in hardcoded list (only for 2025)
  if (dateYear === 2025 && MALAYSIAN_PUBLIC_HOLIDAYS_2025.includes(normalizedDate)) {
    return 'Public Holiday'; // Default name for hardcoded holidays
  }
  return null;
}

/**
 * Check if a date should be excluded from leave calculations (weekend or public holiday)
 */
export function isExcludedDate(dateString: string, payGroup: string = '5'): boolean {
  return isWeekend(dateString, payGroup) || isPublicHoliday(dateString);
}

/** Maternity and paternity count every calendar day (weekends and public holidays included). */
export function leaveTypeUsesCalendarDays(leaveType: string | LeaveType): boolean {
  if (!leaveType) return false;
  if (leaveType === LeaveType.MATERNITY || leaveType === LeaveType.PATERNITY) return true;
  const normalized = String(leaveType).trim().toLowerCase();
  return normalized.includes('maternity') || normalized.includes('paternity');
}

/** Whether a date is skipped for display/aggregation for this leave type. */
export function shouldExcludeDateForLeave(
  leaveType: string | LeaveType,
  dateString: string,
  payGroup: string = '5'
): boolean {
  if (leaveTypeUsesCalendarDays(leaveType)) {
    return false;
  }
  return isExcludedDate(dateString, payGroup);
}

/**
 * Calculate calendar days between two dates (all days in range, including weekends and public holidays)
 */
export function getCalendarDaysBetween(
  startDate: string,
  endDate: string,
  startTime: 'AM' | 'PM',
  endTime: 'AM' | 'PM'
): number {
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (startDate === endDate) {
    if (startTime !== endTime) {
      return 1;
    }
    return 0.5;
  }

  let calendarDays = 0;
  const current = new Date(start);
  end.setDate(end.getDate() + 1);

  while (current < end) {
    const dateString = formatDateToYYYYMMDD(current);

    if (dateString === startDate && startTime === 'PM') {
      calendarDays += 0.5;
    } else if (dateString === endDate && endTime === 'AM') {
      calendarDays += 0.5;
    } else {
      calendarDays += 1;
    }

    current.setDate(current.getDate() + 1);
  }

  return calendarDays;
}

/** Leave days: calendar days for maternity/paternity, working days otherwise. */
export function getLeaveDaysBetween(
  startDate: string,
  endDate: string,
  startTime: 'AM' | 'PM',
  endTime: 'AM' | 'PM',
  payGroup: string = '5',
  leaveType?: string | LeaveType
): number {
  if (leaveType && leaveTypeUsesCalendarDays(leaveType)) {
    return getCalendarDaysBetween(startDate, endDate, startTime, endTime);
  }
  return getWorkingDaysBetween(startDate, endDate, startTime, endTime, payGroup);
}

/**
 * Calculate working days between two dates, excluding weekends and public holidays
 */
export function getWorkingDaysBetween(
  startDate: string, 
  endDate: string, 
  startTime: 'AM' | 'PM', 
  endTime: 'AM' | 'PM',
  payGroup: string = '5'
): number {
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  // If same day, check if it's a working day
  if (startDate === endDate) {
    if (isExcludedDate(startDate, payGroup)) {
      return 0;
    }
    // Same day with different times (AM to PM) = 1 working day
    if (startTime !== endTime) {
      return 1;
    }
    // Same day, same time = 0.5 working day
    return 0.5;
  }
  
  let workingDays = 0;
  const current = new Date(start);
  
  // Add 1 day to include the end date in the calculation
  end.setDate(end.getDate() + 1);
  
  while (current < end) {
    // Use formatDateToYYYYMMDD to avoid timezone issues
    const dateString = formatDateToYYYYMMDD(current);
    
    if (!isExcludedDate(dateString, payGroup)) {
      // First day: if starts PM, count as 0.5 day
      if (dateString === startDate && startTime === 'PM') {
        workingDays += 0.5;
      }
      // Last day: if ends AM, count as 0.5 day
      else if (dateString === endDate && endTime === 'AM') {
        workingDays += 0.5;
      }
      // Full working day
      else {
        workingDays += 1;
      }
    }
    
    current.setDate(current.getDate() + 1);
  }
  
  return workingDays;
}

/**
 * Get the next working day after a given date
 */
export function getNextWorkingDay(dateString: string, payGroup: string = '5'): { date: string; dayName: string } {
  const date = new Date(dateString);
  
  // Validate the date
  if (isNaN(date.getTime())) {
    console.error('Invalid date passed to getNextWorkingDay:', dateString);
    const fallbackDate = new Date();
    fallbackDate.setDate(fallbackDate.getDate() + 1);
    const fallbackDateString = fallbackDate.toISOString().split('T')[0];
    return {
      date: fallbackDateString,
      dayName: getDayName(fallbackDateString)
    };
  }
  
  date.setDate(date.getDate() + 1);
  
  while (isExcludedDate(date.toISOString().split('T')[0], payGroup)) {
    date.setDate(date.getDate() + 1);
  }
  
  const nextWorkingDate = date.toISOString().split('T')[0];
  return {
    date: nextWorkingDate,
    dayName: getDayName(nextWorkingDate)
  };
}

/**
 * Format date with day name
 */
export function formatDateWithDay(dateString: string, useMalay: boolean = false): string {
  const dayName = getDayName(dateString, useMalay);
  const date = new Date(dateString);
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  
  return `${dayName}, ${day}/${month}/${year}`;
}

function getNextCalendarDay(dateString: string): { date: string; dayName: string } {
  const date = new Date(dateString);
  if (isNaN(date.getTime())) {
    const fallbackDate = new Date();
    fallbackDate.setDate(fallbackDate.getDate() + 1);
    const fallbackDateString = formatDateToYYYYMMDD(fallbackDate);
    return {
      date: fallbackDateString,
      dayName: getDayName(fallbackDateString),
    };
  }
  date.setDate(date.getDate() + 1);
  const nextDate = formatDateToYYYYMMDD(date);
  return {
    date: nextDate,
    dayName: getDayName(nextDate),
  };
}

/**
 * Get return to work date with day name
 */
export function getReturnToWorkDateWithDay(
  endDate: string,
  endTime: 'AM' | 'PM',
  payGroup: string = '5',
  leaveType?: string | LeaveType
): {
  date: string;
  dayName: string;
  time: string;
} {
  // Validate the end date
  const testDate = new Date(endDate);
  if (isNaN(testDate.getTime())) {
    console.error('Invalid end date passed to getReturnToWorkDateWithDay:', endDate);
    const fallbackDate = new Date();
    const fallbackDateString = fallbackDate.toISOString().split('T')[0];
    return {
      date: fallbackDateString,
      dayName: getDayName(fallbackDateString),
      time: endTime === 'PM' ? 'AM' : 'PM',
    };
  }

  const useCalendar = leaveType && leaveTypeUsesCalendarDays(leaveType);

  if (endTime === 'PM') {
    const next = useCalendar ? getNextCalendarDay(endDate) : getNextWorkingDay(endDate, payGroup);
    return {
      date: next.date,
      dayName: next.dayName,
      time: 'AM',
    };
  }

  return {
    date: endDate,
    dayName: getDayName(endDate),
    time: 'PM',
  };
}
