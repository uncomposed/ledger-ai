import "dotenv/config";

export default {
  name: "Ledger",
  slug: "ledger",
  scheme: "ledger",
  version: "0.0.1",
  platforms: ["ios", "android", "web"],
  jsEngine: "jsc",
  extra: {
    clerkPublishableKey: process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
    apiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL,
  },
};
