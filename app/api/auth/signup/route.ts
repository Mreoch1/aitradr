import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import prisma from "@/lib/prisma";
import { hashPassword } from "@/lib/auth/password";
import { createSession } from "@/lib/auth/session";
import { validateEmail, normalizeEmail, validatePassword } from "@/lib/auth/validation";

export async function POST(request: NextRequest) {
  try {
    let body;
    try {
      body = await request.json();
    } catch (error) {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const { email, password } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const normalizedEmail = normalizeEmail(email);

    if (!validateEmail(normalizedEmail)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    const passwordValidation = validatePassword(password);
    if (!passwordValidation.valid) {
      return NextResponse.json(
        { error: passwordValidation.error },
        { status: 400 }
      );
    }

    let existingUser;
    try {
      existingUser = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });
    } catch (error) {
      console.error("Prisma findUnique error:", error);
      throw error;
    }

    if (existingUser) {
      return NextResponse.json(
        { error: "Email already in use" },
        { status: 400 }
      );
    }

    let passwordHash;
    try {
      passwordHash = await hashPassword(password);
    } catch (error) {
      console.error("Password hashing error:", error);
      throw error;
    }

    let user;
    try {
      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          passwordHash,
        },
      });
    } catch (error: any) {
      if (error?.code === "P2002" || error?.meta?.target?.includes("email")) {
        return NextResponse.json(
          { error: "Email already in use" },
          { status: 400 }
        );
      }
      throw error;
    }

    const session = await createSession(user.id);
    const cookieStore = await cookies();
    cookieStore.set("session", session, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    return NextResponse.json(
      { ok: true, user: { id: user.id, email: user.email } },
      { status: 201 }
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error("Signup error:", errorMessage);
    
    if (errorMessage.includes("AUTH_SECRET")) {
      return NextResponse.json(
        { error: "Server configuration error: AUTH_SECRET not set" },
        { status: 500 }
      );
    }
    
    if (errorMessage.includes("Email already in use") || errorMessage.includes("P2002")) {
      return NextResponse.json(
        { error: "Email already in use" },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

