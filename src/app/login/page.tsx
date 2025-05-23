"use client";

import { AuthForm } from "@/components/auth/AuthForm";
import Link from "next/link";

export default function LoginPage() {
  return (
    <div className="flex flex-col justify-center items-center h-screen">
      <AuthForm isLogin={true} />
      <p className="mt-4">
        Don't have an account? <Link href="/signup" className="text-primary">Sign up</Link>
      </p>
    </div>
  );
}
