import { ClerkProvider, SignedIn, SignedOut, useAuth, useSignIn, useSignUp, useUser, useClerk } from "@clerk/clerk-expo";
import { tokenCache } from "@clerk/clerk-expo/token-cache";
import Constants from "expo-constants";
import React from "react";
import { Text, TextInput, TouchableOpacity, View } from "react-native";

const publishableKey = Constants.expoConfig?.extra?.clerkPublishableKey as string | undefined;
const apiBaseUrl = (Constants.expoConfig?.extra?.apiBaseUrl as string | undefined) ?? "http://localhost:3000";

function AuthScreens() {
  const [mode, setMode] = React.useState<"sign_in" | "sign_up">("sign_in");
  return (
    <View style={{ padding: 16, gap: 12 }}>
      <View style={{ flexDirection: "row", gap: 12 }}>
        <TouchableOpacity onPress={() => setMode("sign_in")}>
          <Text>Sign in</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setMode("sign_up")}>
          <Text>Sign up</Text>
        </TouchableOpacity>
      </View>
      {mode === "sign_in" ? <SignInForm /> : <SignUpForm />}
    </View>
  );
}

function SignInForm() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");

  return (
    <View style={{ gap: 12 }}>
      <TextInput
        autoCapitalize="none"
        value={emailAddress}
        placeholder="Email"
        onChangeText={setEmailAddress}
        style={{ borderWidth: 1, padding: 8 }}
      />
      <TextInput
        value={password}
        placeholder="Password"
        secureTextEntry
        onChangeText={setPassword}
        style={{ borderWidth: 1, padding: 8 }}
      />
      <TouchableOpacity
        onPress={async () => {
          if (!isLoaded) return;
          try {
            const attempt = await signIn.create({ identifier: emailAddress, password });
            if (attempt.status === "complete") {
              await setActive({ session: attempt.createdSessionId });
            } else {
              console.log("signIn status", attempt.status);
            }
          } catch (e) {
            console.log(String(e));
          }
        }}
      >
        <Text>Continue</Text>
      </TouchableOpacity>
    </View>
  );
}

function SignUpForm() {
  const { isLoaded, signUp, setActive } = useSignUp();
  const [emailAddress, setEmailAddress] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [pendingVerification, setPendingVerification] = React.useState(false);
  const [code, setCode] = React.useState("");

  if (pendingVerification) {
    return (
      <View style={{ gap: 12 }}>
        <Text>Verify your email</Text>
        <TextInput value={code} placeholder="Verification code" onChangeText={setCode} style={{ borderWidth: 1, padding: 8 }} />
        <TouchableOpacity
          onPress={async () => {
            if (!isLoaded) return;
            try {
              const attempt = await signUp.attemptEmailAddressVerification({ code });
              if (attempt.status === "complete") {
                await setActive({ session: attempt.createdSessionId });
              } else {
                console.log("verify status", attempt.status);
              }
            } catch (e) {
              console.log(String(e));
            }
          }}
        >
          <Text>Verify</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={{ gap: 12 }}>
      <TextInput
        autoCapitalize="none"
        value={emailAddress}
        placeholder="Email"
        onChangeText={setEmailAddress}
        style={{ borderWidth: 1, padding: 8 }}
      />
      <TextInput
        value={password}
        placeholder="Password"
        secureTextEntry
        onChangeText={setPassword}
        style={{ borderWidth: 1, padding: 8 }}
      />
      <TouchableOpacity
        onPress={async () => {
          if (!isLoaded) return;
          try {
            await signUp.create({ emailAddress, password });
            await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
            setPendingVerification(true);
          } catch (e) {
            console.log(String(e));
          }
        }}
      >
        <Text>Continue</Text>
      </TouchableOpacity>
    </View>
  );
}

function HomeScreen() {
  const { user } = useUser();
  const { getToken } = useAuth();
  const { signOut } = useClerk();

  return (
    <View style={{ padding: 16, gap: 12 }}>
      <Text>Hello {user?.emailAddresses?.[0]?.emailAddress ?? "user"}</Text>
      <TouchableOpacity
        onPress={async () => {
          const token = await getToken();
          if (!token) {
            console.log("No token available");
            return;
          }
          console.log("Clerk token length", token.length);
          const res = await fetch(`${apiBaseUrl}/me`, {
            headers: {
              Authorization: `Bearer ${token}`,
              "x-correlation-id": "expo-me",
            },
          });
          const text = await res.text();
          console.log("API /me status", res.status);
          console.log("API /me body", text);
        }}
      >
        <Text>Call backend /me</Text>
      </TouchableOpacity>
      <TouchableOpacity onPress={async () => signOut()}>
        <Text>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

export default function App() {
  if (!publishableKey) return <Text>Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY</Text>;

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <SignedIn>
        <HomeScreen />
      </SignedIn>
      <SignedOut>
        <AuthScreens />
      </SignedOut>
    </ClerkProvider>
  );
}

