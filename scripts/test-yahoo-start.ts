import "dotenv/config";

async function testYahooStart() {
  const baseUrl = "http://localhost:3000";
  let sessionCookie: string | null = null;

  try {
    console.log("=== Testing Yahoo OAuth Start Flow ===\n");

    // Step 1: Sign up test user
    console.log("1. Signing up test user...");
    const signupResponse = await fetch(`${baseUrl}/api/auth/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: "yahoo-test@example.com",
        password: "password123",
      }),
    });

    const signupData = await signupResponse.json();
    console.log("   Status:", signupResponse.status);
    console.log("   Response:", JSON.stringify(signupData, null, 2));

    if (signupResponse.status === 201 || signupResponse.status === 400) {
      // Step 2: Sign in
      console.log("\n2. Signing in test user...");
      const signinResponse = await fetch(`${baseUrl}/api/auth/signin`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "yahoo-test@example.com",
          password: "password123",
        }),
      });

      const setCookieHeader = signinResponse.headers.get("set-cookie");
      if (setCookieHeader) {
        sessionCookie = setCookieHeader.split(";")[0];
        console.log("   Status:", signinResponse.status);
        console.log("   Session cookie captured:", sessionCookie.substring(0, 30) + "...");
      } else {
        console.error("   ERROR: No Set-Cookie header in signin response");
        const signinData = await signinResponse.json();
        console.log("   Response:", JSON.stringify(signinData, null, 2));
        process.exit(1);
      }

      // Step 3: Call Yahoo start endpoint
      console.log("\n3. Calling /api/auth/yahoo/start...");
      const yahooStartResponse = await fetch(`${baseUrl}/api/auth/yahoo/start`, {
        method: "GET",
        headers: {
          Cookie: sessionCookie || "",
        },
        redirect: "manual",
      });

      console.log("   Status:", yahooStartResponse.status);
      console.log("   Status Text:", yahooStartResponse.statusText);

      const location = yahooStartResponse.headers.get("location");
      console.log("   Location header:", location || "(not present)");

      const responseText = await yahooStartResponse.text();
      if (responseText && !location) {
        console.log("   Response body:", responseText);
      }

      if (yahooStartResponse.status === 302 || yahooStartResponse.status === 307) {
        if (location && location.startsWith("https://api.login.yahoo.com/oauth2/request_auth")) {
          console.log("\n✓ SUCCESS: Redirect to Yahoo authorization URL");
          
          const url = new URL(location);
          console.log("\n   URL Parameters:");
          console.log("     client_id:", url.searchParams.get("client_id")?.substring(0, 20) + "...[REDACTED]");
          console.log("     redirect_uri:", url.searchParams.get("redirect_uri"));
          console.log("     response_type:", url.searchParams.get("response_type"));
          console.log("     scope:", url.searchParams.get("scope"));
          console.log("     state:", url.searchParams.get("state")?.substring(0, 20) + "...[REDACTED]");
          
          const scope = url.searchParams.get("scope") || "";
          if (scope.includes("fspt-r") && !scope.includes("fspt-w")) {
            console.log("\n✓ Scope validation: Contains 'fspt-r', does not contain 'fspt-w'");
          } else {
            console.log("\n✗ Scope validation FAILED");
            process.exit(1);
          }
        } else {
          console.log("\n✗ ERROR: Location header does not point to Yahoo");
          process.exit(1);
        }
      } else {
        console.log("\n✗ ERROR: Expected 302 or 307 redirect, got", yahooStartResponse.status);
        process.exit(1);
      }
    } else {
      console.error("   ERROR: Signup failed");
      process.exit(1);
    }
  } catch (error) {
    console.error("Test error:", error);
    if (error instanceof Error) {
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
    process.exit(1);
  }
}

testYahooStart();

