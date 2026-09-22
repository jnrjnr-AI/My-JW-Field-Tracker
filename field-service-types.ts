export type VisitLocation = {
  latitude: number;
  longitude: number;
};

export type Visit = {
  id: string;
  person: string;
  territory: string;
  notes: string;
  needsFollowUp: boolean;
  createdAt: string;
  location?: VisitLocation;
  notificationId?: string;
};
