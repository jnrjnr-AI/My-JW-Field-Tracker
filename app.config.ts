import "./scripts/load-env.js";
import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "Field Service Manager",
  slug: "field-service-manager-mobile",
  version: "1.0.0",
  orientation: "portrait",
  icon: "./assets/images/field-service-icon.png",
  scheme: "fieldservicemanager",
  userInterfaceStyle: "light",
  newArchEnabled: true,
  ios: {
    supportsTablet: true,
    bundleIdentifier: "com.fieldservicemanager.mobile",
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    adaptiveIcon: {
      backgroundColor: "#0D2D49",
      foregroundImage: "./assets/images/field-service-icon.png",
    },
    edgeToEdgeEnabled: true,
    predictiveBackGestureEnabled: false,
    package: "com.fieldservicemanager.mobile",
  },
  web: {
    bundler: "metro",
    output: "static",
    favicon: "./assets/images/field-service-icon.png",
  },
  plugins: [
    "expo-router",
    [
      "expo-location",
      {
        locationWhenInUsePermission: "Allow Field Service Manager to pin the location of a logged visit.",
      },
    ],
    ["expo-notifications", { color: "#0D6980" }],
    [
      "expo-splash-screen",
      {
        image: "./assets/images/field-service-icon.png",
        imageWidth: 150,
        resizeMode: "contain",
        backgroundColor: "#F6F8FA",
      },
    ],
    [
      "expo-build-properties",
      {
        android: { buildArchs: ["armeabi-v7a", "arm64-v8a"], minSdkVersion: 24 },
      },
    ],
  ],
  experiments: { typedRoutes: true, reactCompiler: true },
};

export default config;
