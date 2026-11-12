// App entry point (package.json "main").
//
// TaskManager.defineTask must run every time the JavaScript bundle loads, including
// when Android restarts the app in the background to deliver a location update and
// no screen is rendered. Defining it here, before the router starts, means it
// does not depend on any screen or layout module having been loaded.
import "./utils/backgroundGeofence";
import "expo-router/entry";
