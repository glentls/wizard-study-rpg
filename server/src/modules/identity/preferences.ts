import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');

/** Privacy, notification and accessibility preferences (ACC-03, AUTH-005, NFR-005). */
export const preferencesSchema = z.object({
  timezone: z.string().min(1).max(64),
  learningGoal: z.string().trim().max(120).nullable(),
  /** Optional, gentle daily goal. Missing it has no penalty (§12.5). */
  dailyGoalMinutes: z.number().int().min(10).max(240).nullable(),
  notifications: z.object({
    breakReminders: z.boolean(),
    sessionComplete: z.boolean(),
    quietHoursStart: hhmm.nullable(),
    quietHoursEnd: hhmm.nullable(),
  }),
  privacy: z.object({
    statsVisibility: z.enum(['private', 'friends']),
    analyticsOptIn: z.boolean(),
  }),
  accessibility: z.object({
    reducedMotion: z.boolean(),
    highContrast: z.boolean(),
    largeText: z.boolean(),
  }),
});

export type Preferences = z.infer<typeof preferencesSchema>;

export const preferencesPatchSchema = z
  .object({
    timezone: preferencesSchema.shape.timezone,
    learningGoal: preferencesSchema.shape.learningGoal,
    dailyGoalMinutes: preferencesSchema.shape.dailyGoalMinutes,
    notifications: preferencesSchema.shape.notifications.partial(),
    privacy: preferencesSchema.shape.privacy.partial(),
    accessibility: preferencesSchema.shape.accessibility.partial(),
  })
  .partial()
  .strict();

export const defaultPreferences = (timezone: string): Preferences => ({
  timezone,
  learningGoal: null,
  dailyGoalMinutes: null,
  notifications: { breakReminders: true, sessionComplete: true, quietHoursStart: null, quietHoursEnd: null },
  privacy: { statsVisibility: 'private', analyticsOptIn: false },
  accessibility: { reducedMotion: false, highContrast: false, largeText: false },
});

export function mergePreferences(current: Preferences, patch: z.infer<typeof preferencesPatchSchema>): Preferences {
  return preferencesSchema.parse({
    ...current,
    ...patch,
    notifications: { ...current.notifications, ...patch.notifications },
    privacy: { ...current.privacy, ...patch.privacy },
    accessibility: { ...current.accessibility, ...patch.accessibility },
  });
}
