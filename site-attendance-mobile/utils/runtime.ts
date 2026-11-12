import Constants, { ExecutionEnvironment } from "expo-constants";

/**
 * True inside the Expo Go app (testing only). Expo Go cannot run background
 * location (iOS rejects it: only an installed build has the NSLocation* keys), so
 * the background-location step and the background task are skipped there.
 */
export const isExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
