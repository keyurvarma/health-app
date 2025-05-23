"use client";

import { AuthForm } from "@/components/auth/AuthForm";

export default function SignupPage() {
  return (
    <div className="flex justify-center items-center h-screen">
      <AuthForm isLogin={false} />
    </div>
  );
}
