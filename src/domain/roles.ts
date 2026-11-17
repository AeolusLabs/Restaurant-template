export const APP_ROLES = ["owner", "manager", "kitchen", "customer"] as const;
export type AppRole = (typeof APP_ROLES)[number];

export const STAFF_ROLES = ["owner", "manager", "kitchen"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];
