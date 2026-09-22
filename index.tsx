import AsyncStorage from "@react-native-async-storage/async-storage";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import * as Location from "expo-location";
import * as Sharing from "expo-sharing";
import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  FlatList,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StatusBar,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "@/hooks/use-auth";
import { filterByQuery, formatDuration, formatMinutes, isWithinDays } from "@/lib/field-service-utils";
import { createBackupPayload, parseBackupPayload } from "@/lib/field-service-backup";
import { configureFollowUpNotifications, scheduleFollowUpReminder, cancelFollowUpReminder } from "@/lib/follow-up-reminders";
import type { Visit, VisitLocation } from "@/lib/field-service-types";
import { startOAuthLogin } from "@/constants/oauth";
import { trpc } from "@/lib/trpc";

const STORAGE_KEY = "field-service-manager-mobile-v2";
const TERRITORIES = ["Riara", "KHA", "KHB", "Jamuhuri", "Ngumo", "Fort Jesus", "Railway Houses", "Kenyatta Market", "Other"];

type Tab = "home" | "visits" | "returns" | "territories";
type StoredData = { visits: Visit[]; elapsedSeconds: number; startedAt: number | null; remindersEnabled: boolean };
type SyncRow = { clientId: string; person: string; territory: string; notes: string | null; needsFollowUp: boolean; latitude: number | null; longitude: number | null; createdAt: string | Date };

function shortDate(dateString: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(new Date(dateString));
}

function haptic(style: Haptics.ImpactFeedbackStyle = Haptics.ImpactFeedbackStyle.Light) {
  if (Platform.OS !== "web") void Haptics.impactAsync(style);
}

function ActionButton({ label, icon, onPress, variant = "primary" }: { label: string; icon: keyof typeof MaterialIcons.glyphMap; onPress: () => void; variant?: "primary" | "secondary" | "danger" }) {
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [styles.actionButton, variant === "primary" && styles.actionPrimary, variant === "secondary" && styles.actionSecondary, variant === "danger" && styles.actionDanger, pressed && styles.pressed]}><MaterialIcons name={icon} size={19} color={variant === "primary" || variant === "danger" ? "#FFFFFF" : "#0E3552"} /><Text style={[styles.actionLabel, variant !== "primary" && variant !== "danger" && styles.actionLabelDark]}>{label}</Text></Pressable>;
}

function EmptyState({ icon, title, body, actionLabel, onAction }: { icon: keyof typeof MaterialIcons.glyphMap; title: string; body: string; actionLabel: string; onAction: () => void }) {
  return <View style={styles.emptyState}><View style={styles.emptyIcon}><MaterialIcons name={icon} size={28} color="#247BA0" /></View><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyBody}>{body}</Text><Pressable onPress={onAction} style={({ pressed }) => [styles.outlineButton, pressed && styles.pressed]}><Text style={styles.outlineButtonText}>{actionLabel}</Text></Pressable></View>;
}

