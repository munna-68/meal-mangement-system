export const DEFAULT_HOSTEL_NAME = "আল্লাহর দান ছাত্রাবাস-২";

export const DEFAULT_ADDRESS =
  "আলমপুর (চকবাজার) ক্যাডেট কলেজ, রংপুর সদর, রংপুর";

export interface MessSettingsData {
  hostelName: string;
  address: string;
  ramadanMode: boolean;
  soloElectricityMultiplier: number;
  soloWifiMultiplier: number;
}

export const FALLBACK_SETTINGS: MessSettingsData = {
  hostelName: DEFAULT_HOSTEL_NAME,
  address: DEFAULT_ADDRESS,
  ramadanMode: false,
  soloElectricityMultiplier: 2,
  soloWifiMultiplier: 1,
};

export const MEAL_STATUS_VALUES = [
  "FULL",
  "HALF_DAY",
  "HALF_NIGHT",
  "OFF",
] as const;

export const GUEST_MEAL_TYPE_VALUES = ["GUEST_FULL", "GUEST_HALF"] as const;

export const EXTRA_CATEGORY_VALUES = [
  "RECURRING_DAILY",
  "ONE_OFF",
  "MANAGER_FEE",
  "FEAST",
  "OTHER",
] as const;

export const UTILITY_TYPE_VALUES = ["ELECTRICITY", "WIFI"] as const;
