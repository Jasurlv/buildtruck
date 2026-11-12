import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Dimensions,
} from "react-native";
import { Tabs, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SymbolView } from "expo-symbols";
import { useTranslation } from "react-i18next";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const TAB_COUNT = 3;
const TAB_WIDTH = SCREEN_WIDTH / TAB_COUNT;
const TAB_BAR_HEIGHT = 65;

function CustomTabBar({ state }: any) {
  const router = useRouter();
  const { t } = useTranslation();
  // The bar grows by the bottom inset (gesture bar / Back-Home-Recents), so the
  // 65 px buttons sit above it. The inset is 0 on phones without one.
  const insets = useSafeAreaInsets();
  const translateX = useRef(
    new Animated.Value(state.index * TAB_WIDTH),
  ).current;

  useEffect(() => {
    Animated.spring(translateX, {
      toValue: state.index * TAB_WIDTH,
      useNativeDriver: true,
      bounciness: 4,
      speed: 12,
    }).start();
  }, [state.index]);

  return (
    <View
      style={[
        styles.tabContainer,
        { height: TAB_BAR_HEIGHT + insets.bottom, paddingBottom: insets.bottom },
      ]}
    >
      {/* Sliding Active Indicator Background matching Punch-In button color (#4f46e5) */}
      <Animated.View
        style={[
          styles.indicator,
          {
            transform: [{ translateX }],
            borderTopLeftRadius: state.index === 0 ? 0 : 24,
            borderBottomLeftRadius: state.index === 0 ? 0 : 24,
            borderTopRightRadius: state.index === 2 ? 0 : 24,
            borderBottomRightRadius: state.index === 2 ? 0 : 24,
          },
        ]}
      />

      {state.routes.map((route: any, index: number) => {
        const isFocused = state.index === index;
        let label = t("tabs.today");
        if (route.name === "two") label = t("tabs.history");
        if (route.name === "profile") label = t("tabs.profile");

        const onPress = () => {
          if (!isFocused) {
            router.push(route.name === "index" ? "/" : `/(tabs)/${route.name}`);
          }
        };

        return (
          <TouchableOpacity
            key={route.key}
            onPress={onPress}
            style={styles.tabItem}
            activeOpacity={0.8}
          >
            <SymbolView
              name={
                route.name === "index"
                  ? "calendar"
                  : route.name === "two"
                    ? "clock.fill"
                    : "person.fill"
              }
              // Active text/icon turns white for contrast against the button-colored background, inactive stays gray
              tintColor={isFocused ? "#FFFFFF" : "#5B6670"}
              size={22}
            />
            <Text
              style={[
                styles.tabLabel,
                {
                  color: isFocused ? "#FFFFFF" : "#5B6670",
                  fontWeight: isFocused ? "700" : "500",
                },
              ]}
            >
              {label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function TabLayout() {
  const { t } = useTranslation();
  return (
    <Tabs
      tabBar={(props) => <CustomTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="index" options={{ title: t("tabs.today") }} />
      <Tabs.Screen name="two" options={{ title: t("tabs.history") }} />
      <Tabs.Screen name="profile" options={{ title: t("tabs.profile") }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabContainer: {
    flexDirection: "row",
    backgroundColor: "#f9fafb", // Matches app background color exactly
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    position: "relative",
    elevation: 8,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  indicator: {
    position: "absolute",
    top: 0,
    height: TAB_BAR_HEIGHT,
    width: TAB_WIDTH,
    backgroundColor: "#4f46e5", // Matches the Punch-In button background color
  },
  tabItem: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  tabLabel: {
    fontSize: 11,
    marginTop: 3,
  },
});
