import * as Notifications from "expo-notifications";
import { Platform } from "react-native";

export const FOLLOW_UP_CHANNEL = "follow-ups";

export async function configureFollowUpNotifications() {
  if (Platform.OS === "web") return false;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync(FOLLOW_UP_CHANNEL, {
      name: "Follow-up reminders",
      importance: Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 180, 120, 180],
      lightColor: "#0D6980",
    });
  }
  const permissions = await Notifications.getPermissionsAsync();
  if (permissions.status === "granted") return true;
  const requested = await Notifications.requestPermissionsAsync();
  return requested.status === "granted";
}

export async function scheduleFollowUpReminder(visit: { id: string; person: string }, delaySeconds = 60 * 60 * 24) {
  const enabled = await configureFollowUpNotifications();
  if (!enabled) return null;
  return Notifications.scheduleNotificationAsync({
    content: {
      title: "Follow-up reminder",
      body: `Remember ${visit.person}`,
      data: { visitId: visit.id },
      ...(Platform.OS === "android" ? { channelId: FOLLOW_UP_CHANNEL } : {}),
    },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL, seconds: Math.max(60, delaySeconds), repeats: false },
  });
}

export async function cancelFollowUpReminder(notificationId: string | null | undefined) {
  if (!notificationId || Platform.OS === "web") return;
  await Notifications.cancelScheduledNotificationAsync(notificationId);
}