export default function FieldServiceManager() {
  const insets = useSafeAreaInsets();
  const { user, isAuthenticated, loading: authLoading } = useAuth();
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [visits, setVisits] = useState<Visit[]>([]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [remindersEnabled, setRemindersEnabled] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  const [visitModalOpen, setVisitModalOpen] = useState(false);
  const [recordName, setRecordName] = useState("");
  const [recordTerritory, setRecordTerritory] = useState(TERRITORIES[0]);
  const [recordNotes, setRecordNotes] = useState("");
  const [followUp, setFollowUp] = useState(false);
  const [pendingLocation, setPendingLocation] = useState<VisitLocation | null>(null);
  const [researchQuery, setResearchQuery] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [syncStatus, setSyncStatus] = useState("Local only");
  const [lastSyncAt, setLastSyncAt] = useState<Date | null>(null);
  const [remoteLoadedForUser, setRemoteLoadedForUser] = useState<number | null>(null);

  const syncedVisits = trpc.visits.list.useQuery(undefined, { enabled: isAuthenticated, retry: false });
  const syncMutation = trpc.visits.sync.useMutation();

  useEffect(() => {
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as Partial<StoredData>;
          setVisits(Array.isArray(saved.visits) ? saved.visits : []);
          setElapsedSeconds(Number.isFinite(saved.elapsedSeconds) ? saved.elapsedSeconds! : 0);
          setStartedAt(typeof saved.startedAt === "number" ? saved.startedAt : null);
          setRemindersEnabled(saved.remindersEnabled !== false);
        }
      } catch {
        Alert.alert("Local storage unavailable", "New records will still work for this session, but may not be saved after the app closes.");
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ visits, elapsedSeconds, startedAt, remindersEnabled }));
  }, [elapsedSeconds, hydrated, remindersEnabled, startedAt, visits]);

  useEffect(() => {
    if (startedAt === null) return;
    const timer = setInterval(() => setElapsedSeconds((stored) => Math.max(stored, Math.floor((Date.now() - startedAt) / 1000))), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);

  useEffect(() => {
    if (!hydrated || !user || remoteLoadedForUser === user.id || syncedVisits.isFetching || !syncedVisits.data) return;
    const remote = (syncedVisits.data as SyncRow[]).map((row) => ({ id: row.clientId, person: row.person, territory: row.territory, notes: row.notes ?? "", needsFollowUp: row.needsFollowUp, createdAt: new Date(row.createdAt).toISOString(), location: row.latitude !== null && row.longitude !== null ? { latitude: row.latitude, longitude: row.longitude } : undefined }));
    setVisits((current) => {
      const merged = new Map<string, Visit>();
      [...remote, ...current].forEach((visit) => merged.set(visit.id, visit));
      return Array.from(merged.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    });
    setRemoteLoadedForUser(user.id);
    setSyncStatus(remote.length ? "Cloud records loaded" : "Cloud sync ready");
  }, [hydrated, remoteLoadedForUser, syncedVisits.data, syncedVisits.isFetching, user]);

  useEffect(() => {
    if (Platform.OS !== "web") void configureFollowUpNotifications();
  }, []);

  const totalSeconds = startedAt === null ? elapsedSeconds : Math.max(elapsedSeconds, Math.floor((Date.now() - startedAt) / 1000));
  const returnVisits = useMemo(() => visits.filter((visit) => visit.needsFollowUp), [visits]);
  const weekVisits = useMemo(() => visits.filter((visit) => isWithinDays(visit.createdAt, 7)), [visits]);
  const filteredVisits = useMemo(() => filterByQuery(visits, searchQuery, ["person", "territory", "notes"]), [searchQuery, visits]);

  function toggleTimer() {
    haptic(Haptics.ImpactFeedbackStyle.Medium);
    if (startedAt === null) setStartedAt(Date.now());
    else { setElapsedSeconds(totalSeconds); setStartedAt(null); }
  }

  function resetTimer() {
    Alert.alert("Reset today’s clock?", "This removes the current timed session from this device.", [{ text: "Cancel", style: "cancel" }, { text: "Reset", style: "destructive", onPress: () => { setElapsedSeconds(0); setStartedAt(null); haptic(Haptics.ImpactFeedbackStyle.Medium); } }]);
  }

  function openVisitModal() {
    setRecordName(""); setRecordTerritory(TERRITORIES[0]); setRecordNotes(""); setFollowUp(false); setPendingLocation(null); setVisitModalOpen(true);
  }

  async function captureLocation() {
    try {
      if (Platform.OS === "web" && !navigator.geolocation) throw new Error("Location is not available in this browser.");
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== "granted") throw new Error("Location permission was not granted.");
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setPendingLocation({ latitude: current.coords.latitude, longitude: current.coords.longitude });
      haptic(Haptics.ImpactFeedbackStyle.Medium);
    } catch (error) {
      Alert.alert("Could not capture location", error instanceof Error ? error.message : "Check that Location is enabled and try again.");
    }
  }

  async function saveVisit() {
    const person = recordName.trim();
    if (!person) { Alert.alert("Add a name or reference", "Use a person, household, or location reference so this visit is easy to find later."); return; }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    const notificationId = followUp && remindersEnabled ? await scheduleFollowUpReminder({ id, person }) : undefined;
    const visit: Visit = { id, person, territory: recordTerritory, notes: recordNotes.trim(), needsFollowUp: followUp, createdAt: new Date().toISOString(), location: pendingLocation ?? undefined, notificationId: notificationId ?? undefined };
    setVisits((current) => [visit, ...current]); setVisitModalOpen(false); haptic(Haptics.ImpactFeedbackStyle.Medium);
  }

  async function toggleFollowUp(visit: Visit) {
    const nextValue = !visit.needsFollowUp;
    if (!nextValue) await cancelFollowUpReminder(visit.notificationId);
    const notificationId = nextValue && remindersEnabled ? await scheduleFollowUpReminder({ id: visit.id, person: visit.person }) : undefined;
    setVisits((current) => current.map((item) => item.id === visit.id ? { ...item, needsFollowUp: nextValue, notificationId } : item));
    haptic();
  }

  function openTerritory(territory: string) {
    haptic(); void Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${territory} Nairobi`)}`);
  }

  function openVisitLocation(visit: Visit) {
    if (!visit.location) return;
    haptic();
    const { latitude, longitude } = visit.location;
    void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${latitude},${longitude}&travelmode=walking`);
  }

  function openResearch() {
    const query = researchQuery.trim();
    haptic(); void Linking.openURL(query ? `https://www.jw.org/en/search/?q=${encodeURIComponent(query)}` : "https://www.jw.org/en/library/");
  }

  async function syncNow() {
    if (!isAuthenticated) { Alert.alert("Sign in to sync", "Sign in with your account to keep these records available on another phone.", [{ text: "Not now", style: "cancel" }, { text: "Sign in", onPress: () => void startOAuthLogin() }]); return; }
    try {
      setSyncStatus("Syncing…");
      await syncMutation.mutateAsync({ visits: visits.map((visit) => ({ clientId: visit.id, person: visit.person, territory: visit.territory, notes: visit.notes || null, needsFollowUp: visit.needsFollowUp, latitude: visit.location?.latitude ?? null, longitude: visit.location?.longitude ?? null, createdAt: visit.createdAt })) });
      setLastSyncAt(new Date()); setSyncStatus("Synced just now"); await syncedVisits.refetch();
    } catch { setSyncStatus("Sync failed — local copy is safe"); Alert.alert("Sync unavailable", "Your local records are safe. Check your connection and try again."); }
  }

  async function exportBackup() {
    try {
      if (!FileSystem.documentDirectory) throw new Error("Device file storage is not available.");
      const uri = `${FileSystem.documentDirectory}field-service-manager-${new Date().toISOString().slice(0, 10)}.json`;
      await FileSystem.writeAsStringAsync(uri, JSON.stringify(createBackupPayload(visits, totalSeconds)), { encoding: FileSystem.EncodingType.UTF8 });
      if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/json", dialogTitle: "Export Field Service Manager backup" });
      else Alert.alert("Backup created", "Sharing is unavailable on this device, but the backup file was created in app storage.");
    } catch (error) { Alert.alert("Backup failed", error instanceof Error ? error.message : "Please try again."); }
  }

  async function restoreBackup() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: "application/json", copyToCacheDirectory: true });
      if (result.canceled) return;
      const raw = await FileSystem.readAsStringAsync(result.assets[0].uri, { encoding: FileSystem.EncodingType.UTF8 });
      const backup = parseBackupPayload(JSON.parse(raw));
      Alert.alert("Restore this backup?", `${backup.visits.length} visit records will be merged with the records already on this device.`, [{ text: "Cancel", style: "cancel" }, { text: "Merge", onPress: () => { setVisits((current) => { const merged = new Map<string, Visit>(); [...current, ...backup.visits].forEach((visit) => merged.set(visit.id, visit)); return Array.from(merged.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }); setElapsedSeconds((current) => Math.max(current, backup.elapsedSeconds)); Alert.alert("Backup restored", "Your visit records are available again on this device."); } }]);
    } catch (error) { Alert.alert("Restore failed", error instanceof Error ? error.message : "Choose a Field Service Manager JSON backup."); }
  }

  function clearDeviceData() {
    Alert.alert("Clear all local records?", "Your visits, return queue, and current clock will be removed from this device. This cannot be undone.", [{ text: "Cancel", style: "cancel" }, { text: "Clear data", style: "destructive", onPress: () => { setVisits([]); setElapsedSeconds(0); setStartedAt(null); haptic(Haptics.ImpactFeedbackStyle.Medium); } }]);
  }

  const renderVisit = ({ item }: { item: Visit }) => <View style={styles.visitCard}><View style={styles.visitAvatar}><Text style={styles.visitInitial}>{item.person.slice(0, 1).toUpperCase()}</Text></View><View style={styles.visitContent}><View style={styles.visitTopRow}><Text style={styles.visitName} numberOfLines={1}>{item.person}</Text><Text style={styles.visitDate}>{shortDate(item.createdAt)}</Text></View><Text style={styles.visitTerritory}><MaterialIcons name="place" size={13} color="#247BA0" /> {item.territory}</Text>{item.notes ? <Text style={styles.visitNotes} numberOfLines={2}>{item.notes}</Text> : null}<View style={styles.visitActions}>{item.needsFollowUp ? <View style={styles.followUpBadge}><MaterialIcons name="event-repeat" size={13} color="#906C00" /><Text style={styles.followUpText}>Follow-up planned</Text></View> : null}{item.location ? <Pressable onPress={() => openVisitLocation(item)} style={({ pressed }) => [styles.mapButton, pressed && styles.pressed]}><MaterialIcons name="directions-walk" size={14} color="#0D6980" /><Text style={styles.mapButtonText}>Navigate</Text></Pressable> : null}</View></View></View>;

  function renderHome() {
    return <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}><View style={styles.heroRow}><View><Text style={styles.kicker}>FIELD SERVICE MANAGER</Text><Text style={styles.pageTitle}>Ready for today?</Text><Text style={styles.pageSubtitle}>{isAuthenticated ? `Synced account: ${user?.name || user?.email || "connected"}` : "Private records stored on this device."}</Text></View><View style={styles.shield}><MaterialIcons name={isAuthenticated ? "cloud-done" : "shield"} size={22} color="#FFFFFF" /></View></View><View style={styles.clockCard}><View style={styles.clockHeader}><View style={styles.clockLabel}><MaterialIcons name="schedule" size={16} color="#7CE0D4" /><Text style={styles.clockLabelText}>TODAY’S MINISTRY CLOCK</Text></View><View style={[styles.livePill, startedAt !== null && styles.livePillActive]}><View style={[styles.liveDot, startedAt !== null && styles.liveDotActive]} /><Text style={styles.liveText}>{startedAt === null ? "PAUSED" : "LIVE"}</Text></View></View><Text style={styles.clockValue}>{formatDuration(totalSeconds)}</Text><View style={styles.clockActions}><ActionButton label={startedAt === null ? "Start clock" : "Pause clock"} icon={startedAt === null ? "play-arrow" : "pause"} onPress={toggleTimer} /><Pressable onPress={resetTimer} style={({ pressed }) => [styles.resetButton, pressed && styles.pressed]} accessibilityLabel="Reset timer"><MaterialIcons name="restart-alt" size={20} color="#D2EBFF" /></Pressable></View></View><View style={styles.metricsRow}><View style={styles.metricCard}><Text style={styles.metricLabel}>THIS WEEK</Text><Text style={styles.metricNumber}>{weekVisits.length}</Text><Text style={styles.metricCaption}>visits logged</Text></View><View style={styles.metricCard}><Text style={styles.metricLabel}>TIME</Text><Text style={styles.metricNumber}>{formatMinutes(totalSeconds).replace(" min", "")}</Text><Text style={styles.metricCaption}>minutes today</Text></View><View style={styles.metricCard}><Text style={styles.metricLabel}>RETURNS</Text><Text style={styles.metricNumber}>{returnVisits.length}</Text><Text style={styles.metricCaption}>to follow up</Text></View></View><View style={styles.sectionHeader}><View><Text style={styles.sectionTitle}>Quick capture</Text><Text style={styles.sectionSubtitle}>Keep the moment, not the paperwork.</Text></View></View><View style={styles.quickActionsRow}><Pressable onPress={openVisitModal} style={({ pressed }) => [styles.quickAction, styles.quickActionTeal, pressed && styles.pressed]}><View style={styles.quickIcon}><MaterialIcons name="add-location-alt" size={22} color="#0E3552" /></View><Text style={styles.quickActionTitle}>Log a visit</Text><Text style={styles.quickActionBody}>Name, territory, pin, notes</Text></Pressable><Pressable onPress={() => setActiveTab("returns")} style={({ pressed }) => [styles.quickAction, styles.quickActionGold, pressed && styles.pressed]}><View style={[styles.quickIcon, styles.quickIconGold]}><MaterialIcons name="event-repeat" size={22} color="#6B4B00" /></View><Text style={styles.quickActionTitle}>Follow-ups</Text><Text style={styles.quickActionBody}>{returnVisits.length ? `${returnVisits.length} waiting for you` : "Nothing queued yet"}</Text></Pressable></View><View style={styles.sectionHeader}><View><Text style={styles.sectionTitle}>Territories</Text><Text style={styles.sectionSubtitle}>Open the next area directly in Maps.</Text></View><Pressable onPress={() => setActiveTab("territories")}><Text style={styles.textLink}>See all</Text></Pressable></View><FlatList horizontal data={TERRITORIES.slice(0, 6)} keyExtractor={(item) => item} contentContainerStyle={styles.horizontalList} showsHorizontalScrollIndicator={false} renderItem={({ item }) => <Pressable onPress={() => openTerritory(item)} style={({ pressed }) => [styles.territoryChip, pressed && styles.pressed]}><MaterialIcons name="near-me" size={15} color="#247BA0" /><Text style={styles.territoryChipText}>{item}</Text></Pressable>} /><View style={[styles.sectionHeader, styles.researchHeader]}><View><Text style={styles.sectionTitle}>Topic research</Text><Text style={styles.sectionSubtitle}>Search the official JW.ORG Library.</Text></View></View><View style={styles.searchBox}><MaterialIcons name="search" size={20} color="#6D7D8A" /><TextInput value={researchQuery} onChangeText={setResearchQuery} placeholder="Subject, verse, article…" placeholderTextColor="#8896A2" style={styles.searchInput} returnKeyType="search" onSubmitEditing={openResearch} /><Pressable onPress={openResearch} style={({ pressed }) => [styles.searchGo, pressed && styles.pressed]}><MaterialIcons name="open-in-new" size={18} color="#FFFFFF" /></Pressable></View><Text style={styles.researchNote}>Opens JW.ORG in your browser. Search terms are not stored by this app.</Text></ScrollView>;
  }

  function renderVisits() {
    return <View style={styles.tabPage}><View style={styles.listPageHeader}><View><Text style={styles.pageTitle}>Visits</Text><Text style={styles.pageSubtitle}>Search calls, pins, and notes.</Text></View><Pressable onPress={openVisitModal} style={({ pressed }) => [styles.roundAdd, pressed && styles.pressed]}><MaterialIcons name="add" size={25} color="#FFFFFF" /></Pressable></View><View style={styles.searchListBox}><MaterialIcons name="search" size={19} color="#6D7D8A" /><TextInput value={searchQuery} onChangeText={setSearchQuery} placeholder="Search people, places, notes…" placeholderTextColor="#8896A2" style={styles.searchInput} /></View><FlatList data={filteredVisits} keyExtractor={(item) => item.id} renderItem={renderVisit} contentContainerStyle={filteredVisits.length ? styles.listContent : styles.emptyListContent} showsVerticalScrollIndicator={false} ListEmptyComponent={<EmptyState icon="fact-check" title={searchQuery ? "No matching visits" : "No visits recorded"} body={searchQuery ? "Try a different search term." : "Capture a visit in a few seconds and it will stay available offline."} actionLabel={searchQuery ? "Clear search" : "Log a visit"} onAction={() => searchQuery ? setSearchQuery("") : openVisitModal()} />} /></View>;
  }

  function renderReturns() {
    return <View style={styles.tabPage}><View style={styles.listPageHeader}><View><Text style={styles.pageTitle}>Follow-ups</Text><Text style={styles.pageSubtitle}>Your return-visit queue, always in reach.</Text></View><View style={styles.countPill}><Text style={styles.countPillText}>{returnVisits.length}</Text></View></View><FlatList data={returnVisits} keyExtractor={(item) => item.id} contentContainerStyle={returnVisits.length ? styles.listContent : styles.emptyListContent} showsVerticalScrollIndicator={false} renderItem={({ item }) => <View style={styles.returnCard}><View style={styles.returnCardMain}><View style={styles.returnIcon}><MaterialIcons name="event-repeat" size={21} color="#8E6900" /></View><View style={styles.returnText}><Text style={styles.visitName}>{item.person}</Text><Text style={styles.visitTerritory}><MaterialIcons name="place" size={13} color="#247BA0" /> {item.territory}</Text>{item.notes ? <Text style={styles.visitNotes} numberOfLines={2}>{item.notes}</Text> : <Text style={styles.mutedLine}>Logged {shortDate(item.createdAt)}</Text>}</View></View><View style={styles.returnActions}>{item.location ? <Pressable onPress={() => openVisitLocation(item)} style={({ pressed }) => [styles.mapButton, pressed && styles.pressed]}><MaterialIcons name="directions-walk" size={14} color="#0D6980" /><Text style={styles.mapButtonText}>Navigate</Text></Pressable> : null}<Pressable onPress={() => void toggleFollowUp(item)} style={({ pressed }) => [styles.doneButton, pressed && styles.pressed]}><MaterialIcons name="check" size={18} color="#0F664D" /><Text style={styles.doneText}>Done</Text></Pressable></View></View>} ListEmptyComponent={<EmptyState icon="event-available" title="Your queue is clear" body="When you log a visit, turn on “Follow up” to keep it here." actionLabel="Log a visit" onAction={openVisitModal} />} /></View>;
  }

  function renderTerritories() {
    return <View style={styles.tabPage}><View style={styles.listPageHeader}><View><Text style={styles.pageTitle}>Territories</Text><Text style={styles.pageSubtitle}>Areas, sync, and device tools.</Text></View></View><View style={styles.mapsNotice}><MaterialIcons name="directions-walk" size={21} color="#1F647D" /><Text style={styles.mapsNoticeText}>Saved visit pins open walking directions from wherever you are. Territory buttons open an area search.</Text></View><FlatList data={TERRITORIES} keyExtractor={(item) => item} contentContainerStyle={styles.listContent} renderItem={({ item, index }) => <Pressable onPress={() => openTerritory(item)} style={({ pressed }) => [styles.territoryCard, pressed && styles.pressed]}><View style={[styles.territoryNumber, index % 2 === 1 && styles.territoryNumberAlt]}><Text style={styles.territoryNumberText}>{String(index + 1).padStart(2, "0")}</Text></View><View style={styles.territoryCardText}><Text style={styles.territoryName}>{item}</Text><Text style={styles.territoryHint}>Open in Google Maps</Text></View><MaterialIcons name="arrow-forward" size={21} color="#247BA0" /></Pressable>} showsVerticalScrollIndicator={false} ListFooterComponent={<View style={styles.toolsPanel}><View style={styles.toolsTitleRow}><MaterialIcons name="settings-backup-restore" size={19} color="#0F664D" /><Text style={styles.toolsTitle}>Data tools</Text></View><Text style={styles.toolsBody}>Backups work offline. Sync keeps this device and your signed-in phone together.</Text><View style={styles.toolRow}><ActionButton label="Export backup" icon="ios-share" onPress={() => void exportBackup()} variant="secondary" /><ActionButton label="Restore" icon="file-upload" onPress={() => void restoreBackup()} variant="secondary" /></View><View style={styles.syncRow}><View style={styles.syncStatusIcon}><MaterialIcons name={isAuthenticated ? "cloud-done" : "cloud-off"} size={19} color={isAuthenticated ? "#0F664D" : "#7B8B96"} /></View><View style={styles.syncText}><Text style={styles.syncTitle}>{authLoading ? "Checking account…" : isAuthenticated ? "Cloud sync connected" : "Cloud sync is optional"}</Text><Text style={styles.syncBody}>{lastSyncAt ? `Last synced ${lastSyncAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : syncStatus}</Text></View><Pressable onPress={() => void syncNow()} style={({ pressed }) => [styles.syncButton, pressed && styles.pressed]}><Text style={styles.syncButtonText}>{isAuthenticated ? "Sync now" : "Sign in"}</Text></Pressable></View><View style={styles.reminderRow}><View style={styles.syncStatusIcon}><MaterialIcons name="notifications-active" size={19} color="#8E6900" /></View><View style={styles.syncText}><Text style={styles.syncTitle}>Follow-up reminders</Text><Text style={styles.syncBody}>Remind me one day after logging a follow-up</Text></View><Switch value={remindersEnabled} onValueChange={(value) => { setRemindersEnabled(value); haptic(Haptics.ImpactFeedbackStyle.Medium); }} trackColor={{ false: "#D6DFE5", true: "#7BC8C0" }} thumbColor={remindersEnabled ? "#0D6980" : "#FFFFFF"} /></View><Pressable onPress={clearDeviceData}><Text style={styles.clearText}>Clear local data</Text></Pressable></View>} /></View>;
  }

  const tabContent = activeTab === "home" ? renderHome() : activeTab === "visits" ? renderVisits() : activeTab === "returns" ? renderReturns() : renderTerritories();

  return <View style={styles.safeArea}><StatusBar barStyle="dark-content" backgroundColor="#F6F8FA" /><View style={styles.appShell}>{hydrated ? tabContent : <View style={styles.loading}><MaterialIcons name="location-searching" size={30} color="#247BA0" /><Text style={styles.loadingText}>Preparing your private workspace…</Text></View>}</View><View style={[styles.bottomNav, { paddingBottom: Math.max(insets.bottom, Platform.OS === "ios" ? 8 : 7) }]}>{([["home", "Home", "home"], ["visits", "Visits", "format-list-bulleted"], ["returns", "Follow-up", "event-repeat"], ["territories", "Areas", "map"]] as const).map(([tab, label, icon]) => <Pressable key={tab} onPress={() => { haptic(); setActiveTab(tab); }} style={({ pressed }) => [styles.navItem, activeTab === tab && styles.navItemActive, pressed && styles.pressed]}><MaterialIcons name={icon} size={21} color={activeTab === tab ? "#0D6980" : "#748390"} /><Text style={[styles.navLabel, activeTab === tab && styles.navLabelActive]}>{label}</Text></Pressable>)}</View><Modal visible={visitModalOpen} animationType="slide" presentationStyle="pageSheet" onRequestClose={() => setVisitModalOpen(false)}><View style={styles.modalSafeArea}><View style={styles.modalHeader}><Pressable onPress={() => setVisitModalOpen(false)} style={({ pressed }) => [styles.modalClose, pressed && styles.pressed]}><MaterialIcons name="close" size={22} color="#294354" /></Pressable><Text style={styles.modalTitle}>Log a visit</Text><View style={styles.modalHeaderSpacer} /></View><ScrollView contentContainerStyle={styles.modalContent} keyboardShouldPersistTaps="handled"><View style={styles.modalIntro}><View style={styles.modalIntroIcon}><MaterialIcons name="edit-location-alt" size={24} color="#0D6980" /></View><View><Text style={styles.modalIntroTitle}>Keep it concise</Text><Text style={styles.modalIntroBody}>The essentials are enough to make the next visit easier.</Text></View></View><Text style={styles.fieldLabel}>NAME OR REFERENCE</Text><TextInput autoFocus value={recordName} onChangeText={setRecordName} placeholder="Person, household, or location" placeholderTextColor="#8896A2" style={styles.textField} returnKeyType="next" /><Text style={styles.fieldLabel}>TERRITORY</Text><FlatList horizontal data={TERRITORIES} keyExtractor={(item) => item} contentContainerStyle={styles.territorySelector} showsHorizontalScrollIndicator={false} renderItem={({ item }) => <Pressable onPress={() => { haptic(); setRecordTerritory(item); }} style={({ pressed }) => [styles.selectorChip, recordTerritory === item && styles.selectorChipActive, pressed && styles.pressed]}><Text style={[styles.selectorChipText, recordTerritory === item && styles.selectorChipTextActive]}>{item}</Text></Pressable>} /><Pressable onPress={() => void captureLocation()} style={({ pressed }) => [styles.locationCapture, pendingLocation && styles.locationCaptureActive, pressed && styles.pressed]}><MaterialIcons name={pendingLocation ? "location-on" : "my-location"} size={21} color={pendingLocation ? "#0F664D" : "#0D6980"} /><View style={styles.locationCaptureText}><Text style={styles.locationCaptureTitle}>{pendingLocation ? "Location pin captured" : "Drop a pin at your current location"}</Text><Text style={styles.locationCaptureBody}>{pendingLocation ? `${pendingLocation.latitude.toFixed(5)}, ${pendingLocation.longitude.toFixed(5)} · walking directions will be available` : "Optional · asks for location permission once"}</Text></View><MaterialIcons name={pendingLocation ? "check" : "arrow-forward"} size={19} color={pendingLocation ? "#0F664D" : "#0D6980"} /></Pressable><Text style={styles.fieldLabel}>NOTES <Text style={styles.optionalLabel}>OPTIONAL</Text></Text><TextInput value={recordNotes} onChangeText={setRecordNotes} placeholder="Interest, literature, or a reminder for next time" placeholderTextColor="#8896A2" multiline textAlignVertical="top" style={[styles.textField, styles.notesField]} /><View style={styles.followUpSwitch}><View style={styles.switchIcon}><MaterialIcons name="event-repeat" size={21} color="#8E6900" /></View><View style={styles.switchText}><Text style={styles.switchTitle}>Add to follow-ups</Text><Text style={styles.switchBody}>{remindersEnabled ? "Adds a local reminder for tomorrow." : "Keeps this visit in your active return queue."}</Text></View><Switch value={followUp} onValueChange={(value) => { haptic(Haptics.ImpactFeedbackStyle.Medium); setFollowUp(value); }} trackColor={{ false: "#D6DFE5", true: "#7BC8C0" }} thumbColor={followUp ? "#0D6980" : "#FFFFFF"} /></View><Pressable onPress={() => void saveVisit()} style={({ pressed }) => [styles.saveButton, pressed && styles.pressed]}><MaterialIcons name="check-circle" size={20} color="#FFFFFF" /><Text style={styles.saveButtonText}>Save visit</Text></Pressable></ScrollView></View></Modal></View>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#F6F8FA" }, appShell: { flex: 1, minHeight: 0, backgroundColor: "#F6F8FA" }, scrollContent: { padding: 20, paddingBottom: 28 }, tabPage: { flex: 1, minHeight: 0, paddingHorizontal: 20, paddingTop: 18 }, heroRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }, kicker: { color: "#297A8C", fontWeight: "800", fontSize: 11, letterSpacing: 1.35, marginBottom: 6 }, pageTitle: { color: "#112B3C", fontSize: 27, lineHeight: 33, fontWeight: "800", letterSpacing: -0.5 }, pageSubtitle: { color: "#6A7B88", fontSize: 14, lineHeight: 20, marginTop: 3 }, shield: { width: 44, height: 44, borderRadius: 15, backgroundColor: "#0F3553", alignItems: "center", justifyContent: "center", shadowColor: "#0F3553", shadowOpacity: 0.18, shadowRadius: 9, shadowOffset: { width: 0, height: 4 }, elevation: 3 }, clockCard: { backgroundColor: "#0D2D49", borderRadius: 23, padding: 20, shadowColor: "#0D2D49", shadowOpacity: 0.22, shadowRadius: 13, shadowOffset: { width: 0, height: 7 }, elevation: 4 }, clockHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" }, clockLabel: { flexDirection: "row", alignItems: "center", gap: 6 }, clockLabelText: { color: "#B7D7E6", fontSize: 10, fontWeight: "800", letterSpacing: 1.05 }, livePill: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#20445E", paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999 }, livePillActive: { backgroundColor: "#144F59" }, liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#9FB2BF" }, liveDotActive: { backgroundColor: "#7CE0D4" }, liveText: { color: "#DCEBF3", fontSize: 10, fontWeight: "800", letterSpacing: 0.7 }, clockValue: { color: "#FFFFFF", fontSize: 42, letterSpacing: 1.1, fontWeight: "800", marginTop: 15, fontVariant: ["tabular-nums"] }, clockActions: { flexDirection: "row", gap: 10, marginTop: 17 }, actionButton: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7, minHeight: 46, borderRadius: 14, paddingHorizontal: 15, flex: 1 }, actionPrimary: { backgroundColor: "#62D2C5" }, actionSecondary: { backgroundColor: "#E7F1F5" }, actionDanger: { backgroundColor: "#C34D4D" }, actionLabel: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" }, actionLabelDark: { color: "#0E3552" }, resetButton: { width: 47, borderRadius: 14, alignItems: "center", justifyContent: "center", backgroundColor: "#21455F" }, pressed: { opacity: 0.76, transform: [{ scale: 0.98 }] }, metricsRow: { flexDirection: "row", gap: 9, marginTop: 14 }, metricCard: { flex: 1, backgroundColor: "#FFFFFF", borderRadius: 16, padding: 12, borderWidth: 1, borderColor: "#E4EAEE", minHeight: 101 }, metricLabel: { color: "#7B8B96", fontSize: 9, fontWeight: "800", letterSpacing: 0.9 }, metricNumber: { color: "#163849", fontSize: 23, lineHeight: 27, fontWeight: "800", marginTop: 10 }, metricCaption: { color: "#7B8B96", fontSize: 11, marginTop: 2 }, sectionHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", marginTop: 25, marginBottom: 11 }, sectionTitle: { color: "#183649", fontSize: 18, lineHeight: 23, fontWeight: "800" }, sectionSubtitle: { color: "#71818D", fontSize: 12, lineHeight: 17, marginTop: 1 }, textLink: { color: "#0D6980", fontSize: 13, fontWeight: "800" }, quickActionsRow: { flexDirection: "row", gap: 10 }, quickAction: { flex: 1, minHeight: 149, borderRadius: 18, padding: 15, justifyContent: "flex-end", borderWidth: 1 }, quickActionTeal: { backgroundColor: "#E7F7F5", borderColor: "#C8ECE7" }, quickActionGold: { backgroundColor: "#FFF7E1", borderColor: "#F6E6B8" }, quickIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: "#BDECE5", alignItems: "center", justifyContent: "center", marginBottom: "auto" }, quickIconGold: { backgroundColor: "#FFE9A5" }, quickActionTitle: { color: "#17374B", fontSize: 15, fontWeight: "800" }, quickActionBody: { color: "#647985", fontSize: 11, lineHeight: 15, marginTop: 4 }, horizontalList: { gap: 8, paddingRight: 20 }, territoryChip: { flexDirection: "row", alignItems: "center", gap: 5, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 13, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DDE7EB" }, territoryChipText: { color: "#294554", fontSize: 13, fontWeight: "700" }, researchHeader: { marginTop: 27 }, searchBox: { flexDirection: "row", alignItems: "center", minHeight: 52, backgroundColor: "#FFFFFF", borderRadius: 15, borderWidth: 1, borderColor: "#DDE7EB", paddingLeft: 14, gap: 8 }, searchInput: { flex: 1, color: "#183649", fontSize: 14, paddingVertical: 12, minWidth: 0 }, searchGo: { width: 42, alignSelf: "stretch", alignItems: "center", justifyContent: "center", backgroundColor: "#0D6980", borderRadius: 14 }, researchNote: { color: "#81909A", fontSize: 11, lineHeight: 16, marginTop: 8 }, bottomNav: { flexDirection: "row", flexShrink: 0, zIndex: 20, elevation: 8, backgroundColor: "#FFFFFF", paddingTop: 6, borderTopWidth: 1, borderTopColor: "#E1E8EC" }, navItem: { flex: 1, alignItems: "center", justifyContent: "center", gap: 2, minHeight: 52, borderRadius: 12, marginHorizontal: 2 }, navItemActive: { backgroundColor: "#EAF6F7" }, navLabel: { color: "#748390", fontSize: 10, fontWeight: "700" }, navLabelActive: { color: "#0D6980", fontWeight: "800" }, listPageHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 17 }, roundAdd: { width: 47, height: 47, borderRadius: 16, backgroundColor: "#0D6980", alignItems: "center", justifyContent: "center", shadowColor: "#0D6980", shadowOpacity: 0.18, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 }, searchListBox: { flexDirection: "row", alignItems: "center", minHeight: 49, backgroundColor: "#FFFFFF", borderRadius: 14, borderWidth: 1, borderColor: "#DDE7EB", paddingHorizontal: 13, gap: 8, marginBottom: 13 }, listContent: { paddingBottom: 20, gap: 10 }, emptyListContent: { flexGrow: 1, justifyContent: "center", paddingBottom: 30 }, emptyState: { alignItems: "center", paddingHorizontal: 23 }, emptyIcon: { width: 61, height: 61, borderRadius: 21, backgroundColor: "#E5F4F6", alignItems: "center", justifyContent: "center", marginBottom: 14 }, emptyTitle: { color: "#183649", fontSize: 19, fontWeight: "800" }, emptyBody: { color: "#71818D", fontSize: 14, lineHeight: 20, textAlign: "center", marginTop: 7, maxWidth: 290 }, outlineButton: { borderWidth: 1.5, borderColor: "#0D6980", borderRadius: 13, paddingHorizontal: 16, paddingVertical: 11, marginTop: 17 }, outlineButtonText: { color: "#0D6980", fontWeight: "800", fontSize: 14 }, visitCard: { flexDirection: "row", gap: 12, backgroundColor: "#FFFFFF", borderRadius: 17, padding: 13, borderWidth: 1, borderColor: "#E3EAED" }, visitAvatar: { width: 40, height: 40, borderRadius: 14, backgroundColor: "#DDF0F2", alignItems: "center", justifyContent: "center" }, visitInitial: { color: "#0D6980", fontWeight: "800", fontSize: 16 }, visitContent: { flex: 1, minWidth: 0 }, visitTopRow: { flexDirection: "row", alignItems: "center", gap: 8 }, visitName: { flex: 1, color: "#183649", fontSize: 15, lineHeight: 20, fontWeight: "800" }, visitDate: { color: "#81909A", fontSize: 11 }, visitTerritory: { color: "#397086", fontSize: 12, lineHeight: 18, marginTop: 1 }, visitNotes: { color: "#697C87", fontSize: 12, lineHeight: 17, marginTop: 4 }, visitActions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 7 }, followUpBadge: { alignSelf: "flex-start", flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#FFF6D7", borderRadius: 8, paddingHorizontal: 7, paddingVertical: 4 }, followUpText: { color: "#906C00", fontSize: 10, fontWeight: "800" }, mapButton: { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: "#E5F4F6", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5 }, mapButtonText: { color: "#0D6980", fontSize: 10, fontWeight: "800" }, countPill: { minWidth: 37, height: 31, borderRadius: 12, backgroundColor: "#FFF0C2", alignItems: "center", justifyContent: "center" }, countPillText: { color: "#866100", fontWeight: "800", fontSize: 15 }, returnCard: { backgroundColor: "#FFFFFF", borderRadius: 17, borderWidth: 1, borderColor: "#E3EAED", padding: 13, gap: 12 }, returnCardMain: { flexDirection: "row", gap: 11 }, returnIcon: { width: 39, height: 39, borderRadius: 13, backgroundColor: "#FFF2C7", alignItems: "center", justifyContent: "center" }, returnText: { flex: 1, minWidth: 0 }, mutedLine: { color: "#81909A", fontSize: 12, marginTop: 4 }, returnActions: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 8 }, doneButton: { flexDirection: "row", alignItems: "center", gap: 5, backgroundColor: "#E3F5ED", paddingHorizontal: 11, paddingVertical: 8, borderRadius: 10 }, doneText: { color: "#0F664D", fontSize: 12, fontWeight: "800" }, mapsNotice: { flexDirection: "row", gap: 10, backgroundColor: "#E3F4F6", borderWidth: 1, borderColor: "#CFE9EC", borderRadius: 14, padding: 13, marginBottom: 13 }, mapsNoticeText: { flex: 1, color: "#356579", fontSize: 12, lineHeight: 17 }, territoryCard: { flexDirection: "row", alignItems: "center", backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#E3EAED", borderRadius: 17, padding: 13, gap: 12 }, territoryNumber: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#DDF0F2", alignItems: "center", justifyContent: "center" }, territoryNumberAlt: { backgroundColor: "#EEF1F9" }, territoryNumberText: { color: "#0D6980", fontWeight: "800", fontSize: 12 }, territoryCardText: { flex: 1 }, territoryName: { color: "#183649", fontSize: 15, fontWeight: "800" }, territoryHint: { color: "#788995", fontSize: 12, marginTop: 3 }, toolsPanel: { marginTop: 10, backgroundColor: "#E7F7EF", borderWidth: 1, borderColor: "#CDE9D9", borderRadius: 16, padding: 14, gap: 10 }, toolsTitleRow: { flexDirection: "row", alignItems: "center", gap: 7 }, toolsTitle: { color: "#1A5E49", fontSize: 15, fontWeight: "800" }, toolsBody: { color: "#316B57", fontSize: 12, lineHeight: 17 }, toolRow: { flexDirection: "row", gap: 8 }, toolRow: { flexDirection: "row", gap: 8 }, syncRow: { flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: "#FFFFFF", borderRadius: 13, padding: 10 }, syncStatusIcon: { width: 33, height: 33, borderRadius: 11, backgroundColor: "#E5F4F6", alignItems: "center", justifyContent: "center" }, syncText: { flex: 1, minWidth: 0 }, syncTitle: { color: "#234858", fontSize: 12, fontWeight: "800" }, syncBody: { color: "#6A7F88", fontSize: 11, marginTop: 2 }, syncButton: { backgroundColor: "#0D6980", paddingHorizontal: 10, paddingVertical: 9, borderRadius: 10 }, syncButtonText: { color: "#FFFFFF", fontSize: 11, fontWeight: "800" }, reminderRow: { flexDirection: "row", alignItems: "center", gap: 9, backgroundColor: "#FFF9E7", borderRadius: 13, padding: 10 }, clearText: { color: "#A83939", fontSize: 12, fontWeight: "800" }, loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 13 }, loadingText: { color: "#647985", fontSize: 14 }, modalSafeArea: { flex: 1, backgroundColor: "#F6F8FA" }, modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", height: 61, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: "#E2E9ED", backgroundColor: "#FFFFFF" }, modalClose: { width: 36, height: 36, borderRadius: 12, backgroundColor: "#EFF4F6", alignItems: "center", justifyContent: "center" }, modalTitle: { color: "#183649", fontWeight: "800", fontSize: 17 }, modalHeaderSpacer: { width: 36 }, modalContent: { padding: 20, paddingBottom: 34 }, modalIntro: { flexDirection: "row", gap: 11, backgroundColor: "#E7F5F6", borderRadius: 17, padding: 14, marginBottom: 24 }, modalIntroIcon: { width: 42, height: 42, borderRadius: 14, backgroundColor: "#C9EAED", alignItems: "center", justifyContent: "center" }, modalIntroTitle: { color: "#183649", fontWeight: "800", fontSize: 14, marginBottom: 2 }, modalIntroBody: { color: "#58717F", fontSize: 12, lineHeight: 17, maxWidth: 245 }, fieldLabel: { color: "#607580", fontWeight: "800", fontSize: 10, letterSpacing: 1, marginBottom: 8, marginTop: 3 }, optionalLabel: { color: "#92A0A8", fontSize: 9 }, textField: { minHeight: 51, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DDE7EB", borderRadius: 14, color: "#183649", paddingHorizontal: 14, fontSize: 14, marginBottom: 20 }, notesField: { minHeight: 107, paddingTop: 13 }, territorySelector: { gap: 8, paddingBottom: 17 }, selectorChip: { paddingHorizontal: 13, paddingVertical: 10, backgroundColor: "#FFFFFF", borderWidth: 1, borderColor: "#DDE7EB", borderRadius: 12 }, selectorChipActive: { backgroundColor: "#0D6980", borderColor: "#0D6980" }, selectorChipText: { color: "#506875", fontSize: 13, fontWeight: "700" }, selectorChipTextActive: { color: "#FFFFFF" }, locationCapture: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: "#E9F4F8", borderWidth: 1, borderColor: "#CBE3EA", borderRadius: 15, padding: 12, marginBottom: 20 }, locationCaptureActive: { backgroundColor: "#E7F7EF", borderColor: "#CDE9D9" }, locationCaptureText: { flex: 1 }, locationCaptureTitle: { color: "#1B566D", fontSize: 13, fontWeight: "800" }, locationCaptureBody: { color: "#5D7B86", fontSize: 11, lineHeight: 15, marginTop: 2 }, followUpSwitch: { flexDirection: "row", alignItems: "center", gap: 11, backgroundColor: "#FFF9E7", borderWidth: 1, borderColor: "#F2E4B7", borderRadius: 15, padding: 13, marginBottom: 24 }, switchIcon: { width: 36, height: 36, borderRadius: 12, backgroundColor: "#FFEDAE", alignItems: "center", justifyContent: "center" }, switchText: { flex: 1 }, switchTitle: { color: "#664B00", fontSize: 14, fontWeight: "800" }, switchBody: { color: "#8A762F", fontSize: 11, lineHeight: 15, marginTop: 2 }, saveButton: { minHeight: 53, backgroundColor: "#0D6980", borderRadius: 15, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, shadowColor: "#0D6980", shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 3 }, saveButtonText: { color: "#FFFFFF", fontSize: 15, fontWeight: "800" },
});
