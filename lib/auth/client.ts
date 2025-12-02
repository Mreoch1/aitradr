export interface User {
  id: string;
  email: string;
}

export interface AuthResponse {
  user?: User;
  error?: string;
  success?: boolean;
}

export async function signup(
  email: string,
  password: string
): Promise<AuthResponse> {
  try {
    const response = await fetch("/api/auth/signup", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    let data;
    try {
      data = await response.json();
    } catch (error) {
      return { error: "Invalid response from server" };
    }

    if (!response.ok) {
      return { error: data.error || "Signup failed" };
    }

    return { user: data.user };
  } catch (error) {
    return { error: "Network error. Please try again." };
  }
}

export async function signin(
  email: string,
  password: string
): Promise<AuthResponse> {
  try {
    const response = await fetch("/api/auth/signin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    let data;
    try {
      data = await response.json();
    } catch (error) {
      return { error: "Invalid response from server" };
    }

    if (!response.ok) {
      return { error: data.error || "Signin failed" };
    }

    return { user: data.user };
  } catch (error) {
    return { error: "Network error. Please try again." };
  }
}

export async function signout(): Promise<AuthResponse> {
  try {
    const response = await fetch("/api/auth/signout", {
      method: "POST",
    });

    const data = await response.json();

    if (!response.ok) {
      return { error: data.error || "Signout failed" };
    }

    return { success: true };
  } catch (error) {
    return { error: "Network error. Please try again." };
  }
}

